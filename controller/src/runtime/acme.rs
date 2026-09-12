use std::{env, sync::Arc, time::Duration};

use rustls::pki_types::{PrivateKeyDer, PrivatePkcs8KeyDer};
use serde::{Deserialize, Serialize};
use tokio::{
    sync::{Mutex, Semaphore, SemaphorePermit},
    time::timeout,
};

use instant_acme::{
    Account, AccountCredentials, AuthorizationStatus, ChallengeType, Identifier, Key, LetsEncrypt,
    NewOrder, OrderStatus, RetryPolicy,
};

use crate::{
    runtime::certificates::{
        AcmeChallengeType, CertificateEnvironment, CertificateError, CertificateIssueRequest,
    },
    server::challenges::ChallengeStore,
};

use super::ProxyRuntime;
use super::dns::{DnsProvider, DnsRecordIntent};
use acme_http::AcmeHttpClient;

#[path = "acme_http.rs"]
mod acme_http;

const ORDER_TIMEOUT: Duration = Duration::from_secs(120);
const DNS_ORDER_TIMEOUT: Duration = Duration::from_secs(180);
const DNS_PROPAGATION_WAIT: Duration = Duration::from_secs(30);
const DNS_CLEANUP_TIMEOUT: Duration = Duration::from_secs(60);
const ACCOUNT_TIMEOUT: Duration = Duration::from_secs(20);
static ACCOUNT_REGISTRATION: Mutex<()> = Mutex::const_new(());
static ACME_JOBS: Semaphore = Semaphore::const_new(4);

#[derive(Deserialize)]
struct AccountDirectory {
    directory: String,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct PendingAccountRegistration {
    directory: String,
    pending_key_pkcs8: Vec<u8>,
    contact_email: Option<String>,
}

impl ProxyRuntime {
    pub(crate) async fn start_acme_issue(
        self: &Arc<Self>,
        id: String,
        request: CertificateIssueRequest,
        challenges: ChallengeStore,
    ) -> Result<super::CertificateMetadata, CertificateError> {
        let permit = ACME_JOBS
            .try_acquire()
            .map_err(|_| CertificateError::OperationInProgress)?;
        let metadata = self
            .certificate_store
            .begin_issue(&id, request.clone(), false)
            .await?;
        let runtime = Arc::clone(self);
        tokio::spawn(async move {
            let _permit = permit;
            runtime.issue_acme_inner(id, request, challenges).await;
        });
        Ok(metadata)
    }

    pub(crate) async fn start_acme_renewal(
        self: &Arc<Self>,
        id: String,
        challenges: ChallengeStore,
    ) -> Result<super::CertificateMetadata, CertificateError> {
        let permit = ACME_JOBS
            .try_acquire()
            .map_err(|_| CertificateError::OperationInProgress)?;
        self.renew_with_permit(id, challenges, permit).await
    }

    pub(crate) async fn start_scheduled_acme_renewal(
        self: &Arc<Self>,
        id: String,
        challenges: ChallengeStore,
    ) -> Result<super::CertificateMetadata, CertificateError> {
        let permit = ACME_JOBS
            .acquire()
            .await
            .map_err(|_| CertificateError::OperationInProgress)?;
        let certificate = self.certificate_store.get(&id).await?;
        if !self.certificate_store.renewal_is_allowed(&id).await
            || !Self::renewal_is_due(&certificate)
        {
            return Err(CertificateError::OperationInProgress);
        }
        self.renew_with_permit(id, challenges, permit).await
    }

    async fn renew_with_permit(
        self: &Arc<Self>,
        id: String,
        challenges: ChallengeStore,
        permit: SemaphorePermit<'static>,
    ) -> Result<super::CertificateMetadata, CertificateError> {
        let (metadata, request) = self.certificate_store.begin_renewal(&id).await?;
        let runtime = Arc::clone(self);
        tokio::spawn(async move {
            let _permit = permit;
            runtime.issue_acme_inner(id, request, challenges).await;
        });
        Ok(metadata)
    }

    async fn issue_acme_inner(
        self: Arc<Self>,
        id: String,
        request: CertificateIssueRequest,
        challenges: ChallengeStore,
    ) {
        let dns_provider = match request.challenge_type {
            AcmeChallengeType::Http01 => None,
            AcmeChallengeType::Dns01 => {
                let Some(config) = request.dns_provider.clone() else {
                    self.certificate_store
                        .finish_failed(&id, CertificateError::AcmeDnsRequired)
                        .await;
                    return;
                };
                match DnsProvider::from_config(config, request.environment) {
                    Ok(provider) => Some(provider),
                    Err(error) => {
                        self.certificate_store.finish_failed(&id, error).await;
                        return;
                    }
                }
            }
        };
        // Recover an interrupted or failed cleanup before creating a new order.
        // The encrypted provider configuration and these intents survive restart.
        let previous_intents = match self.certificate_store.pending_dns_records(&id).await {
            Ok(intents) => intents,
            Err(error) => {
                self.certificate_store.finish_failed(&id, error).await;
                return;
            }
        };
        if !previous_intents.is_empty() {
            let cleanup = match dns_provider.as_ref() {
                Some(provider) => {
                    self.cleanup_dns_challenges(&id, provider, &previous_intents)
                        .await
                }
                None => Err(CertificateError::DnsCleanupFailed),
            };
            if let Err(error) = cleanup {
                self.certificate_store.finish_failed(&id, error).await;
                return;
            }
        }
        let mut registered = Vec::new();
        let mut dns_intents: Vec<DnsRecordIntent> = Vec::new();
        let result = timeout(
            if request.challenge_type == AcmeChallengeType::Dns01 {
                DNS_ORDER_TIMEOUT
            } else {
                ORDER_TIMEOUT
            },
            self.issue_acme(
                &id,
                &request,
                &challenges,
                &mut registered,
                dns_provider.as_ref(),
                &mut dns_intents,
            ),
        )
        .await
        .unwrap_or(Err(CertificateError::AcmeFailed));

        // Cleanup also runs after failed authorizations, network failures and order timeouts.
        // The store persists intents before POST, including when the POST response is lost.
        // Cleanup has its own deadline, independent of the cancelled order future.
        let dns_cleanup = if let Some(provider) = dns_provider.as_ref() {
            self.cleanup_dns_challenges(&id, provider, &dns_intents)
                .await
        } else {
            Ok(())
        };
        for (domain, token) in registered {
            challenges.remove(&domain, &token).await;
        }

        let result = match dns_cleanup {
            Err(error) => Err(error),
            Ok(()) => match result {
                Ok((certificate_pem, private_key_pem)) => self
                    .activate_acme_certificate(&id, &request, certificate_pem, private_key_pem)
                    .await
                    .map(|_| ()),
                Err(error) => Err(error),
            },
        };
        if let Err(error) = result {
            self.certificate_store.finish_failed(&id, error).await;
        }
    }

    async fn cleanup_dns_challenges(
        &self,
        id: &str,
        provider: &DnsProvider,
        intents: &[DnsRecordIntent],
    ) -> Result<(), CertificateError> {
        if intents.is_empty() {
            return Ok(());
        }
        timeout(DNS_CLEANUP_TIMEOUT, async {
            for (index, intent) in intents.iter().enumerate() {
                provider
                    .cleanup_intents(std::slice::from_ref(intent))
                    .await?;
                // Persist progress: a slow provider must not force every retry
                // to re-scan all already removed proofs before reaching the rest.
                self.certificate_store
                    .set_pending_dns_records(id, intents[index + 1..].to_vec())
                    .await?;
            }
            Ok(())
        })
        .await
        .map_err(|_| CertificateError::DnsCleanupFailed)?
    }

    async fn issue_acme(
        self: &Arc<Self>,
        id: &str,
        request: &CertificateIssueRequest,
        challenges: &ChallengeStore,
        registered: &mut Vec<(String, String)>,
        dns_provider: Option<&DnsProvider>,
        dns_intents: &mut Vec<DnsRecordIntent>,
    ) -> Result<(String, String), CertificateError> {
        if let Some(provider) = dns_provider {
            // Reject names outside the configured zone before contacting ACME.
            provider.validate_sans(&request.domains).await?;
        }
        let account = timeout(ACCOUNT_TIMEOUT, self.acme_account(id, request))
            .await
            .map_err(|_| CertificateError::AcmeFailed)??;
        let identifiers = request
            .domains
            .iter()
            .cloned()
            .map(Identifier::Dns)
            .collect::<Vec<_>>();
        let mut order = account
            .new_order(&NewOrder::new(&identifiers))
            .await
            .map_err(|_| CertificateError::AcmeFailed)?;

        match request.challenge_type {
            AcmeChallengeType::Http01 => {
                let mut authorizations = order.authorizations();
                while let Some(result) = authorizations.next().await {
                    let mut authorization = result.map_err(|_| CertificateError::AcmeFailed)?;
                    requested_identifier(&authorization.identifier(), &request.domains)?;
                    if authorization.wildcard {
                        return Err(CertificateError::AcmeDnsRequired);
                    }
                    match authorization.status {
                        AuthorizationStatus::Pending => {}
                        AuthorizationStatus::Valid => continue,
                        _ => return Err(CertificateError::AcmeFailed),
                    }
                    let mut challenge = authorization
                        .challenge(ChallengeType::Http01)
                        .ok_or(CertificateError::AcmeFailed)?;
                    let (domain, _) =
                        requested_identifier(challenge.identifier(), &request.domains)?;
                    if challenge.identifier().wildcard {
                        return Err(CertificateError::AcmeFailed);
                    }
                    let token = challenge.token.clone();
                    let value = challenge.key_authorization().as_str().to_owned();
                    challenges
                        .insert(domain.clone(), token.clone(), value)
                        .await?;
                    registered.push((domain, token));
                    challenge
                        .set_ready()
                        .await
                        .map_err(|_| CertificateError::AcmeFailed)?;
                }
            }
            AcmeChallengeType::Dns01 => {
                let provider = dns_provider.ok_or(CertificateError::AcmeDnsRequired)?;
                let mut presented = false;
                let mut authorizations = order.authorizations();
                while let Some(result) = authorizations.next().await {
                    let mut authorization = result.map_err(|_| CertificateError::AcmeFailed)?;
                    requested_identifier(&authorization.identifier(), &request.domains)?;
                    match authorization.status {
                        AuthorizationStatus::Pending => {}
                        AuthorizationStatus::Valid => continue,
                        _ => return Err(CertificateError::AcmeFailed),
                    }
                    let challenge = authorization
                        .challenge(ChallengeType::Dns01)
                        .ok_or(CertificateError::AcmeFailed)?;
                    let (_, bare_domain) =
                        requested_identifier(challenge.identifier(), &request.domains)?;
                    let value = challenge.key_authorization().dns_value();
                    // Keep the exact bare authorization name and value so the provider can
                    // recover an ambiguous POST without ever deleting an unrelated TXT record.
                    let intent = DnsRecordIntent::new(id, &bare_domain, &value)?;
                    dns_intents.push(intent.clone());
                    self.certificate_store
                        .set_pending_dns_records(id, dns_intents.clone())
                        .await?;
                    provider.present(&intent).await?;
                    presented = true;
                }
                if presented {
                    tokio::time::sleep(DNS_PROPAGATION_WAIT).await;
                }

                // All TXT values are present before any challenge is marked ready. This matters
                // when the apex and wildcard authorizations share one DNS name.
                let mut authorizations = order.authorizations();
                while let Some(result) = authorizations.next().await {
                    let mut authorization = result.map_err(|_| CertificateError::AcmeFailed)?;
                    requested_identifier(&authorization.identifier(), &request.domains)?;
                    if authorization.status == AuthorizationStatus::Valid {
                        continue;
                    }
                    if authorization.status != AuthorizationStatus::Pending {
                        return Err(CertificateError::AcmeFailed);
                    }
                    let mut challenge = authorization
                        .challenge(ChallengeType::Dns01)
                        .ok_or(CertificateError::AcmeFailed)?;
                    requested_identifier(challenge.identifier(), &request.domains)?;
                    challenge
                        .set_ready()
                        .await
                        .map_err(|_| CertificateError::AcmeFailed)?;
                }
            }
        }

        let status = order
            .poll_ready(&RetryPolicy::default())
            .await
            .map_err(|_| CertificateError::AcmeFailed)?;
        if status != OrderStatus::Ready {
            return Err(CertificateError::AcmeFailed);
        }
        let private_key_pem = order
            .finalize()
            .await
            .map_err(|_| CertificateError::AcmeFailed)?;
        let certificate_pem = order
            .poll_certificate(&RetryPolicy::default())
            .await
            .map_err(|_| CertificateError::AcmeFailed)?;
        Ok((certificate_pem, private_key_pem))
    }

    async fn acme_account(
        self: &Arc<Self>,
        id: &str,
        request: &CertificateIssueRequest,
    ) -> Result<Account, CertificateError> {
        let _account_guard = ACCOUNT_REGISTRATION.lock().await;
        let (directory, root) = acme_directory(request.environment)?;
        let root_pem = root
            .as_deref()
            .map(std::fs::read)
            .transpose()
            .map_err(|_| CertificateError::AcmeFailed)?;
        let _ = rustls::crypto::ring::default_provider().install_default();
        let http = AcmeHttpClient::new(
            root_pem.as_deref(),
            Arc::clone(self),
            id.to_owned(),
            request.environment,
        )
        .map_err(|_| CertificateError::AcmeFailed)?;
        let credentials = self
            .certificate_store
            .load_acme_account(request.environment)
            .await?;
        let builder = Account::builder_with_http(Box::new(http));

        let pending = if let Some(credentials) = credentials {
            let stored_directory: AccountDirectory = serde_json::from_slice(&credentials)
                .map_err(|_| CertificateError::StoreUnavailable)?;
            if stored_directory.directory != directory {
                return Err(CertificateError::StoreUnavailable);
            }
            match serde_json::from_slice::<PendingAccountRegistration>(&credentials) {
                Ok(pending) => pending,
                Err(_) => {
                    let credentials = serde_json::from_slice::<AccountCredentials>(&credentials)
                        .map_err(|_| CertificateError::StoreUnavailable)?;
                    return builder
                        .from_credentials(credentials)
                        .await
                        .map_err(|_| CertificateError::AcmeFailed);
                }
            }
        } else {
            let (_, key) = Key::generate_pkcs8().map_err(|_| CertificateError::AcmeFailed)?;
            let pending = PendingAccountRegistration {
                directory: directory.clone(),
                pending_key_pkcs8: key.secret_pkcs8_der().to_vec(),
                contact_email: request.contact_email.clone(),
            };
            let bytes =
                serde_json::to_vec(&pending).map_err(|_| CertificateError::StoreUnavailable)?;
            // Persist the key before registration so even an ambiguous network failure is retryable.
            self.certificate_store
                .store_acme_account(request.environment, &bytes)
                .await?;
            pending
        };

        let key_der = PrivatePkcs8KeyDer::from(pending.pending_key_pkcs8);
        let key = Key::from_pkcs8_der(key_der.clone_key())
            .map_err(|_| CertificateError::StoreUnavailable)?;
        let (account, stored) = builder
            .create_from_key((key, PrivateKeyDer::Pkcs8(key_der)), directory)
            .await
            .map_err(|_| CertificateError::AcmeFailed)?;
        if let Some(email) = pending.contact_email {
            let contact = format!("mailto:{email}");
            account
                .update_contacts(&[&contact])
                .await
                .map_err(|_| CertificateError::AcmeFailed)?;
        }
        let bytes = serde_json::to_vec(&stored).map_err(|_| CertificateError::StoreUnavailable)?;
        self.certificate_store
            .store_acme_account(request.environment, &bytes)
            .await?;
        Ok(account)
    }
}

fn requested_identifier(
    authorized: &instant_acme::AuthorizedIdentifier<'_>,
    requested: &[String],
) -> Result<(String, String), CertificateError> {
    let Identifier::Dns(name) = authorized.identifier else {
        return Err(CertificateError::AcmeFailed);
    };
    if !crate::proxy::is_canonical_domain(name) {
        return Err(CertificateError::AcmeFailed);
    }
    let full_name = authorized.to_string();
    if !requested.contains(&full_name) {
        return Err(CertificateError::AcmeFailed);
    }
    Ok((full_name, name.clone()))
}

fn acme_directory(
    environment: CertificateEnvironment,
) -> Result<(String, Option<String>), CertificateError> {
    let directory = env::var("RENTNERPROXY_ACME_TEST_DIRECTORY_URL").ok();
    let root = env::var("RENTNERPROXY_ACME_TEST_ROOT_CERT").ok();
    match (directory, root) {
        (Some(directory), Some(root)) if environment == CertificateEnvironment::Staging => {
            let uri = directory.parse::<axum::http::Uri>().ok();
            if directory != directory.trim()
                || directory.len() > 2048
                || root.trim().is_empty()
                || root.len() > 4096
                || !std::path::Path::new(&root).is_absolute()
                || uri.as_ref().is_none_or(|uri| {
                    uri.scheme_str() != Some("https")
                        || uri
                            .authority()
                            .is_none_or(|authority| authority.as_str().contains('@'))
                })
            {
                Err(CertificateError::AcmeFailed)
            } else {
                Ok((directory, Some(root)))
            }
        }
        (None, None) => Ok((
            match environment {
                CertificateEnvironment::Staging => LetsEncrypt::Staging.url().to_owned(),
                CertificateEnvironment::Production => LetsEncrypt::Production.url().to_owned(),
            },
            None,
        )),
        _ => Err(CertificateError::AcmeFailed),
    }
}

#[cfg(test)]
mod dns_authorization_tests {
    use super::*;

    #[test]
    fn wildcard_authorization_is_not_interchangeable_with_apex_or_child() {
        let apex = Identifier::Dns("example.com".to_owned());
        let child = Identifier::Dns("child.example.com".to_owned());
        let requested = vec!["*.example.com".to_owned()];
        assert_eq!(
            requested_identifier(&apex.authorized(true), &requested).unwrap(),
            ("*.example.com".to_owned(), "example.com".to_owned())
        );
        assert!(requested_identifier(&apex.authorized(false), &requested).is_err());
        assert!(requested_identifier(&child.authorized(false), &requested).is_err());
        assert!(requested_identifier(&child.authorized(true), &requested).is_err());
    }

    #[test]
    fn mixed_sans_keep_distinct_authorizations_with_one_txt_owner() {
        let identifier = Identifier::Dns("example.com".to_owned());
        let requested = vec!["*.example.com".to_owned(), "example.com".to_owned()];
        let apex = requested_identifier(&identifier.authorized(false), &requested).unwrap();
        let wildcard = requested_identifier(&identifier.authorized(true), &requested).unwrap();
        assert_ne!(apex.0, wildcard.0);
        assert_eq!(apex.1, wildcard.1);
        for name in [
            "other.com",
            "badexample.com",
            "example.com.other.com",
            "*.example.com",
        ] {
            assert!(
                requested_identifier(
                    &Identifier::Dns(name.to_owned()).authorized(false),
                    &requested
                )
                .is_err()
            );
        }
    }
}
