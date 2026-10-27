use super::*;
use crate::{
    config::Config,
    runtime::{
        RuntimeSettings,
        certificates::{
            AcmeChallengeType, CertificateIssueRequest, ManualDnsOrder, ManualDnsPhase,
        },
        dns::{DnsProvider, DnsProviderConfig},
        dns_connections::{SaveRequest, Store},
    },
    server::{AppState, app_with_state},
    tests::fixtures::reserve_dns_socket_pair,
};
use axum::{
    Json, Router,
    body::{Body, to_bytes},
    http::{Method, Request, StatusCode},
    routing::get,
};
use hickory_resolver::{
    TokioResolver,
    config::{NameServerConfig, ResolverConfig},
    net::runtime::TokioRuntimeProvider,
    proto::{
        op::Message,
        rr::{
            Name, RData, Record, RecordType,
            rdata::{CNAME, NS, SOA, TXT},
        },
    },
};
use serde_json::{Value, json};
use std::{
    net::SocketAddr,
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
    sync::{Notify, Semaphore},
    task::JoinHandle,
};
use tower::ServiceExt;

const CONNECTION: &str = "0198d98a-0000-7000-8000-000000000284";
const CERTIFICATE: &str = "0198d98a-0000-7000-8000-000000000285";
const ACTOR: &str = "0198d98a-0000-7000-8000-000000000286";
const ZONE_ID: &str = "0123456789abcdef0123456789abcdef";
const ZONE: &str = "validation.example.net";
const OWNER: &str = "_acme-challenge.example.com";
const TARGET: &str = "proof.validation.example.net";
const TOKEN: &str = "synthetic-setup-controller-token";

struct Fixture {
    runtime: Arc<ProxyRuntime>,
    path: PathBuf,
    api_calls: Arc<AtomicUsize>,
    api_task: JoinHandle<()>,
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.api_task.abort();
        let _ = std::fs::remove_dir_all(&self.path);
    }
}
impl Fixture {
    async fn new(zone: &str, verified: bool) -> Self {
        let api_calls = Arc::new(AtomicUsize::new(0));
        let calls = api_calls.clone();
        let zone_name = zone.to_owned();
        let api = Router::new().fallback(move |request: axum::extract::Request| {
            let calls = calls.clone(); let zone = zone_name.clone();
            async move {
                calls.fetch_add(1, Ordering::SeqCst);
                assert_eq!(request.method(), Method::GET, "setup must never mutate provider state");
                let entry = json!({"id":ZONE_ID,"name":zone,"name_servers":["ns.example.net"]});
                let result = if request.uri().path() == "/zones" { json!([entry]) } else { entry };
                Json(json!({"success":true,"result":result,"result_info":{"page":1,"per_page":20,"total_pages":1}}))
            }
        });
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = format!("http://{}/", listener.local_addr().unwrap());
        let api_task = tokio::spawn(async move {
            axum::serve(listener, api).await.unwrap();
        });
        let path = std::env::temp_dir().join(format!(
            "dns-setup-{}-{}",
            std::process::id(),
            time::OffsetDateTime::now_utc().unix_timestamp_nanos()
        ));
        std::fs::create_dir_all(&path).unwrap();
        let aad = format!("dns-connection:{CONNECTION}:v1");
        let secret = crate::runtime::dns::encryption::encrypt_bytes(
            b"synthetic-fixture-token",
            &aad,
            &[7; 32],
        )
        .unwrap();
        let now = "2026-01-01T00:00:00Z";
        let metadata = json!({"id":CONNECTION,"provider":"cloudflare","ownership":"instance","name":"Setup fixture","createdByUserId":ACTOR,"revision":1,"zones":[{"id":ZONE_ID,"name":zone}],"references":[],"createdAt":now,"updatedAt":now,"verification":{"status":if verified {"connected"} else {"untested"},"checkedAt":if verified {Some(now)} else {None},"zoneIds":if verified {vec![ZONE_ID]} else {vec![]},"error":null}});
        std::fs::write(
            path.join("dns-connections.json"),
            serde_json::to_vec(
                &json!({"version":1,"connections":[{"metadata":metadata,"secret":secret}]}),
            )
            .unwrap(),
        )
        .unwrap();
        let mut runtime = ProxyRuntime::new(RuntimeSettings::new(path.clone(), 0), None);
        Arc::get_mut(&mut runtime).unwrap().dns_connections =
            Store::fixture(path.clone(), endpoint);
        runtime.certificate_store.initialize().await.unwrap();
        Self {
            runtime,
            path,
            api_calls,
            api_task,
        }
    }
    fn bytes(&self) -> Vec<Vec<u8>> {
        [
            "dns-connections.json",
            "certificates/certificate-metadata.json",
        ]
        .into_iter()
        .map(|path| std::fs::read(self.path.join(path)).unwrap())
        .collect()
    }
    fn router(&self, configured: bool) -> Router {
        let token = if configured {
            Config::from_values(None, Some(TOKEN), None, None, None, false)
                .unwrap()
                .controller_token
        } else {
            None
        };
        app_with_state(AppState::new(self.runtime.clone(), token))
    }
    async fn manual(&self, expired: bool) -> ManualDnsActionRequest {
        let request = CertificateIssueRequest {
            domains: vec!["example.com".into(), "*.example.com".into()],
            environment: CertificateEnvironment::Staging,
            contact_email: None,
            challenge_type: AcmeChallengeType::Dns01,
            dns_mode: DnsValidationMode::Manual,
            dns_provider: None,
            accept_terms: true,
        };
        let metadata = self
            .runtime
            .certificate_store
            .begin_issue(CERTIFICATE, request, false)
            .await
            .unwrap();
        let operation = metadata.current_operation.unwrap().id;
        let expires = (time::OffsetDateTime::now_utc()
            + time::Duration::hours(if expired { -1 } else { 1 }))
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap();
        let order = ManualDnsOrder {
            version: 1,
            operation_id: operation.clone(),
            challenge_set_id: operation.clone(),
            account_identity: "a".repeat(64),
            order_url: "https://never-contact-ca.example.com/order/private-path".into(),
            expires_at: expires.clone(),
            records: vec![
                ManualDnsRecord {
                    identifier: "example.com".into(),
                    owner: OWNER.into(),
                    value: "a".repeat(43),
                    expires_at: expires.clone(),
                },
                ManualDnsRecord {
                    identifier: "*.example.com".into(),
                    owner: OWNER.into(),
                    value: "b".repeat(43),
                    expires_at: expires,
                },
            ],
            phase: ManualDnsPhase::AwaitingInput,
            private_key_pem: None,
            csr_der: None,
            last_checked_at: None,
            last_error_code: None,
        };
        self.runtime
            .certificate_store
            .park_manual_dns_order(CERTIFICATE, order)
            .await
            .unwrap();
        ManualDnsActionRequest {
            operation_id: operation.clone(),
            challenge_set_id: operation,
        }
    }
}
fn setup_request(delegated: bool) -> SetupRequest {
    SetupRequest {
        domains: vec!["example.com".into(), "*.example.com".into()],
        environment: CertificateEnvironment::Staging,
        dns_mode: if delegated {
            DnsValidationMode::Delegated
        } else {
            DnsValidationMode::Provider
        },
        connection_id: CONNECTION.into(),
        expected_revision: 1,
        zone_id: ZONE_ID.into(),
        delegation: delegated.then(|| Delegation::Cname {
            target_owner: TARGET.into(),
        }),
    }
}
async fn call(
    router: Router,
    path: &str,
    body: Vec<u8>,
    authenticated: bool,
) -> (StatusCode, Value) {
    let mut request = Request::builder().method(Method::POST).uri(path);
    if authenticated {
        request = request.header("authorization", format!("Bearer {TOKEN}"));
    }
    let response = router
        .oneshot(request.body(Body::from(body)).unwrap())
        .await
        .unwrap();
    let status = response.status();
    assert_eq!(response.headers().get("cache-control").unwrap(), "no-store");
    (
        status,
        serde_json::from_slice(&to_bytes(response.into_body(), 65536).await.unwrap()).unwrap(),
    )
}
struct DnsFixture {
    address: SocketAddr,
    tasks: Vec<JoinHandle<()>>,
    hold: Arc<AtomicBool>,
    started: Arc<Notify>,
    release: Arc<Semaphore>,
    queries: Arc<AtomicUsize>,
}
impl Drop for DnsFixture {
    fn drop(&mut self) {
        for task in &self.tasks {
            task.abort();
        }
    }
}
impl DnsFixture {
    async fn new(handler: impl Fn(Message, bool) -> Message + Send + Sync + 'static) -> Self {
        let (tcp, udp) = reserve_dns_socket_pair("127.0.0.1:0".parse().unwrap())
            .await
            .unwrap();
        let address = tcp.local_addr().unwrap();
        let handler = Arc::new(handler);
        let hold = Arc::new(AtomicBool::new(false));
        let started = Arc::new(Notify::new());
        let release = Arc::new(Semaphore::new(0));
        let queries = Arc::new(AtomicUsize::new(0));
        let (h, s, r, q, f) = (
            hold.clone(),
            started.clone(),
            release.clone(),
            queries.clone(),
            handler.clone(),
        );
        let udp_task = tokio::spawn(async move {
            let mut bytes = vec![0; 65535];
            loop {
                let (n, peer) = udp.recv_from(&mut bytes).await.unwrap();
                q.fetch_add(1, Ordering::SeqCst);
                if h.swap(false, Ordering::SeqCst) {
                    s.notify_one();
                    r.acquire().await.unwrap().forget();
                }
                let answer = f(Message::from_vec(&bytes[..n]).unwrap(), false);
                udp.send_to(&answer.to_vec().unwrap(), peer).await.unwrap();
            }
        });
        let tcp_task = tokio::spawn(async move {
            loop {
                let (mut stream, _) = tcp.accept().await.unwrap();
                let n = stream.read_u16().await.unwrap();
                let mut bytes = vec![0; usize::from(n)];
                stream.read_exact(&mut bytes).await.unwrap();
                let response = handler(Message::from_vec(&bytes).unwrap(), true)
                    .to_vec()
                    .unwrap();
                stream.write_u16(response.len() as u16).await.unwrap();
                stream.write_all(&response).await.unwrap();
            }
        });
        Self {
            address,
            tasks: vec![udp_task, tcp_task],
            hold,
            started,
            release,
            queries,
        }
    }
    fn resolver(&self) -> TokioResolver {
        let mut server = NameServerConfig::udp_and_tcp(self.address.ip());
        for connection in &mut server.connections {
            connection.port = self.address.port();
        }
        let mut builder = TokioResolver::builder_with_config(
            ResolverConfig::from_name_servers(vec![server]),
            TokioRuntimeProvider::default(),
        );
        let opts = builder.options_mut();
        opts.cache_size = 0;
        opts.timeout = Duration::from_secs(3);
        opts.attempts = 1;
        opts.preserve_intermediates = false;
        builder.build().unwrap()
    }
}
fn name(value: &str) -> Name {
    Name::from_ascii(format!("{value}.")).unwrap()
}
fn record(owner: &str, data: RData) -> Record {
    Record::from_rdata(name(owner), 0, data)
}
fn soa(zone: &str) -> Record {
    record(
        zone,
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
fn response(request: &Message) -> Message {
    let mut result = Message::response(request.metadata.id, request.metadata.op_code);
    result.metadata.recursion_desired = request.metadata.recursion_desired;
    result.metadata.recursion_available = true;
    result.metadata.authoritative = true;
    result.add_queries(request.queries.clone());
    result
}
fn answer(request: Message, zone: &str, target: Option<&str>) -> Message {
    let mut result = response(&request);
    let query = &request.queries[0];
    let owner = query.name().to_ascii().trim_end_matches('.').to_owned();
    match query.query_type() {
        RecordType::CNAME => {
            if owner == OWNER
                && let Some(target) = target
            {
                result.add_answer(record(OWNER, RData::CNAME(CNAME(name(target)))));
            } else {
                result.add_authority(soa(zone));
            }
        }
        RecordType::SOA => {
            if owner == zone {
                result.add_answer(soa(zone));
            } else {
                result.add_authority(soa(zone));
            }
        }
        RecordType::NS => {
            result.add_answer(record(zone, RData::NS(NS(name("ns.example.net")))));
        }
        _ => {
            result.add_authority(soa(zone));
        }
    }
    result
}

#[tokio::test]
async fn direct_setup_is_grouped_scoped_verified_and_completely_read_only() {
    let fixture = Fixture::new("example.com", true).await;
    let before = fixture.bytes();
    let result = fixture
        .runtime
        .dns_setup(setup_request(false))
        .await
        .unwrap();
    assert_eq!(result.results.len(), 1);
    assert_eq!(result.results[0].identifiers.len(), 2);
    assert_eq!(result.results[0].status, SetupStatus::Ready);
    assert_eq!(result.results[0].instruction.r#type, "TXT");
    assert!(result.results[0].instruction.values.is_empty());
    assert_eq!(fixture.bytes(), before);
    assert_eq!(fixture.api_calls.load(Ordering::SeqCst), 0);
    assert!(
        fixture
            .runtime
            .certificate_store
            .list()
            .await
            .unwrap()
            .is_empty()
    );
    let fixture = Fixture::new(ZONE, true).await;
    assert!(
        fixture
            .runtime
            .dns_setup(setup_request(false))
            .await
            .is_err()
    );
    let fixture = Fixture::new("example.com", false).await;
    assert!(
        fixture
            .runtime
            .dns_setup(setup_request(false))
            .await
            .is_err()
    );
    assert_eq!(fixture.api_calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn setup_http_auth_and_strict_request_bounds_precede_network() {
    let fixture = Fixture::new("example.com", true).await;
    let base = json!({"domains":["example.com"],"environment":"staging","dnsMode":"provider","connectionId":CONNECTION,"expectedRevision":1,"zoneId":ZONE_ID});
    for (configured, auth) in [(false, false), (true, false)] {
        assert_eq!(
            call(
                fixture.router(configured),
                "/internal/v1/certificates/dns-01/setup",
                serde_json::to_vec(&base).unwrap(),
                auth
            )
            .await
            .0,
            StatusCode::UNAUTHORIZED
        );
    }
    let (status, result) = call(
        fixture.router(true),
        "/internal/v1/certificates/dns-01/setup",
        serde_json::to_vec(&base).unwrap(),
        true,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(result["results"][0]["status"], "ready");
    for mutate in 0..9 {
        let mut payload = base.clone();
        match mutate {
            0 => payload["domains"] = json!(vec!["example.com"; 101]),
            1 => payload["domains"] = json!(["localhost"]),
            2 => payload["domains"] = json!(["UPPER.example.com"]),
            3 => payload["expectedRevision"] = json!(0),
            4 => payload["environment"] = json!("wrong"),
            5 => payload["apiToken"] = json!("must-be-rejected"),
            6 => payload["delegation"] = json!({"type":"ns"}),
            7 => payload["domains"] = json!(["example.com", "example.com"]),
            _ => payload["connectionId"] = json!("invalid"),
        };
        assert!(
            !call(
                fixture.router(true),
                "/internal/v1/certificates/dns-01/setup",
                serde_json::to_vec(&payload).unwrap(),
                true
            )
            .await
            .0
            .is_success()
        );
    }
    assert!(
        !call(
            fixture.router(true),
            "/internal/v1/certificates/dns-01/setup",
            vec![b' '; 32769],
            true
        )
        .await
        .0
        .is_success()
    );
    assert_eq!(fixture.api_calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn cname_setup_distinguishes_ready_missing_wrong_target_and_conflicting_data() {
    for mode in 0..4 {
        let fixture = Fixture::new(ZONE, true).await;
        let dns = DnsFixture::new(move |request, tcp| {
            if !tcp {
                let mut result = response(&request);
                result.metadata.truncation = true;
                return result;
            }
            let mut result = answer(
                request.clone(),
                ZONE,
                if mode == 1 {
                    None
                } else if mode == 2 {
                    Some("wrong.validation.example.net")
                } else {
                    Some(TARGET)
                },
            );
            if mode == 3
                && request.queries[0].query_type() == RecordType::CNAME
                && request.queries[0].name() == &name(OWNER)
            {
                result.add_answer(record(OWNER, RData::TXT(TXT::new(vec!["conflict".into()]))));
            }
            result
        })
        .await;
        let before = fixture.bytes();
        let result = fixture
            .runtime
            .dns_setup_inner(setup_request(true), Some(dns.resolver()))
            .await
            .unwrap();
        assert_eq!(
            result.results[0].status,
            [
                SetupStatus::Ready,
                SetupStatus::Missing,
                SetupStatus::Conflicting,
                SetupStatus::Conflicting
            ][mode]
        );
        assert_eq!(
            result.results[0].instruction.values,
            vec![format!("{TARGET}.")]
        );
        assert_eq!(fixture.api_calls.load(Ordering::SeqCst), 0);
        assert_eq!(fixture.bytes(), before);
    }
}

#[tokio::test]
async fn ns_setup_uses_only_provider_assigned_names_and_preserves_underscore_owner() {
    let fixture = Fixture::new(OWNER, true).await;
    let dns = DnsFixture::new(|request, _| answer(request, OWNER, None)).await;
    let mut request = setup_request(true);
    request.delegation = Some(Delegation::Ns);
    let before = fixture.bytes();
    let result = fixture
        .runtime
        .dns_setup_inner(request, Some(dns.resolver()))
        .await
        .unwrap();
    assert_eq!(result.results[0].status, SetupStatus::Ready);
    assert_eq!(result.results[0].instruction.r#type, "NS");
    assert_eq!(result.results[0].instruction.owner, OWNER);
    assert_eq!(
        result.results[0].instruction.values,
        vec!["ns.example.net."]
    );
    assert_eq!(fixture.api_calls.load(Ordering::SeqCst), 1);
    assert_eq!(fixture.bytes(), before);
    let fixture = Fixture::new(ZONE, true).await;
    let mut request = setup_request(true);
    request.delegation = Some(Delegation::Ns);
    assert!(fixture.runtime.dns_setup(request).await.is_err());
    assert_eq!(fixture.api_calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn revision_change_during_dns_check_discards_observation() {
    let fixture = Fixture::new(ZONE, true).await;
    let dns = DnsFixture::new(|request, _| answer(request, ZONE, Some(TARGET))).await;
    dns.hold.store(true, Ordering::SeqCst);
    let runtime = fixture.runtime.clone();
    let resolver = dns.resolver();
    let check = tokio::spawn(async move {
        runtime
            .dns_setup_inner(setup_request(true), Some(resolver))
            .await
    });
    tokio::time::timeout(Duration::from_secs(2), dns.started.notified())
        .await
        .unwrap();
    fixture
        .runtime
        .dns_connections
        .save(
            CONNECTION.into(),
            SaveRequest {
                provider: Some(ProviderId::Cloudflare),
                expected_revision: 1,
                name: "Rotated setup fixture".into(),
                api_token: Some("replacement-fixture-token".into()),
                zone_ids: vec![ZONE_ID.into()],
                actor_user_id: ACTOR.into(),
            },
        )
        .await
        .unwrap();
    dns.release.add_permits(1);
    assert!(matches!(
        check.await.unwrap(),
        Err(CertificateError::OperationInProgress)
    ));
}

#[tokio::test]
async fn manual_check_requires_every_saved_value_without_ca_or_journal_writes() {
    for complete in [true, false] {
        let fixture = Fixture::new(ZONE, true).await;
        let action = fixture.manual(false).await;
        let dns = DnsFixture::new(move |request, _| {
            let mut result = response(&request);
            result.add_answer(record(
                OWNER,
                RData::TXT(TXT::new(vec!["a".repeat(20), "a".repeat(23)])),
            ));
            if complete {
                result.add_answer(record(OWNER, RData::TXT(TXT::new(vec!["b".repeat(43)]))));
            }
            result.add_answer(record(
                OWNER,
                RData::TXT(TXT::new(vec!["foreign-secret-value".into()])),
            ));
            result
        })
        .await;
        let before = fixture.bytes();
        let result = fixture
            .runtime
            .check_manual_dns_inner(CERTIFICATE, &action, Some(dns.resolver()))
            .await
            .unwrap();
        assert_eq!(
            result.status,
            if complete {
                CheckStatus::Ready
            } else {
                CheckStatus::Pending
            }
        );
        assert_eq!(result.records.len(), 1);
        assert_eq!(result.records[0].identifiers.len(), 2);
        let serialized = serde_json::to_string(&result).unwrap();
        for hidden in [
            "foreign-secret-value",
            "private-path",
            "accountIdentity",
            "csrDer",
            "privateKeyPem",
        ] {
            assert!(!serialized.contains(hidden));
        }
        assert_eq!(fixture.bytes(), before);
        assert_eq!(fixture.api_calls.load(Ordering::SeqCst), 0);
    }
}

#[tokio::test]
async fn manual_expiry_and_stale_ids_are_read_only_and_do_not_query_dns() {
    let fixture = Fixture::new(ZONE, true).await;
    let mut action = fixture.manual(true).await;
    let dns = DnsFixture::new(|request, _| response(&request)).await;
    let before = fixture.bytes();
    assert_eq!(
        fixture
            .runtime
            .check_manual_dns_inner(CERTIFICATE, &action, Some(dns.resolver()))
            .await
            .unwrap()
            .status,
        CheckStatus::Expired
    );
    action.challenge_set_id = CONNECTION.into();
    assert!(
        fixture
            .runtime
            .check_manual_dns_inner(CERTIFICATE, &action, Some(dns.resolver()))
            .await
            .is_err()
    );
    assert_eq!(dns.queries.load(Ordering::SeqCst), 0);
    assert_eq!(fixture.bytes(), before);
}

#[tokio::test]
async fn manual_cancellation_during_lookup_fences_ready_response() {
    let fixture = Fixture::new(ZONE, true).await;
    let action = fixture.manual(false).await;
    let dns = DnsFixture::new(|request, _| {
        let mut result = response(&request);
        for value in ["a", "b"] {
            result.add_answer(record(OWNER, RData::TXT(TXT::new(vec![value.repeat(43)]))));
        }
        result
    })
    .await;
    dns.hold.store(true, Ordering::SeqCst);
    let runtime = fixture.runtime.clone();
    let check_action = action.clone();
    let resolver = dns.resolver();
    let check = tokio::spawn(async move {
        runtime
            .check_manual_dns_inner(CERTIFICATE, &check_action, Some(resolver))
            .await
    });
    tokio::time::timeout(Duration::from_secs(2), dns.started.notified())
        .await
        .unwrap();
    fixture
        .runtime
        .certificate_store
        .cancel_manual_dns_order(CERTIFICATE, &action)
        .await
        .unwrap();
    dns.release.add_permits(1);
    assert!(matches!(
        check.await.unwrap(),
        Err(CertificateError::OperationInProgress)
    ));
}

#[tokio::test]
async fn admission_and_lookup_timeout_are_bounded() {
    let fixture = Fixture::new(ZONE, true).await;
    let permits = fixture
        .runtime
        .dns_assistant_admission
        .acquire_many(2)
        .await
        .unwrap();
    assert!(matches!(
        fixture.runtime.dns_setup(setup_request(true)).await,
        Err(CertificateError::OperationInProgress)
    ));
    drop(permits);
    let dns = DnsFixture::new(|request, _| response(&request)).await;
    dns.hold.store(true, Ordering::SeqCst);
    let started = Instant::now();
    let result = fixture
        .runtime
        .dns_setup_inner(setup_request(true), Some(dns.resolver()))
        .await
        .unwrap();
    assert_eq!(result.results[0].status, SetupStatus::LookupFailed);
    assert!(started.elapsed() < Duration::from_secs(5));
}

#[tokio::test]
async fn ns_setup_reports_missing_wrong_servers_and_conflicting_alias() {
    for mode in 0..3 {
        let fixture = Fixture::new(OWNER, true).await;
        let dns = DnsFixture::new(move |request, _| {
            if mode == 2 {
                return answer(request, OWNER, Some(TARGET));
            }
            if request.queries[0].query_type() == RecordType::NS {
                let mut result = response(&request);
                if mode == 0 {
                    result.add_authority(soa(OWNER));
                } else {
                    result.add_answer(record(OWNER, RData::NS(NS(name("other.example.net")))));
                }
                return result;
            }
            answer(request, OWNER, None)
        })
        .await;
        let mut request = setup_request(true);
        request.delegation = Some(Delegation::Ns);
        let result = fixture
            .runtime
            .dns_setup_inner(request, Some(dns.resolver()))
            .await
            .unwrap();
        assert_eq!(
            result.results[0].status,
            if mode == 0 {
                SetupStatus::Missing
            } else {
                SetupStatus::Conflicting
            }
        );
        assert_eq!(
            result.results[0].instruction.values,
            vec!["ns.example.net."]
        );
    }
}

#[tokio::test]
async fn assigned_nameservers_are_read_only_provider_metadata_and_never_soa_guesses() {
    let payloads = [
        (
            DnsProviderConfig::Cloudflare {
                zone_id: ZONE_ID.into(),
                api_token: "fixture".into(),
            },
            json!({"success":true,"result":{"id":ZONE_ID,"name":ZONE,"name_servers":["NS.EXAMPLE.NET."]}}),
        ),
        (
            DnsProviderConfig::Desec {
                zone_id: ZONE.into(),
                api_token: "fixture".into(),
            },
            json!({"domain":ZONE,"name":format!("{ZONE}."),"subname":"","type":"NS","records":["ns.example.net."]}),
        ),
        (
            DnsProviderConfig::Hetzner {
                zone_id: "123".into(),
                api_token: "fixture".into(),
            },
            json!({"zone":{"id":123,"name":ZONE,"mode":"primary","authoritative_nameservers":{"assigned":["ns.example.net."],"delegated":["wrong.example.net."]}}}),
        ),
    ];
    for (config, payload) in payloads {
        let response = payload.clone();
        let router = Router::new().fallback(move |request: axum::extract::Request| {
            let response = response.clone();
            async move {
                assert_eq!(request.method(), Method::GET);
                Json(response)
            }
        });
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = format!("http://{}/", listener.local_addr().unwrap());
        let task = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
        let provider = DnsProvider::for_connection_check(config, &endpoint).unwrap();
        assert_eq!(
            provider.setup_nameservers(ZONE).await.unwrap(),
            vec!["ns.example.net"]
        );
        assert!(
            provider
                .setup_nameservers("wrong.example.net")
                .await
                .is_err()
        );
        task.abort();
    }
    let router=Router::new().fallback(get(||async{Json(json!({"success":true,"result":{"id":ZONE_ID,"name":OWNER,"name_servers":[],"soa":{"mname":"never-use-this.example.net"}}}))}));
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}/", listener.local_addr().unwrap());
    let task = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    let mut fixture = Fixture::new(OWNER, true).await;
    // Missing assigned metadata must remain explicit, even if SOA-like data exists.
    Arc::get_mut(&mut fixture.runtime).unwrap().dns_connections =
        Store::fixture(fixture.path.clone(), endpoint);
    let mut request = setup_request(true);
    request.delegation = Some(Delegation::Ns);
    let before = fixture.bytes();
    let result = fixture.runtime.dns_setup(request).await.unwrap();
    assert_eq!(
        result.results[0].status,
        SetupStatus::NameserversUnavailable
    );
    assert!(result.results[0].instruction.values.is_empty());
    assert_eq!(fixture.bytes(), before);
    task.abort();
}

#[tokio::test]
async fn manual_check_http_requires_auth_and_current_action_ids() {
    let fixture = Fixture::new(ZONE, true).await;
    let action = fixture.manual(true).await;
    let path = format!("/internal/v1/certificates/{CERTIFICATE}/dns-01/check");
    let body = json!({"operationId":action.operation_id,"challengeSetId":action.challenge_set_id});
    assert_eq!(
        call(
            fixture.router(true),
            &path,
            serde_json::to_vec(&body).unwrap(),
            false
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
    let before = fixture.bytes();
    let (status, result) = call(
        fixture.router(true),
        &path,
        serde_json::to_vec(&body).unwrap(),
        true,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(result["status"], "expired");
    assert_eq!(fixture.bytes(), before);
    let mut stale = body.clone();
    stale["challengeSetId"] = json!(CONNECTION);
    assert!(
        !call(
            fixture.router(true),
            &path,
            serde_json::to_vec(&stale).unwrap(),
            true
        )
        .await
        .0
        .is_success()
    );
    let mut arbitrary = body;
    arbitrary["records"] = json!([{ "owner":"arbitrary.example.net", "value":"attacker" }]);
    assert!(
        !call(
            fixture.router(true),
            &path,
            serde_json::to_vec(&arbitrary).unwrap(),
            true
        )
        .await
        .0
        .is_success()
    );
}

#[tokio::test]
async fn manual_check_rejects_saved_proofs_at_an_unrelated_answer_owner() {
    let fixture = Fixture::new(ZONE, true).await;
    let action = fixture.manual(false).await;
    let dns = DnsFixture::new(|request, _| {
        let mut result = response(&request);
        result.add_answer(record(
            OWNER,
            RData::TXT(TXT::new(vec!["wrong-value".into()])),
        ));
        for value in ["a", "b"] {
            result.add_answer(record(
                "unrelated.example.net",
                RData::TXT(TXT::new(vec![value.repeat(43)])),
            ));
        }
        result
    })
    .await;
    let before = fixture.bytes();
    let result = fixture
        .runtime
        .check_manual_dns_inner(CERTIFICATE, &action, Some(dns.resolver()))
        .await
        .unwrap();
    assert_eq!(result.status, CheckStatus::Pending);
    assert_eq!(result.records[0].status, CheckStatus::Pending);
    assert_eq!(fixture.bytes(), before);
    assert_eq!(fixture.api_calls.load(Ordering::SeqCst), 0);
}
