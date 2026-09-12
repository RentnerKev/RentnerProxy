use super::acme_http::AcmeHttpClient;
use crate::runtime::{
    ProxyRuntime,
    certificates::{CertificateEnvironment, CertificateError, CertificateIssueRequest},
};
use instant_acme::{Account, AccountCredentials, Key, LetsEncrypt};
use rustls::pki_types::{PrivateKeyDer, PrivatePkcs8KeyDer};
use serde::{Deserialize, Serialize};
use std::{env, sync::Arc};
use tokio::sync::Mutex;
static ACCOUNT_REGISTRATION: Mutex<()> = Mutex::const_new(());
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
    pub(super) async fn acme_account(
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
