use super::*;
use base64::{Engine, prelude::BASE64_URL_SAFE_NO_PAD};
use http_body_util::BodyExt;
use serde_json::{Value, json};

const DIRECTORY: &str = "https://ca.example.test/directory";

#[derive(Clone, Default)]
struct FakeCa {
    calls: Arc<std::sync::Mutex<Vec<(String, Value)>>>,
    reject_registration: bool,
    reject_contact: bool,
}

impl instant_acme::HttpClient for FakeCa {
    fn request(
        &self,
        request: axum::http::Request<instant_acme::BodyWrapper<bytes::Bytes>>,
    ) -> std::pin::Pin<
        Box<
            dyn std::future::Future<
                    Output = Result<instant_acme::BytesResponse, instant_acme::Error>,
                > + Send,
        >,
    > {
        let ca = self.clone();
        Box::pin(async move {
            let path = request.uri().path().to_owned();
            let method = request.method().clone();
            let body = request.into_body().collect().await.unwrap().to_bytes();
            let jose = if body.is_empty() {
                Value::Null
            } else {
                serde_json::from_slice(&body).unwrap()
            };
            ca.calls.lock().unwrap().push((path.clone(), jose));
            let (status, response) = match (method.as_str(), path.as_str()) {
                ("GET", "/directory") => (
                    200,
                    json!({"newNonce":"https://ca.example.test/nonce", "newAccount":"https://ca.example.test/accounts", "newOrder":"https://ca.example.test/orders"}),
                ),
                ("HEAD", "/nonce") => (200, Value::Null),
                ("POST", "/accounts") if ca.reject_registration => (
                    400,
                    json!({"type":"urn:ietf:params:acme:error:unauthorized", "detail":"test registration rejected"}),
                ),
                ("POST", "/accounts") => (201, json!({"status":"valid"})),
                ("POST", "/accounts/1") if ca.reject_contact => (
                    400,
                    json!({"type":"urn:ietf:params:acme:error:invalidContact", "detail":"test contact rejected"}),
                ),
                ("POST", "/accounts/1") => (200, json!({"status":"valid"})),
                _ => panic!("unexpected ACME request {method} {path}"),
            };
            let response = axum::http::Response::builder()
                .status(status)
                .header("replay-nonce", "fake-nonce")
                .header("location", "https://ca.example.test/accounts/1")
                .body(instant_acme::BodyWrapper::from(
                    serde_json::to_vec(&response).unwrap(),
                ))
                .unwrap();
            Ok(instant_acme::BytesResponse::from(response))
        })
    }
}

impl FakeCa {
    fn builder(&self) -> instant_acme::AccountBuilder {
        Account::builder_with_http(Box::new(self.clone()))
    }
    fn signed_part(&self, path: &str, part: &str) -> Value {
        let calls = self.calls.lock().unwrap();
        let body = &calls.iter().find(|(p, _)| p == path).unwrap().1;
        serde_json::from_slice(
            &BASE64_URL_SAFE_NO_PAD
                .decode(body[part].as_str().unwrap())
                .unwrap(),
        )
        .unwrap()
    }
}

async fn account_runtime() -> Arc<ProxyRuntime> {
    let directory = std::env::temp_dir().join(format!(
        "rentnerproxy-acme-accounts-{}-{}",
        std::process::id(),
        time::OffsetDateTime::now_utc().unix_timestamp_nanos()
    ));
    std::fs::create_dir_all(&directory).unwrap();
    let runtime = ProxyRuntime::new(crate::runtime::RuntimeSettings::new(directory, 0), None);
    runtime.certificate_store.initialize().await.unwrap();
    runtime
}

fn issue_request() -> CertificateIssueRequest {
    CertificateIssueRequest {
        domains: vec!["example.com".to_owned()],
        environment: CertificateEnvironment::Staging,
        contact_email: Some("certs@example.com".to_owned()),
        challenge_type: crate::runtime::certificates::AcmeChallengeType::Http01,
        dns_mode: crate::runtime::certificates::DnsValidationMode::Provider,
        dns_provider: None,
        accept_terms: true,
    }
}

#[tokio::test]
async fn successful_registration_persists_credentials_and_restores_without_reregistering() {
    let runtime = account_runtime().await;
    let request = issue_request();
    let ca = FakeCa::default();
    runtime
        .acme_account_with_builder(&request, DIRECTORY.to_owned(), ca.builder())
        .await
        .unwrap();
    assert_eq!(
        ca.signed_part("/accounts", "payload")["termsOfServiceAgreed"],
        true
    );
    assert_eq!(
        ca.signed_part("/accounts/1", "payload"),
        json!({"contact":["mailto:certs@example.com"]})
    );
    let stored = runtime
        .certificate_store
        .load_acme_account(request.environment)
        .await
        .unwrap()
        .unwrap();
    let credentials: Value = serde_json::from_slice(&stored).unwrap();
    assert_eq!(credentials["id"], "https://ca.example.test/accounts/1");
    assert_eq!(credentials["directory"], DIRECTORY);
    assert!(credentials.get("pendingKeyPkcs8").is_none());
    let restored_ca = FakeCa::default();
    runtime
        .acme_account_with_builder(&request, DIRECTORY.to_owned(), restored_ca.builder())
        .await
        .unwrap();
    assert_eq!(
        restored_ca
            .calls
            .lock()
            .unwrap()
            .iter()
            .map(|(path, _)| path.as_str())
            .collect::<Vec<_>>(),
        vec!["/directory"]
    );
    assert_eq!(
        runtime
            .certificate_store
            .load_acme_account(request.environment)
            .await
            .unwrap()
            .unwrap(),
        stored
    );
}

#[tokio::test]
async fn failed_registration_reuses_durable_key_and_original_contact_on_retry() {
    let runtime = account_runtime().await;
    let mut request = issue_request();
    let rejected = FakeCa {
        reject_registration: true,
        ..FakeCa::default()
    };
    assert!(matches!(
        runtime
            .acme_account_with_builder(&request, DIRECTORY.to_owned(), rejected.builder())
            .await,
        Err(CertificateError::AcmeFailed)
    ));
    let pending = runtime
        .certificate_store
        .load_acme_account(request.environment)
        .await
        .unwrap()
        .unwrap();
    let pending: PendingAccountRegistration = serde_json::from_slice(&pending).unwrap();
    assert!(!pending.pending_key_pkcs8.is_empty());
    request.contact_email = Some("changed@example.com".to_owned());
    let ca = FakeCa::default();
    runtime
        .acme_account_with_builder(&request, DIRECTORY.to_owned(), ca.builder())
        .await
        .unwrap();
    assert_eq!(
        rejected.signed_part("/accounts", "protected")["jwk"],
        ca.signed_part("/accounts", "protected")["jwk"]
    );
    assert_eq!(
        ca.signed_part("/accounts/1", "payload"),
        json!({"contact":["mailto:certs@example.com"]})
    );
    let credentials: AccountCredentials = serde_json::from_slice(
        &runtime
            .certificate_store
            .load_acme_account(request.environment)
            .await
            .unwrap()
            .unwrap(),
    )
    .unwrap();
    assert_eq!(
        credentials.private_key().secret_pkcs8_der(),
        pending.pending_key_pkcs8
    );
}

#[tokio::test]
async fn contact_failure_keeps_pending_registration_for_recovery() {
    let runtime = account_runtime().await;
    let request = issue_request();
    let ca = FakeCa {
        reject_contact: true,
        ..FakeCa::default()
    };
    assert!(matches!(
        runtime
            .acme_account_with_builder(&request, DIRECTORY.to_owned(), ca.builder())
            .await,
        Err(CertificateError::AcmeFailed)
    ));
    let pending = runtime
        .certificate_store
        .load_acme_account(request.environment)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        serde_json::from_slice::<PendingAccountRegistration>(&pending)
            .unwrap()
            .contact_email,
        request.contact_email
    );
}

#[tokio::test]
async fn malformed_or_cross_directory_accounts_are_rejected_before_ca_requests() {
    let runtime = account_runtime().await;
    let request = issue_request();
    for stored in [
        json!({"directory":"https://other.example.test/directory"}),
        json!({"unexpected":true}),
        json!({"directory":DIRECTORY}),
        json!({"directory":DIRECTORY,"pendingKeyPkcs8":[1,2,3],"contactEmail":null}),
    ] {
        runtime
            .certificate_store
            .store_acme_account(request.environment, &serde_json::to_vec(&stored).unwrap())
            .await
            .unwrap();
        let ca = FakeCa::default();
        assert!(matches!(
            runtime
                .acme_account_with_builder(&request, DIRECTORY.to_owned(), ca.builder())
                .await,
            Err(CertificateError::StoreUnavailable)
        ));
        assert!(ca.calls.lock().unwrap().is_empty());
    }
}

fn absolute_root() -> String {
    std::env::temp_dir()
        .join("acme-test-root.pem")
        .to_str()
        .unwrap()
        .to_owned()
}

#[test]
fn staging_and_production_default_to_distinct_ca_directories() {
    for (environment, expected) in [
        (CertificateEnvironment::Staging, LetsEncrypt::Staging.url()),
        (
            CertificateEnvironment::Production,
            LetsEncrypt::Production.url(),
        ),
    ] {
        assert_eq!(
            configured_acme_directory(environment, None, None).unwrap(),
            (expected.to_owned(), None)
        );
    }
}

#[test]
fn private_ca_override_requires_staging_and_both_configuration_values() {
    let url = "https://ca.example.test/directory".to_owned();
    let root = absolute_root();
    assert_eq!(
        configured_acme_directory(
            CertificateEnvironment::Staging,
            Some(url.clone()),
            Some(root.clone())
        )
        .unwrap(),
        (url.clone(), Some(root.clone()))
    );
    for (environment, directory, root) in [
        (
            CertificateEnvironment::Production,
            Some(url.clone()),
            Some(root.clone()),
        ),
        (CertificateEnvironment::Staging, Some(url), None),
        (CertificateEnvironment::Staging, None, Some(root)),
    ] {
        assert_eq!(
            configured_acme_directory(environment, directory, root),
            Err(CertificateError::AcmeFailed)
        );
    }
}

#[test]
fn private_ca_rejects_insecure_ambiguous_and_oversized_configuration() {
    for directory in [
        "http://ca.example.test/directory".to_owned(),
        " https://ca.example.test/directory".to_owned(),
        "https://ca.example.test/directory ".to_owned(),
        "https://user@ca.example.test/directory".to_owned(),
        "/directory".to_owned(),
        "https:///".to_owned(),
        format!("https://ca.example.test/{}", "a".repeat(2048)),
    ] {
        assert_eq!(
            configured_acme_directory(
                CertificateEnvironment::Staging,
                Some(directory),
                Some(absolute_root())
            ),
            Err(CertificateError::AcmeFailed)
        );
    }
    for root in [
        "".to_owned(),
        "   ".to_owned(),
        "relative/root.pem".to_owned(),
        format!("{}{}", absolute_root(), "a".repeat(4096)),
    ] {
        assert_eq!(
            configured_acme_directory(
                CertificateEnvironment::Staging,
                Some("https://ca.example.test/directory".to_owned()),
                Some(root)
            ),
            Err(CertificateError::AcmeFailed)
        );
    }
}

#[tokio::test]
async fn manual_account_identity_binds_key_account_and_directory_but_ignores_json_layout() {
    let runtime = account_runtime().await;
    let request = issue_request();
    runtime
        .acme_account_with_builder(&request, DIRECTORY.to_owned(), FakeCa::default().builder())
        .await
        .unwrap();
    let bytes = runtime
        .certificate_store
        .load_acme_account(request.environment)
        .await
        .unwrap()
        .unwrap();
    let identity = account_identity(&bytes, DIRECTORY).unwrap();
    let mut value: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(
        account_identity(&serde_json::to_vec_pretty(&value).unwrap(), DIRECTORY).unwrap(),
        identity
    );
    value["id"] = json!("https://ca.example.test/accounts/another");
    assert_ne!(
        account_identity(&serde_json::to_vec(&value).unwrap(), DIRECTORY).unwrap(),
        identity
    );
    assert_eq!(
        account_identity(&bytes, "https://other.example/directory"),
        Err(CertificateError::StoreUnavailable)
    );
    assert_eq!(
        account_identity(
            br#"{"directory":"https://ca.example.test/directory","pendingKeyPkcs8":[]}"#,
            DIRECTORY
        ),
        Err(CertificateError::StoreUnavailable)
    );
}

#[tokio::test]
async fn manual_resume_does_not_register_account_when_saved_credentials_are_missing() {
    let runtime = account_runtime().await;
    let request = issue_request();
    let result = runtime
        .manual_acme_account(
            "unused",
            &request,
            Some(&"a".repeat(64)),
            AcmeResponseObserver::default(),
        )
        .await;
    assert!(matches!(result, Err(CertificateError::StoreUnavailable)));
    assert!(
        runtime
            .certificate_store
            .load_acme_account(request.environment)
            .await
            .unwrap()
            .is_none()
    );
}
