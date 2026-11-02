use super::*;
use crate::runtime::{
    certificates::{CertificateEnvironment, CertificateOperation},
    dns::{DnsDelegationBinding, DnsProviderConfig},
};
use axum::{Json, Router, extract::State, routing::get};
use hickory_resolver::proto::{
    op::Message,
    rr::{
        Name, RData, Record, RecordType,
        rdata::{CNAME, NS, SOA, TXT},
    },
};
use std::sync::atomic::{AtomicUsize, Ordering};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    task::JoinHandle,
};

const ORIGINAL: &str = "_acme-challenge.example.com";
const TARGET: &str = "proof.validation.example.net";
const ZONE: &str = "validation.example.net";
const CHILD: &str = "RENTNERPROXY_DNS_ORDER_CHILD";
const ENDPOINT: &str = "RENTNERPROXY_DNS_ORDER_ENDPOINT";

#[derive(Default)]
struct DnsState {
    zone: &'static str,
    records: std::sync::Mutex<Vec<Value>>,
    propagated: std::sync::Mutex<Vec<String>>,
    posts: AtomicUsize,
    txt_queries: AtomicUsize,
}

struct Fixture {
    tasks: Vec<JoinHandle<()>>,
    state: Arc<DnsState>,
    dns: std::net::SocketAddr,
    endpoint: String,
}

impl Drop for Fixture {
    fn drop(&mut self) {
        for task in &self.tasks {
            task.abort();
        }
    }
}

fn name(value: &str) -> Name {
    Name::from_ascii(format!("{value}.")).unwrap()
}
fn record(owner: &str, data: RData) -> Record {
    Record::from_rdata(name(owner), 0, data)
}
fn soa() -> Record {
    record(
        ZONE,
        RData::SOA(SOA::new(
            name("ns.example.net"),
            name("hostmaster.example.net"),
            1,
            60,
            60,
            300,
            0,
        )),
    )
}

fn dns_response(request: Message, state: &DnsState) -> Message {
    let mut response = Message::response(request.metadata.id, request.metadata.op_code);
    response.metadata.recursion_desired = request.metadata.recursion_desired;
    response.metadata.recursion_available = true;
    response.metadata.authoritative = true;
    response.add_queries(request.queries.clone());
    let query = &request.queries[0];
    let owner = query.name().to_ascii().trim_end_matches('.').to_owned();
    match query.query_type() {
        RecordType::CNAME if owner == ORIGINAL => {
            response.add_answer(record(ORIGINAL, RData::CNAME(CNAME(name(TARGET)))));
        }
        RecordType::SOA if owner == ZONE => {
            response.add_answer(soa());
        }
        RecordType::NS => {
            response.add_answer(record(ZONE, RData::NS(NS(name("ns.example.net")))));
        }
        RecordType::TXT => {
            let attempt = state.txt_queries.fetch_add(1, Ordering::SeqCst);
            response.add_answer(record(ORIGINAL, RData::CNAME(CNAME(name(TARGET)))));
            if attempt > 0 {
                for proof in state.records.lock().unwrap().iter() {
                    state
                        .propagated
                        .lock()
                        .unwrap()
                        .push(proof["content"].as_str().unwrap().to_owned());
                    response.add_answer(record(
                        TARGET,
                        RData::TXT(TXT::new(vec![
                            proof["content"].as_str().unwrap().to_owned(),
                        ])),
                    ));
                }
            }
            response.add_authority(soa());
        }
        _ => {
            response.add_authority(soa());
        }
    }
    response
}

impl Fixture {
    async fn start(test: &str) -> Self {
        let state = Arc::new(DnsState {
            zone: if test.starts_with("direct_dns_") {
                "example.com"
            } else {
                ZONE
            },
            ..DnsState::default()
        });
        let (tcp, udp) =
            crate::tests::fixtures::reserve_dns_socket_pair("127.0.0.1:0".parse().unwrap())
                .await
                .unwrap();
        let dns = tcp.local_addr().unwrap();
        let udp_state = Arc::clone(&state);
        let udp_task = tokio::spawn(async move {
            let mut bytes = vec![0; 65535];
            loop {
                let (length, peer) = udp.recv_from(&mut bytes).await.unwrap();
                let response =
                    dns_response(Message::from_vec(&bytes[..length]).unwrap(), &udp_state)
                        .to_vec()
                        .unwrap();
                udp.send_to(&response, peer).await.unwrap();
            }
        });
        let tcp_state = Arc::clone(&state);
        let tcp_task = tokio::spawn(async move {
            loop {
                let (mut stream, _) = tcp.accept().await.unwrap();
                let length = stream.read_u16().await.unwrap();
                let mut bytes = vec![0; usize::from(length)];
                stream.read_exact(&mut bytes).await.unwrap();
                let response = dns_response(Message::from_vec(&bytes).unwrap(), &tcp_state)
                    .to_vec()
                    .unwrap();
                stream
                    .write_u16(u16::try_from(response.len()).unwrap())
                    .await
                    .unwrap();
                stream.write_all(&response).await.unwrap();
            }
        });
        let router = Router::new()
            .route("/observations", get(|State(state): State<Arc<DnsState>>| async move {
                Json(json!({"records":state.records.lock().unwrap().clone(),"propagated":state.propagated.lock().unwrap().clone(),"txt_queries":state.txt_queries.load(Ordering::SeqCst)}))
            }))
            .route("/zones/{zone}", get(|State(state): State<Arc<DnsState>>| async move { Json(json!({"success":true,"result":{"id":"0123456789abcdef0123456789abcdef","name":state.zone}})) }))
            .route("/zones/{zone}/dns_records", get(|State(state): State<Arc<DnsState>>| async move {
                Json(json!({"success":true,"result":state.records.lock().unwrap().clone(),"result_info":{"page":1,"total_pages":1}}))
            }).post(|State(state): State<Arc<DnsState>>, Json(mut body): Json<Value>| async move {
                body["id"] = json!(format!("proof-{}", state.posts.fetch_add(1, Ordering::SeqCst)));
                state.records.lock().unwrap().push(body.clone());
                Json(json!({"success":true,"result":body}))
            }))
            .with_state(Arc::clone(&state));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = format!("http://{}/", listener.local_addr().unwrap());
        let http_task = tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });
        Self {
            tasks: vec![udp_task, tcp_task, http_task],
            state,
            dns,
            endpoint,
        }
    }
}

async fn isolated(test: &str) -> Option<Fixture> {
    if std::env::var_os(CHILD).is_some() {
        return None;
    }
    let fixture = Fixture::start(test).await;
    let mut child = tokio::process::Command::new(std::env::current_exe().unwrap());
    child
        .args([
            "--exact",
            &format!("runtime::acme::order::dns_authorization_tests::dns_orders::{test}"),
            "--nocapture",
        ])
        .env(CHILD, "1")
        .env(ENDPOINT, &fixture.endpoint)
        .env(
            "APP_ENCRYPTION_KEY",
            base64::engine::general_purpose::STANDARD.encode([7_u8; 32]),
        )
        .env_remove("APP_ENCRYPTION_KEY_FILE")
        .env(
            "RENTNERPROXY_ACME_TEST_DIRECTORY_URL",
            "https://ca.example.test/directory",
        )
        .env(
            "RENTNERPROXY_ACME_TEST_ROOT_CERT",
            std::env::temp_dir().join("unused-dns-order-root.pem"),
        )
        .env("RENTNERPROXY_ACME_TEST_DNS_ADDR", fixture.dns.to_string())
        .kill_on_drop(true);
    let output = tokio::time::timeout(Duration::from_secs(45), child.output())
        .await
        .unwrap()
        .unwrap();
    assert!(
        output.status.success(),
        "isolated DNS order failed: {} {}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    Some(fixture)
}

fn provider() -> DnsProvider {
    DnsProvider::for_connection_check(
        DnsProviderConfig::Cloudflare {
            zone_id: "0123456789abcdef0123456789abcdef".to_owned(),
            api_token: "fixture-token".to_owned(),
        },
        &std::env::var(ENDPOINT).unwrap(),
    )
    .unwrap()
}

fn dns_ca() -> OrderCa {
    let mut ca = OrderCa::new();
    ca.authorization["challenges"][0]["type"] = json!("dns-01");
    ca
}

fn observe_delegated_ready(runtime: Arc<ProxyRuntime>) -> ChallengeObserver {
    Arc::new(move || {
        let runtime = Arc::clone(&runtime);
        Box::pin(async move {
            let path = runtime
                .settings
                .state_dir
                .join("certificates/certificate-metadata.json");
            let persisted: Value = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
            let intents: Vec<DnsRecordIntent> = serde_json::from_value(
                persisted["certificates"][ID]["acme"]["pendingDnsRecords"].clone(),
            )
            .unwrap();
            assert_eq!(intents.len(), 1);
            let intent = &intents[0];
            assert!(!intent.unconfirmed_write);
            assert_eq!(intent.delegation.as_ref().unwrap().original_owner, ORIGINAL);
            assert_eq!(intent.delegation.as_ref().unwrap().target_owner, TARGET);
            let observations: Value = reqwest::Client::new()
                .get(format!("{}observations", std::env::var(ENDPOINT).unwrap()))
                .timeout(Duration::from_secs(3))
                .send()
                .await
                .unwrap()
                .error_for_status()
                .unwrap()
                .json()
                .await
                .unwrap();
            assert!(observations["txt_queries"].as_u64().unwrap() >= 2);
            assert!(
                observations["propagated"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|value| value.as_str() == Some(intent.value.as_str()))
            );
            assert!(
                observations["records"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|record| {
                        record["type"] == "TXT"
                            && record["name"] == TARGET
                            && record["content"] == intent.value
                            && record["comment"] == intent.marker
                    })
            );
        })
    })
}

#[tokio::test]
async fn delegated_dns_order_retries_propagation_and_persists_exact_proof_before_validation() {
    if let Some(fixture) = isolated(
        "delegated_dns_order_retries_propagation_and_persists_exact_proof_before_validation",
    )
    .await
    {
        assert_eq!(fixture.state.posts.load(Ordering::SeqCst), 1);
        assert!(fixture.state.txt_queries.load(Ordering::SeqCst) >= 2);
        let records = fixture.state.records.lock().unwrap();
        assert_eq!(records[0]["name"], TARGET);
        assert_eq!(records[0]["type"], "TXT");
        assert_eq!(records[0]["content"].as_str().unwrap().len(), 43);
        return;
    }
    let ca = dns_ca();
    let (result, registered, challenges, runtime) = run_order_with_dns_observer(
        &ca,
        Some((&provider(), DnsValidationMode::Delegated)),
        Some(observe_delegated_ready),
    )
    .await;
    assert!(result.is_ok(), "{result:?}");
    assert!(registered.is_empty());
    assert!(challenges.get("example.com", "test-token").await.is_none());
    let intents = runtime
        .certificate_store
        .pending_dns_records(ID)
        .await
        .unwrap();
    assert_eq!(intents.len(), 1);
    assert!(!intents[0].unconfirmed_write);
    assert_eq!(intents[0].delegation.as_ref().unwrap().target_owner, TARGET);
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
    let calls = ca.calls.lock().unwrap();
    assert_eq!(
        calls
            .iter()
            .filter(|(path, _)| path == "/challenge")
            .count(),
        1
    );
    assert_eq!(
        calls.iter().filter(|(path, _)| path == "/finalize").count(),
        1
    );
}

#[tokio::test]
async fn valid_dns_authorization_never_writes_or_validates_a_new_proof() {
    if let Some(fixture) =
        isolated("valid_dns_authorization_never_writes_or_validates_a_new_proof").await
    {
        assert_eq!(fixture.state.posts.load(Ordering::SeqCst), 0);
        assert_eq!(fixture.state.txt_queries.load(Ordering::SeqCst), 0);
        return;
    }
    let mut ca = dns_ca();
    ca.authorization["status"] = json!("valid");
    let (result, registered, _, runtime) =
        run_order_with_dns(&ca, Some((&provider(), DnsValidationMode::Delegated))).await;
    assert!(result.is_ok());
    assert!(registered.is_empty());
    assert!(
        runtime
            .certificate_store
            .pending_dns_records(ID)
            .await
            .unwrap()
            .is_empty()
    );
    assert!(
        !ca.calls
            .lock()
            .unwrap()
            .iter()
            .any(|(path, _)| path == "/challenge")
    );
}

#[tokio::test]
async fn direct_dns_order_journals_proof_and_validates_after_propagation_wait() {
    if let Some(fixture) =
        isolated("direct_dns_order_journals_proof_and_validates_after_propagation_wait").await
    {
        assert_eq!(fixture.state.posts.load(Ordering::SeqCst), 1);
        assert_eq!(fixture.state.txt_queries.load(Ordering::SeqCst), 0);
        assert_eq!(fixture.state.records.lock().unwrap()[0]["name"], ORIGINAL);
        return;
    }
    let ca = dns_ca();
    let (result, registered, _, runtime) =
        run_order_with_dns(&ca, Some((&provider(), DnsValidationMode::Provider))).await;
    assert!(result.is_ok());
    assert!(registered.is_empty());
    let intents = runtime
        .certificate_store
        .pending_dns_records(ID)
        .await
        .unwrap();
    assert_eq!(intents.len(), 1);
    assert!(intents[0].delegation.is_none());
    assert!(!intents[0].unconfirmed_write);
    assert_eq!(
        ca.calls
            .lock()
            .unwrap()
            .iter()
            .filter(|(path, _)| path == "/challenge")
            .count(),
        1
    );
}

#[tokio::test]
async fn dns_authorization_errors_do_not_finalize_or_publish_unrequested_proofs() {
    if isolated("dns_authorization_errors_do_not_finalize_or_publish_unrequested_proofs")
        .await
        .is_some()
    {
        return;
    }
    for (field, value) in [
        (
            "identifier",
            json!({"type":"dns","value":"attacker.example"}),
        ),
        ("status", json!("invalid")),
        ("challenges", json!([])),
    ] {
        let mut ca = dns_ca();
        ca.authorization[field] = value;
        let (result, registered, _, runtime) =
            run_order_with_dns(&ca, Some((&provider(), DnsValidationMode::Delegated))).await;
        assert_eq!(result, Err(CertificateError::AcmeFailed));
        assert!(registered.is_empty());
        assert!(
            runtime
                .certificate_store
                .pending_dns_records(ID)
                .await
                .unwrap()
                .is_empty()
        );
        assert!(
            !ca.calls
                .lock()
                .unwrap()
                .iter()
                .any(|(path, _)| path == "/challenge" || path == "/finalize")
        );
    }
}

#[tokio::test]
async fn delegated_wait_rejects_cancelled_or_invalid_work_without_waiting() {
    if isolated("delegated_wait_rejects_cancelled_or_invalid_work_without_waiting")
        .await
        .is_some()
    {
        return;
    }
    let mut ca = dns_ca();
    ca.failed_path = Some("/challenge");
    ca.calls.lock().unwrap().clear();
    let (_, _, _, runtime) =
        run_order_with_dns(&ca, Some((&provider(), DnsValidationMode::Delegated))).await;
    let operation = runtime
        .certificate_store
        .get(ID)
        .await
        .unwrap()
        .current_operation
        .unwrap()
        .id;
    let mut intent = runtime
        .certificate_store
        .pending_dns_record(ID, &operation)
        .await
        .unwrap();
    let binding = intent.delegation.clone().unwrap();
    let mut changed: DnsDelegationBinding = binding.clone();
    changed.target_owner = "changed.validation.example.net".to_owned();
    assert_eq!(
        crate::runtime::acme::delegated::recheck(&changed, CertificateEnvironment::Staging).await,
        Err(CertificateError::DnsDelegationInvalid)
    );
    intent.delegation = Some(binding);
    let too_many = vec![intent; 257];
    assert_eq!(
        crate::runtime::acme::delegated::wait_for_records(
            &too_many,
            CertificateEnvironment::Staging,
            &runtime.certificate_store,
            ID
        )
        .await,
        Err(CertificateError::DnsDelegationInvalid)
    );
    runtime
        .certificate_store
        .request_delegated_cancel(ID, &operation)
        .await
        .unwrap();
    assert_eq!(
        crate::runtime::acme::delegated::wait_for_records(
            &[],
            CertificateEnvironment::Staging,
            &runtime.certificate_store,
            ID
        )
        .await,
        Err(CertificateError::AcmeCancelled)
    );
    assert_eq!(
        runtime.certificate_store.get(ID).await.unwrap().operation,
        CertificateOperation::Issuing
    );
}
