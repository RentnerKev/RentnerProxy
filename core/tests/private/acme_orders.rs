use super::*;
use base64::{Engine, prelude::BASE64_URL_SAFE_NO_PAD};
use http_body_util::BodyExt;
use serde_json::{Value, json};

const ID: &str = "0198d98a-0000-7000-8000-000000000199";

#[derive(Clone)]
struct OrderCa {
    authorization: Value,
    calls: Arc<std::sync::Mutex<Vec<(String, Value)>>>,
    failed_path: Option<&'static str>,
    invalid_order: bool,
}

impl OrderCa {
    fn new() -> Self {
        Self {
            authorization: json!({"identifier":{"type":"dns","value":"example.com"},"status":"pending","challenges":[{"type":"http-01","url":"https://ca.example.test/challenge","token":"test-token","status":"pending"}]}),
            calls: Arc::default(),
            failed_path: None,
            invalid_order: false,
        }
    }
    fn order(&self, status: &str) -> Value {
        json!({"status":status,"authorizations":["https://ca.example.test/auth"],"finalize":"https://ca.example.test/finalize","certificate":"https://ca.example.test/cert"})
    }
}

impl instant_acme::HttpClient for OrderCa {
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
            let body = request.into_body().collect().await.unwrap().to_bytes();
            let payload = if body.is_empty() {
                Value::Null
            } else {
                let jose: Value = serde_json::from_slice(&body).unwrap();
                let decoded = BASE64_URL_SAFE_NO_PAD
                    .decode(jose["payload"].as_str().unwrap())
                    .unwrap();
                if decoded.is_empty() {
                    Value::Null
                } else {
                    serde_json::from_slice(&decoded).unwrap()
                }
            };
            ca.calls.lock().unwrap().push((path.clone(), payload));
            let mut status = 200;
            let value = match path.as_str() {
                "/directory" => {
                    json!({"newNonce":"https://ca.example.test/nonce", "newAccount":"https://ca.example.test/account", "newOrder":"https://ca.example.test/orders"})
                }
                "/nonce" => Value::Null,
                "/orders" => ca.order("pending"),
                "/auth" => ca.authorization.clone(),
                "/challenge" => {
                    json!({"type":"http-01","url":"https://ca.example.test/challenge","token":"test-token","status":"valid"})
                }
                "/order/1" => ca.order(if ca.invalid_order {
                    "invalid"
                } else if ca
                    .calls
                    .lock()
                    .unwrap()
                    .iter()
                    .any(|(path, _)| path == "/finalize")
                {
                    "valid"
                } else {
                    "ready"
                }),
                "/finalize" => ca.order("valid"),
                "/cert" => Value::Null,
                _ => panic!("unexpected ACME path {path}"),
            };
            let mut response_body = if path == "/cert" {
                b"-----BEGIN CERTIFICATE-----\nfake-ca-test-chain\n-----END CERTIFICATE-----\n"
                    .to_vec()
            } else {
                serde_json::to_vec(&value).unwrap()
            };
            if ca.failed_path == Some(path.as_str()) {
                status = 400;
                response_body =
                    serde_json::to_vec(&json!({"type":"urn:ietf:params:acme:error:unauthorized"}))
                        .unwrap();
            }
            Ok(instant_acme::BytesResponse::from(
                axum::http::Response::builder()
                    .status(status)
                    .header("replay-nonce", "fake-nonce")
                    .header("location", "https://ca.example.test/order/1")
                    .body(instant_acme::BodyWrapper::from(response_body))
                    .unwrap(),
            ))
        })
    }
}

async fn run_order(
    ca: &OrderCa,
) -> (
    Result<(String, String), CertificateError>,
    Vec<(String, String)>,
    ChallengeStore,
    Arc<ProxyRuntime>,
) {
    let path = std::env::temp_dir().join(format!(
        "rentnerproxy-acme-orders-{}-{}",
        std::process::id(),
        time::OffsetDateTime::now_utc().unix_timestamp_nanos()
    ));
    std::fs::create_dir_all(&path).unwrap();
    let runtime = ProxyRuntime::new(crate::runtime::RuntimeSettings::new(path, 0), None);
    runtime.certificate_store.initialize().await.unwrap();
    let request = CertificateIssueRequest {
        domains: vec!["example.com".to_owned()],
        environment: crate::runtime::certificates::CertificateEnvironment::Staging,
        contact_email: None,
        challenge_type: AcmeChallengeType::Http01,
        dns_mode: crate::runtime::certificates::DnsValidationMode::Provider,
        dns_provider: None,
        accept_terms: true,
    };
    runtime
        .certificate_store
        .begin_issue(ID, request.clone(), false)
        .await
        .unwrap();
    let (_, key) = instant_acme::Key::generate_pkcs8().unwrap();
    let account = instant_acme::Account::builder_with_http(Box::new(ca.clone()))
        .from_parts(
            "https://ca.example.test/account/1".to_owned(),
            key,
            "https://ca.example.test/directory".to_owned(),
        )
        .await
        .unwrap();
    let mut registered = Vec::new();
    let challenges = ChallengeStore::new();
    let result = runtime
        .issue_acme_with_account(
            ID,
            &request,
            &challenges,
            ChallengeRegistrations {
                delegated: BTreeMap::new(),
                http: &mut registered,
                dns: &mut Vec::new(),
            },
            None,
            account,
        )
        .await;
    (result, registered, challenges, runtime)
}

#[tokio::test]
async fn http_order_registers_exact_challenge_and_finalizes_with_generated_csr() {
    let ca = OrderCa::new();
    let (result, registered, challenges, runtime) = run_order(&ca).await;
    let (chain, key) =
        result.unwrap_or_else(|error| panic!("{error:?}: {:?}", ca.calls.lock().unwrap()));
    assert!(chain.contains("fake-ca-test-chain"));
    assert!(rcgen::KeyPair::from_pem(&key).is_ok());
    assert_eq!(
        registered,
        vec![("example.com".to_owned(), "test-token".to_owned())]
    );
    assert!(
        challenges
            .get("example.com", "test-token")
            .await
            .unwrap()
            .starts_with("test-token.")
    );
    let calls = ca.calls.lock().unwrap().clone();
    assert_eq!(
        calls.iter().find(|(p, _)| p == "/orders").unwrap().1["identifiers"],
        json!([{"type":"dns","value":"example.com"}])
    );
    let csr = calls.iter().find(|(p, _)| p == "/finalize").unwrap().1["csr"]
        .as_str()
        .unwrap();
    let csr = BASE64_URL_SAFE_NO_PAD.decode(csr).unwrap();
    use x509_parser::{
        certification_request::X509CertificationRequest,
        extensions::{GeneralName, ParsedExtension},
        prelude::FromDer,
    };
    let (remaining, csr) = X509CertificationRequest::from_der(&csr).unwrap();
    assert!(remaining.is_empty());
    let names = csr
        .requested_extensions()
        .unwrap()
        .find_map(|extension| match extension {
            ParsedExtension::SubjectAlternativeName(names) => Some(names),
            _ => None,
        })
        .unwrap();
    assert_eq!(
        names.general_names,
        vec![GeneralName::DNSName("example.com")]
    );
    assert_eq!(
        runtime
            .certificate_store
            .get(ID)
            .await
            .unwrap()
            .current_operation
            .unwrap()
            .stage,
        CertificateOperationStage::Finalizing
    );
}

#[tokio::test]
async fn already_valid_authorization_skips_challenge_publication() {
    let mut ca = OrderCa::new();
    ca.authorization["status"] = json!("valid");
    let (result, registered, challenges, _) = run_order(&ca).await;
    assert!(result.is_ok(), "{result:?}: {:?}", ca.calls.lock().unwrap());
    assert!(registered.is_empty());
    assert!(challenges.get("example.com", "test-token").await.is_none());
    assert!(
        !ca.calls
            .lock()
            .unwrap()
            .iter()
            .any(|(path, _)| path == "/challenge")
    );
}

#[tokio::test]
async fn unrequested_invalid_and_missing_challenges_stop_before_finalization() {
    for (field, value) in [
        ("identifier", json!({"type":"dns","value":"other.com"})),
        ("status", json!("invalid")),
        ("challenges", json!([])),
        ("wildcard", json!(true)),
    ] {
        let mut ca = OrderCa::new();
        ca.authorization[field] = value;
        let (result, registered, _, _) = run_order(&ca).await;
        assert_eq!(result, Err(CertificateError::AcmeFailed));
        assert!(registered.is_empty());
        assert!(
            !ca.calls
                .lock()
                .unwrap()
                .iter()
                .any(|(path, _)| path == "/finalize")
        );
    }
}

#[tokio::test]
async fn ca_errors_are_mapped_and_registered_challenges_remain_available_for_cleanup() {
    for failed_path in ["/orders", "/auth", "/challenge", "/finalize", "/cert"] {
        let mut ca = OrderCa::new();
        ca.failed_path = Some(failed_path);
        let (result, registered, challenges, _) = run_order(&ca).await;
        assert_eq!(result, Err(CertificateError::AcmeFailed));
        if ["/challenge", "/finalize", "/cert"].contains(&failed_path) {
            assert_eq!(registered.len(), 1);
            assert!(challenges.get("example.com", "test-token").await.is_some());
        } else {
            assert!(registered.is_empty());
        }
    }
    let mut ca = OrderCa::new();
    ca.invalid_order = true;
    assert_eq!(run_order(&ca).await.0, Err(CertificateError::AcmeFailed));
    assert!(
        !ca.calls
            .lock()
            .unwrap()
            .iter()
            .any(|(path, _)| path == "/finalize")
    );
}

#[test]
fn non_dns_and_noncanonical_authorizations_are_rejected_even_if_requested() {
    let ip = Identifier::Ip("127.0.0.1".parse().unwrap());
    assert_eq!(
        requested_identifier(&ip.authorized(false), &["127.0.0.1".to_owned()]),
        Err(CertificateError::AcmeFailed)
    );
    for name in [
        "EXAMPLE.com",
        "example.com.",
        "127.0.0.1",
        "bad_label.example.com",
        "",
        "*.example.com",
    ] {
        let identifier = Identifier::Dns(name.to_owned());
        assert_eq!(
            requested_identifier(&identifier.authorized(false), &[name.to_owned()]),
            Err(CertificateError::AcmeFailed)
        );
    }
}

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
