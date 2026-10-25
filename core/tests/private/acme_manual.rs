use super::*;
use base64::{Engine, prelude::BASE64_URL_SAFE_NO_PAD};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use std::sync::Mutex;

const ID: &str = "0198d98a-0000-7000-8000-000000000281";
const DIRECTORY: &str = "https://ca.example.test/directory";

struct CaState {
    status: String,
    calls: Vec<(String, Value)>,
    fail_finalization_response: bool,
}

#[derive(Clone)]
struct ManualCa {
    state: Arc<Mutex<CaState>>,
    observer: AcmeResponseObserver,
    expires: Option<String>,
    key: Vec<u8>,
}

impl ManualCa {
    fn new() -> Self {
        let (_, key) = instant_acme::Key::generate_pkcs8().unwrap();
        Self {
            state: Arc::new(Mutex::new(CaState {
                status: "pending".to_owned(),
                calls: Vec::new(),
                fail_finalization_response: false,
            })),
            observer: AcmeResponseObserver::default(),
            expires: Some(
                (OffsetDateTime::now_utc() + time::Duration::days(2))
                    .format(&Rfc3339)
                    .unwrap(),
            ),
            key: key.secret_pkcs8_der().to_vec(),
        }
    }

    async fn account(&self) -> instant_acme::Account {
        instant_acme::Account::builder_with_http(Box::new(self.clone()))
            .from_parts(
                "https://ca.example.test/account/1".to_owned(),
                rustls::pki_types::PrivatePkcs8KeyDer::from(self.key.clone()),
                DIRECTORY.to_owned(),
            )
            .await
            .unwrap()
    }

    fn count(&self, path: &str) -> usize {
        self.state
            .lock()
            .unwrap()
            .calls
            .iter()
            .filter(|(call, _)| call == path)
            .count()
    }
}

impl instant_acme::HttpClient for ManualCa {
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
            let url = request.uri().to_string();
            let path = request.uri().path().to_owned();
            let body = request.into_body().collect().await.unwrap().to_bytes();
            let payload = if body.is_empty() {
                Value::Null
            } else {
                let jose: Value = serde_json::from_slice(&body).unwrap();
                let payload = BASE64_URL_SAFE_NO_PAD
                    .decode(jose["payload"].as_str().unwrap())
                    .unwrap();
                if payload.is_empty() {
                    Value::Null
                } else {
                    serde_json::from_slice(&payload).unwrap()
                }
            };
            let mut state = ca.state.lock().unwrap();
            state.calls.push((path.clone(), payload));
            if path.starts_with("/challenge/")
                && state
                    .calls
                    .iter()
                    .filter(|(path, _)| path.starts_with("/challenge/"))
                    .count()
                    == 2
            {
                state.status = "ready".to_owned();
            }
            if path == "/finalize" {
                state.status = "processing".to_owned();
                if state.fail_finalization_response {
                    return Err(instant_acme::Error::Str(
                        "interrupted response after CA accepted CSR",
                    ));
                }
                state.status = "valid".to_owned();
            }
            let mut response = match path.as_str() {
                "/directory" => {
                    json!({"newNonce":"https://ca.example.test/nonce","newAccount":"https://ca.example.test/accounts","newOrder":"https://ca.example.test/orders"})
                }
                "/nonce" => Value::Null,
                "/orders" | "/order/1" | "/finalize" => {
                    let mut value = json!({"status":state.status,"authorizations":["https://ca.example.test/auth/apex","https://ca.example.test/auth/wildcard"],"finalize":"https://ca.example.test/finalize","certificate":"https://ca.example.test/cert"});
                    if let Some(expires) = &ca.expires {
                        value["expires"] = json!(expires);
                    }
                    value
                }
                "/auth/apex" | "/auth/wildcard" => {
                    let wildcard = path.ends_with("wildcard");
                    json!({"identifier":{"type":"dns","value":"example.com"},"wildcard":wildcard,"status":if state.status == "pending" {"pending"} else {"valid"},"challenges":[{"type":"dns-01","url":format!("https://ca.example.test/challenge/{}", if wildcard {"wildcard"} else {"apex"}),"token":if wildcard {"wildcard-token"} else {"apex-token"},"status":"pending"}]})
                }
                "/challenge/apex" | "/challenge/wildcard" => {
                    json!({"type":"dns-01","url":url,"token":"token","status":"processing"})
                }
                "/cert" => Value::Null,
                _ => panic!("unexpected ACME path {path}"),
            };
            if path.starts_with("/auth/")
                && let Some(expires) = &ca.expires
            {
                response["expires"] = json!(expires);
            }
            let bytes = if path == "/cert" {
                b"fake-certificate-chain".to_vec()
            } else {
                serde_json::to_vec(&response).unwrap()
            };
            let location = (path == "/orders").then_some("https://ca.example.test/order/1");
            ca.observer.observe(&url, location, &bytes);
            let mut builder = axum::http::Response::builder()
                .status(200)
                .header("replay-nonce", "nonce");
            if let Some(location) = location {
                builder = builder.header("location", location);
            }
            Ok(instant_acme::BytesResponse::from(
                builder
                    .body(instant_acme::BodyWrapper::from(bytes))
                    .unwrap(),
            ))
        })
    }
}

fn request() -> CertificateIssueRequest {
    CertificateIssueRequest {
        domains: vec!["example.com".to_owned(), "*.example.com".to_owned()],
        environment: crate::runtime::certificates::CertificateEnvironment::Staging,
        contact_email: None,
        challenge_type: crate::runtime::certificates::AcmeChallengeType::Dns01,
        dns_mode: crate::runtime::certificates::DnsValidationMode::Manual,
        dns_provider: None,
        accept_terms: true,
    }
}

async fn setup() -> (
    Arc<ProxyRuntime>,
    CertificateIssueRequest,
    String,
    std::path::PathBuf,
) {
    let path = std::env::temp_dir().join(format!(
        "rentnerproxy-manual-dns-{}-{}",
        std::process::id(),
        OffsetDateTime::now_utc().unix_timestamp_nanos()
    ));
    std::fs::create_dir_all(&path).unwrap();
    let runtime = ProxyRuntime::new(crate::runtime::RuntimeSettings::new(path.clone(), 0), None);
    runtime.certificate_store.initialize().await.unwrap();
    let request = request();
    let metadata = runtime
        .certificate_store
        .begin_issue(ID, request.clone(), false)
        .await
        .unwrap();
    (
        runtime,
        request,
        metadata.current_operation.unwrap().id,
        path,
    )
}

async fn prepare(
    runtime: &ProxyRuntime,
    request: &CertificateIssueRequest,
    operation: &str,
    ca: &ManualCa,
) -> Result<ManualOutcome, CertificateError> {
    runtime
        .prepare_manual_dns_with_account(
            ID,
            request,
            operation,
            ManualAccount {
                account: ca.account().await,
                identity: "a".repeat(64),
                directory: DIRECTORY.to_owned(),
                observer: ca.observer.clone(),
            },
        )
        .await
}

async fn begin_continue(runtime: &ProxyRuntime) -> (CertificateIssueRequest, ManualDnsOrder) {
    let (_, saved) = runtime
        .certificate_store
        .load_manual_dns_order(ID)
        .await
        .unwrap()
        .unwrap();
    let action = ManualDnsActionRequest {
        operation_id: saved.operation_id,
        challenge_set_id: saved.challenge_set_id,
    };
    let (_, request, order) = runtime
        .certificate_store
        .begin_manual_dns_continuation(ID, &action)
        .await
        .unwrap()
        .unwrap();
    (request, order)
}

#[tokio::test]
async fn manual_order_parks_without_ca_validation_and_keeps_apex_wildcard_values() {
    let (runtime, request, operation, _) = setup().await;
    let ca = ManualCa::new();
    assert!(matches!(
        prepare(&runtime, &request, &operation, &ca).await.unwrap(),
        ManualOutcome::Paused
    ));
    let (_, saved) = runtime
        .certificate_store
        .load_manual_dns_order(ID)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(saved.phase, ManualDnsPhase::AwaitingInput);
    assert_eq!(Some(saved.expires_at.as_str()), ca.expires.as_deref());
    assert_eq!(saved.records.len(), 2);
    assert_eq!(saved.records[0].owner, "_acme-challenge.example.com");
    assert_eq!(saved.records[0].owner, saved.records[1].owner);
    assert_ne!(saved.records[0].value, saved.records[1].value);
    assert_ne!(saved.records[0].identifier, saved.records[1].identifier);
    assert!(saved.private_key_pem.is_none());
    assert_eq!(ca.count("/challenge/apex"), 0);
    assert_eq!(ca.count("/finalize"), 0);
}

#[tokio::test]
async fn missing_wrong_or_unavailable_txt_never_calls_set_ready_and_can_retry() {
    let (runtime, request, operation, _) = setup().await;
    let ca = ManualCa::new();
    prepare(&runtime, &request, &operation, &ca).await.unwrap();
    for error in [
        CertificateError::ManualDnsNotPropagated,
        CertificateError::ManualDnsLookupFailed,
        CertificateError::ManualDnsNotPropagated,
    ] {
        let (_, mut saved) = begin_continue(&runtime).await;
        let mut order = ca
            .account()
            .await
            .order(saved.order_url.clone())
            .await
            .unwrap();
        assert!(
            runtime
                .validate_manual_dns_check(ID, &mut order, &mut saved, Err(error))
                .await
                .unwrap()
        );
        let (_, saved) = runtime
            .certificate_store
            .load_manual_dns_order(ID)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(saved.phase, ManualDnsPhase::AwaitingInput);
        assert_eq!(saved.last_error_code.as_deref(), Some(error.code()));
        assert!(saved.last_checked_at.is_some());
    }
    assert_eq!(ca.count("/orders"), 1);
    assert_eq!(ca.count("/challenge/apex"), 0);
    assert_eq!(ca.count("/finalize"), 0);
    assert_eq!(
        runtime
            .certificate_store
            .events(None, 200)
            .await
            .unwrap()
            .events
            .iter()
            .filter(|event| event.kind
                == crate::runtime::certificates::CertificateEventKind::OperatorActionRequired)
            .count(),
        1
    );
}

#[tokio::test]
async fn paused_restart_keeps_exact_same_order_and_challenge_set() {
    let (runtime, request, operation, path) = setup().await;
    let ca = ManualCa::new();
    prepare(&runtime, &request, &operation, &ca).await.unwrap();
    let (_, before) = runtime
        .certificate_store
        .load_manual_dns_order(ID)
        .await
        .unwrap()
        .unwrap();
    drop(runtime);
    let restored = ProxyRuntime::new(crate::runtime::RuntimeSettings::new(path, 0), None);
    restored.certificate_store.initialize().await.unwrap();
    let (_, after) = restored
        .certificate_store
        .load_manual_dns_order(ID)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(before.order_url, after.order_url);
    assert_eq!(before.records, after.records);
    assert_eq!(before.challenge_set_id, after.challenge_set_id);
    assert_eq!(after.phase, ManualDnsPhase::AwaitingInput);
    assert!(
        restored
            .certificate_store
            .pending_manual_dns_resume_ids()
            .await
            .unwrap()
            .is_empty()
    );
    assert_eq!(ca.count("/orders"), 1);
}

#[tokio::test]
async fn interrupted_finalization_recovers_saved_key_without_second_finalize() {
    let (runtime, request, operation, path) = setup().await;
    let ca = ManualCa::new();
    prepare(&runtime, &request, &operation, &ca).await.unwrap();
    let (_, mut saved) = begin_continue(&runtime).await;
    let mut order = ca
        .account()
        .await
        .order(saved.order_url.clone())
        .await
        .unwrap();
    assert!(
        !runtime
            .validate_manual_dns_check(ID, &mut order, &mut saved, Ok(()))
            .await
            .unwrap()
    );
    ca.state.lock().unwrap().fail_finalization_response = true;
    assert!(matches!(
        runtime
            .finish_manual_order(ID, &request, &mut order, saved)
            .await,
        Err(CertificateError::AcmeFailed)
    ));
    let (_, saved) = runtime
        .certificate_store
        .load_manual_dns_order(ID)
        .await
        .unwrap()
        .unwrap();
    let original_key = saved.private_key_pem.clone().unwrap();
    assert_eq!(saved.phase, ManualDnsPhase::Finalizing);
    assert!(saved.csr_der.is_some());
    drop(runtime);
    ca.state.lock().unwrap().status = "valid".to_owned();
    let restored = ProxyRuntime::new(crate::runtime::RuntimeSettings::new(path, 0), None);
    restored.certificate_store.initialize().await.unwrap();
    let (request, saved) = restored
        .certificate_store
        .begin_manual_dns_recovery(ID)
        .await
        .unwrap()
        .unwrap();
    let result = restored
        .resume_manual_dns_with_account(
            ID,
            &request,
            saved,
            ManualAccount {
                account: ca.account().await,
                identity: "a".repeat(64),
                directory: DIRECTORY.to_owned(),
                observer: ca.observer.clone(),
            },
        )
        .await
        .unwrap();
    let ManualOutcome::Issued(certificate, recovered_key) = result else {
        panic!("expected recovered certificate");
    };
    assert_eq!(certificate, "fake-certificate-chain");
    assert_eq!(recovered_key, original_key);
    assert_eq!(ca.count("/orders"), 1);
    assert_eq!(ca.count("/finalize"), 1);
}

#[tokio::test]
async fn ca_expiry_is_required_and_expired_orders_are_rejected_before_challenges() {
    for expires in [None, Some("2020-01-01T00:00:00Z".to_owned())] {
        let (runtime, request, operation, _) = setup().await;
        let mut ca = ManualCa::new();
        ca.expires = expires;
        let result = prepare(&runtime, &request, &operation, &ca).await;
        let error = match result {
            Err(error) => error,
            _ => panic!("expected expiry rejection"),
        };
        assert!(matches!(
            error,
            CertificateError::ManualDnsOrderInvalid | CertificateError::ManualDnsExpired
        ));
        assert_eq!(ca.count("/auth/apex"), 0);
        assert_eq!(ca.count("/challenge/apex"), 0);
    }
}

#[test]
fn order_urls_reject_cross_origin_credentials_fragments_and_insecure_schemes() {
    for url in [
        "https://attacker.example/order/1",
        "https://user:password@ca.example.test/order/1",
        "https://ca.example.test/order/1#fragment",
        "http://ca.example.test/order/1",
    ] {
        assert_eq!(
            require_same_origin(url, DIRECTORY),
            Err(CertificateError::ManualDnsOrderInvalid)
        );
    }
    assert!(require_same_origin("https://ca.example.test/order/1", DIRECTORY).is_ok());
}

#[tokio::test]
async fn reusable_valid_authorizations_finish_without_operator_action() {
    let (runtime, request, operation, _) = setup().await;
    let ca = ManualCa::new();
    ca.state.lock().unwrap().status = "ready".to_owned();
    assert!(matches!(
        prepare(&runtime, &request, &operation, &ca).await.unwrap(),
        ManualOutcome::Issued(_, _)
    ));
    let (_, saved) = runtime
        .certificate_store
        .load_manual_dns_order(ID)
        .await
        .unwrap()
        .unwrap();
    assert!(saved.records.is_empty());
    assert_eq!(saved.phase, ManualDnsPhase::Finalizing);
    assert_eq!(ca.count("/challenge/apex"), 0);
    assert_eq!(ca.count("/finalize"), 1);
}

#[tokio::test]
async fn incomplete_preparation_restart_collects_same_order_then_parks_without_validation() {
    let (runtime, request, operation, path) = setup().await;
    let ca = ManualCa::new();
    let identifiers = request
        .domains
        .iter()
        .cloned()
        .map(Identifier::Dns)
        .collect::<Vec<_>>();
    let order = ca
        .account()
        .await
        .new_order(&NewOrder::new(&identifiers))
        .await
        .unwrap();
    let saved = ManualDnsOrder {
        version: 1,
        operation_id: operation.clone(),
        challenge_set_id: operation,
        account_identity: "a".repeat(64),
        order_url: order.url().to_owned(),
        expires_at: ca.expires.clone().unwrap(),
        records: Vec::new(),
        phase: ManualDnsPhase::CheckingDns,
        private_key_pem: None,
        csr_der: None,
        last_checked_at: None,
        last_error_code: None,
    };
    runtime
        .certificate_store
        .store_manual_dns_order(ID, saved)
        .await
        .unwrap();
    drop(runtime);
    let restored = ProxyRuntime::new(crate::runtime::RuntimeSettings::new(path, 0), None);
    restored.certificate_store.initialize().await.unwrap();
    let (request, saved) = restored
        .certificate_store
        .begin_manual_dns_recovery(ID)
        .await
        .unwrap()
        .unwrap();
    let outcome = restored
        .resume_manual_dns_with_account(
            ID,
            &request,
            saved,
            ManualAccount {
                account: ca.account().await,
                identity: "a".repeat(64),
                directory: DIRECTORY.to_owned(),
                observer: ca.observer.clone(),
            },
        )
        .await
        .unwrap();
    assert!(matches!(outcome, ManualOutcome::Paused));
    let (_, saved) = restored
        .certificate_store
        .load_manual_dns_order(ID)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(saved.phase, ManualDnsPhase::AwaitingInput);
    assert_eq!(saved.records.len(), 2);
    assert_eq!(ca.count("/orders"), 1);
    assert_eq!(ca.count("/challenge/apex"), 0);
}

#[tokio::test]
async fn expiry_during_dns_lookup_stops_before_set_ready() {
    let (runtime, request, operation, _) = setup().await;
    let ca = ManualCa::new();
    prepare(&runtime, &request, &operation, &ca).await.unwrap();
    let (_, mut saved) = begin_continue(&runtime).await;
    let mut order = ca
        .account()
        .await
        .order(saved.order_url.clone())
        .await
        .unwrap();
    saved.expires_at = "2020-01-01T00:00:00Z".to_owned();
    assert_eq!(
        runtime
            .validate_manual_dns_check(ID, &mut order, &mut saved, Ok(()))
            .await,
        Err(CertificateError::ManualDnsExpired)
    );
    assert_eq!(ca.count("/challenge/apex"), 0);
    assert_eq!(ca.count("/finalize"), 0);
}
