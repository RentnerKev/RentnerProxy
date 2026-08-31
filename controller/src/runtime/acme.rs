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
    runtime::certificates::{CertificateEnvironment, CertificateError, CertificateIssueRequest},
    server::challenges::ChallengeStore,
};

use super::ProxyRuntime;

const ORDER_TIMEOUT: Duration = Duration::from_secs(120);
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
        let mut registered = Vec::new();
        let result = timeout(
            ORDER_TIMEOUT,
            self.issue_acme(&request, &challenges, &mut registered),
        )
        .await
        .unwrap_or(Err(CertificateError::AcmeFailed));
        // Cleanup also runs after failed authorizations, network failures and order timeouts.
        for (domain, token) in registered {
            challenges.remove(&domain, &token).await;
        }
        let result = match result {
            Ok((certificate_pem, private_key_pem)) => self
                .activate_acme_certificate(&id, &request, certificate_pem, private_key_pem)
                .await
                .map(|_| ()),
            Err(error) => Err(error),
        };
        if let Err(error) = result {
            self.certificate_store.finish_failed(&id, error).await;
        }
    }

    async fn issue_acme(
        self: &Arc<Self>,
        request: &CertificateIssueRequest,
        challenges: &ChallengeStore,
        registered: &mut Vec<(String, String)>,
    ) -> Result<(String, String), CertificateError> {
        let account = timeout(ACCOUNT_TIMEOUT, self.acme_account(request))
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

        let mut authorizations = order.authorizations();
        while let Some(result) = authorizations.next().await {
            let mut authorization = result.map_err(|_| CertificateError::AcmeFailed)?;
            match authorization.status {
                AuthorizationStatus::Pending => {}
                AuthorizationStatus::Valid => continue,
                _ => return Err(CertificateError::AcmeFailed),
            }
            let mut challenge = authorization
                .challenge(ChallengeType::Http01)
                .ok_or(CertificateError::AcmeFailed)?;
            let domain = challenge.identifier().to_string();
            let token = challenge.token.clone();
            if !request.domains.contains(&domain) {
                return Err(CertificateError::AcmeFailed);
            }
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
        &self,
        request: &CertificateIssueRequest,
    ) -> Result<Account, CertificateError> {
        let _account_guard = ACCOUNT_REGISTRATION.lock().await;
        let (directory, root) = acme_directory(request.environment)?;
        let credentials = self
            .certificate_store
            .load_acme_account(request.environment)
            .await?;
        let builder = match root {
            Some(root) => Account::builder_with_root(root),
            None => Account::builder(),
        }
        .map_err(|_| CertificateError::AcmeFailed)?;

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
