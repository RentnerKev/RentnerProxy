use super::*;
use crate::{
    config::Config,
    models::{DefaultSite, ProxyHttpSettings, RedirectHost, UpstreamTls, ValidatedProxyConfig},
    runtime::{EngineFuture, ProxyEngine, RuntimeSettings},
    server::{AppState, app_with_state},
    tests::fixtures::reserve_dns_socket_pair,
};
use axum::{
    body::{Body, to_bytes},
    http::{Request as HttpRequest, StatusCode},
};
use hickory_resolver::{
    TokioResolver,
    config::{NameServerConfig, ResolverConfig},
    net::runtime::TokioRuntimeProvider,
    proto::{
        op::{Message, ResponseCode},
        rr::{
            Name, RData, Record, RecordType,
            rdata::{A, CNAME},
        },
    },
};
use serde_json::{Value, json};
use std::{
    io::{Cursor, Read, Write},
    net::{Ipv4Addr, SocketAddr},
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::{Mutex, Notify, Semaphore},
    task::{JoinHandle, JoinSet},
    time::timeout,
};
use tower::ServiceExt;

const HOST: &str = "0198d98a-0000-7000-8000-000000000285";
const DOMAIN: &str = "app.example.com";
const BACKEND: &str = "backend.example.net";
const SNI: &str = "tls.example.net";
const TOKEN: &str = "synthetic-diagnostics-controller-token";
static NEXT_ROOT: AtomicUsize = AtomicUsize::new(0);
fn revision() -> String {
    format!("sha256:{}", "a".repeat(64))
}
struct NoEngineCalls(Arc<AtomicUsize>, Arc<AtomicBool>, Arc<AtomicUsize>);
impl ProxyEngine for NoEngineCalls {
    fn start<'a>(&'a self, _: &'a str, _: &'a str) -> EngineFuture<'a> {
        self.0.fetch_add(1, Ordering::SeqCst);
        Box::pin(async { Ok(()) })
    }
    fn load<'a>(&'a self, _: &'a str) -> EngineFuture<'a> {
        self.0.fetch_add(1, Ordering::SeqCst);
        Box::pin(async { Ok(()) })
    }
    fn probe<'a>(&'a self, _: &'a str) -> EngineFuture<'a> {
        self.0.fetch_add(1, Ordering::SeqCst);
        Box::pin(async { Ok(()) })
    }
    fn shutdown<'a>(&'a self) -> EngineFuture<'a> {
        self.0.fetch_add(1, Ordering::SeqCst);
        Box::pin(async { Ok(()) })
    }
    fn is_running<'a>(
        &'a self,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = bool> + Send + 'a>> {
        self.2.fetch_add(1, Ordering::SeqCst);
        Box::pin(async { self.1.load(Ordering::SeqCst) })
    }
}
struct Fixture {
    runtime: Arc<ProxyRuntime>,
    path: PathBuf,
    calls: Arc<AtomicUsize>,
    engine_alive: Arc<AtomicBool>,
    liveness_reads: Arc<AtomicUsize>,
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}
impl Fixture {
    async fn new(port: u16) -> Self {
        let path = std::env::temp_dir().join(format!(
            "domain-diagnostics-{}-{}-{}",
            std::process::id(),
            time::OffsetDateTime::now_utc().unix_timestamp_nanos(),
            NEXT_ROOT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&path).unwrap();
        let calls = Arc::new(AtomicUsize::new(0));
        let engine_alive = Arc::new(AtomicBool::new(true));
        let liveness_reads = Arc::new(AtomicUsize::new(0));
        let runtime = ProxyRuntime::new(
            RuntimeSettings::new(path.clone(), 0),
            Some(Arc::new(NoEngineCalls(
                calls.clone(),
                engine_alive.clone(),
                liveness_reads.clone(),
            ))),
        );
        let host = ProxyHost {
            id: HOST.into(),
            domains: vec![DOMAIN.into()],
            forward_scheme: "http".into(),
            forward_host: "127.0.0.1".into(),
            forward_port: port,
            http_settings: ProxyHttpSettings::default(),
            response_cache: None,
            certificate_id: None,
            force_https: false,
            upstream_tls: None,
            access_policy: None,
        };
        *runtime.active_configuration.lock().await = Some(ValidatedProxyConfig {
            default_site: DefaultSite::default(),
            revision: revision(),
            proxy_hosts: vec![host],
            http_settings: ProxyHttpSettings::default(),
            trusted_cas: vec![],
            redirect_hosts: vec![],
        });
        {
            let mut state = runtime.state.lock().await;
            state.initialized = true;
            state.engine_available = true;
            state.active_revision = Some(revision());
        }
        Self {
            runtime,
            path,
            calls,
            engine_alive,
            liveness_reads,
        }
    }
    fn request(&self) -> Request {
        Request {
            host_type: HostType::Proxy,
            host_id: HOST.into(),
            domain: DOMAIN.into(),
            expected_revision: revision(),
        }
    }
    fn router(&self, configured: bool) -> axum::Router {
        let token = if configured {
            Config::from_values(None, Some(TOKEN), None, None, None, false)
                .unwrap()
                .controller_token
        } else {
            None
        };
        app_with_state(AppState::new(self.runtime.clone(), token))
    }
    async fn probe(&self, dns: &DnsFixture) -> Result {
        self.runtime
            .diagnose_domain_inner(self.request(), Some(dns.resolver()))
            .await
            .unwrap()
    }
    fn assert_pure(&self) {
        assert_eq!(self.calls.load(Ordering::SeqCst), 0);
        assert_eq!(std::fs::read_dir(&self.path).unwrap().count(), 0);
    }
}
async fn call(router: axum::Router, payload: Vec<u8>, auth: bool) -> (StatusCode, Value) {
    let mut request = HttpRequest::builder()
        .method("POST")
        .uri("/internal/v1/diagnostics/domain");
    if auth {
        request = request.header("authorization", format!("Bearer {TOKEN}"));
    }
    let response = router
        .oneshot(request.body(Body::from(payload)).unwrap())
        .await
        .unwrap();
    let status = response.status();
    assert_eq!(response.headers().get("cache-control").unwrap(), "no-store");
    let bytes = to_bytes(response.into_body(), 65536).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap())
}

struct DnsFixture {
    address: SocketAddr,
    task: JoinHandle<()>,
    queries: Arc<Mutex<Vec<String>>>,
}
impl Drop for DnsFixture {
    fn drop(&mut self) {
        self.task.abort();
    }
}
impl DnsFixture {
    async fn new(handler: impl Fn(Message) -> Message + Send + Sync + 'static) -> Self {
        Self::new_filtered(move |request| Some(handler(request))).await
    }
    async fn new_filtered(
        handler: impl Fn(Message) -> Option<Message> + Send + Sync + 'static,
    ) -> Self {
        let (tcp, udp) = reserve_dns_socket_pair("127.0.0.1:0".parse().unwrap())
            .await
            .unwrap();
        let address = tcp.local_addr().unwrap();
        let queries = Arc::new(Mutex::new(Vec::new()));
        let observed = queries.clone();
        let handler = Arc::new(handler);
        let task = tokio::spawn(async move {
            let mut children = JoinSet::new();
            let mut bytes = vec![0; 65535];
            loop {
                tokio::select! {
                    packet=udp.recv_from(&mut bytes)=>{let(n,peer)=packet.unwrap();let request=Message::from_vec(&bytes[..n]).unwrap();observed.lock().await.push(request.queries[0].name().to_ascii());if let Some(response)=handler(request){udp.send_to(&response.to_vec().unwrap(),peer).await.unwrap();}},
                    accepted=tcp.accept()=>{let(mut stream,_)=accepted.unwrap();let handler=handler.clone();let observed=observed.clone();children.spawn(async move{let n=stream.read_u16().await.unwrap();let mut bytes=vec![0;usize::from(n)];stream.read_exact(&mut bytes).await.unwrap();let request=Message::from_vec(&bytes).unwrap();observed.lock().await.push(request.queries[0].name().to_ascii());if let Some(answer)=handler(request){let answer=answer.to_vec().unwrap();stream.write_u16(answer.len() as u16).await.unwrap();stream.write_all(&answer).await.unwrap();}});},
                    _=children.join_next(),if !children.is_empty()=>{}
                }
            }
        });
        Self {
            address,
            task,
            queries,
        }
    }
    async fn normal() -> Self {
        Self::new(|request| answer(request, Some(Ipv4Addr::LOCALHOST))).await
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
        builder.options_mut().cache_size = 0;
        builder.options_mut().attempts = 1;
        builder.options_mut().preserve_intermediates = true;
        builder.build().unwrap()
    }
}
fn name(value: &str) -> Name {
    Name::from_ascii(format!("{value}.")).unwrap()
}
fn response(request: &Message) -> Message {
    let mut result = Message::response(request.metadata.id, request.metadata.op_code);
    result.metadata.recursion_desired = request.metadata.recursion_desired;
    result.metadata.recursion_available = true;
    result.metadata.authoritative = true;
    result.add_queries(request.queries.clone());
    result
}
fn answer(request: Message, address: Option<Ipv4Addr>) -> Message {
    let mut result = response(&request);
    if let Some(address) = address {
        if request.queries[0].query_type() == RecordType::A {
            result.add_answer(Record::from_rdata(
                request.queries[0].name().clone(),
                0,
                RData::A(A(address)),
            ));
        }
    } else {
        result.metadata.response_code = ResponseCode::NXDomain;
    }
    result
}

struct HttpFixture {
    port: u16,
    task: JoinHandle<()>,
    requests: Arc<Mutex<Vec<String>>>,
    started: Arc<Notify>,
    release: Arc<Semaphore>,
}
impl Drop for HttpFixture {
    fn drop(&mut self) {
        self.task.abort();
    }
}
impl HttpFixture {
    async fn new(status: u16, location: Option<String>, hold: bool) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let requests = Arc::new(Mutex::new(Vec::new()));
        let started = Arc::new(Notify::new());
        let release = Arc::new(Semaphore::new(if hold { 0 } else { 32 }));
        let (r, s, p) = (requests.clone(), started.clone(), release.clone());
        let task = tokio::spawn(async move {
            let mut children = JoinSet::new();
            loop {
                tokio::select! {accepted=listener.accept()=>{let(mut stream,_)=accepted.unwrap();let(r,s,p,location)=(r.clone(),s.clone(),p.clone(),location.clone());children.spawn(async move{let Some(request)=read_headers(&mut stream).await else{return};r.lock().await.push(request);s.notify_one();let Ok(permit)=p.acquire().await else{return};permit.forget();let mut response=format!("HTTP/1.1 {status} Fixture\r\nContent-Length: 999999999\r\nConnection: close\r\n");if let Some(location)=location{response.push_str(&format!("Location: {location}\r\n"));}response.push_str("\r\n");let _=stream.write_all(response.as_bytes()).await;});},_=children.join_next(),if !children.is_empty()=>{}}
            }
        });
        Self {
            port,
            task,
            requests,
            started,
            release,
        }
    }
}
async fn read_headers(stream: &mut TcpStream) -> Option<String> {
    let mut bytes = Vec::new();
    loop {
        let mut buf = [0; 2048];
        let n = stream.read(&mut buf).await.ok()?;
        if n == 0 {
            return None;
        }
        bytes.extend_from_slice(&buf[..n]);
        if bytes.len() > 16384 {
            return None;
        }
        if bytes.windows(4).any(|bytes| bytes == b"\r\n\r\n") {
            return String::from_utf8(bytes).ok();
        }
    }
}

#[tokio::test]
async fn route_requires_configured_bearer_and_strict_bounded_input() {
    let fixture = Fixture::new(12345).await;
    let payload =
        json!({"hostType":"proxy","hostId":HOST,"domain":DOMAIN,"expectedRevision":revision()});
    for (configured, auth) in [(false, false), (true, false)] {
        assert_eq!(
            call(
                fixture.router(configured),
                serde_json::to_vec(&payload).unwrap(),
                auth
            )
            .await
            .0,
            StatusCode::UNAUTHORIZED
        );
    }
    for field in ["url", "address", "config", "credentials"] {
        let mut invalid = payload.clone();
        invalid[field] = json!("http://169.254.169.254/");
        assert!(
            !call(
                fixture.router(true),
                serde_json::to_vec(&invalid).unwrap(),
                true
            )
            .await
            .0
            .is_success()
        );
    }
    for (field, value) in [
        ("hostType", "wrong"),
        ("hostId", "not-a-uuid"),
        ("domain", "App.example.com"),
        ("domain", "http://example.com"),
        ("expectedRevision", "sha256:ABC"),
    ] {
        let mut invalid = payload.clone();
        invalid[field] = json!(value);
        assert!(
            !call(
                fixture.router(true),
                serde_json::to_vec(&invalid).unwrap(),
                true
            )
            .await
            .0
            .is_success()
        );
    }
    assert!(
        !call(fixture.router(true), vec![b' '; 4097], true)
            .await
            .0
            .is_success()
    );
    fixture.assert_pure();
}
#[tokio::test]
async fn stale_missing_unavailable_and_wildcard_never_query_or_probe_untrusted_input() {
    let http = HttpFixture::new(200, None, false).await;
    let fixture = Fixture::new(http.port).await;
    let dns = DnsFixture::normal().await;
    let mut request = fixture.request();
    request.expected_revision = format!("sha256:{}", "b".repeat(64));
    let result = fixture
        .runtime
        .diagnose_domain_inner(request, Some(dns.resolver()))
        .await
        .unwrap();
    assert_eq!(result.stages.configuration.code, Code::ConfigurationStale);
    let mut request = fixture.request();
    request.domain = "not-configured.example.com".into();
    assert_eq!(
        fixture
            .runtime
            .diagnose_domain_inner(request, Some(dns.resolver()))
            .await
            .unwrap()
            .stages
            .configuration
            .code,
        Code::HostNotActive
    );
    fixture.runtime.state.lock().await.engine_available = false;
    assert_eq!(
        fixture.probe(&dns).await.stages.configuration.code,
        Code::RuntimeUnavailable
    );
    fixture.runtime.state.lock().await.engine_available = true;
    fixture
        .runtime
        .active_configuration
        .lock()
        .await
        .as_mut()
        .unwrap()
        .proxy_hosts[0]
        .domains = vec!["*.example.com".into()];
    let mut request = fixture.request();
    request.domain = "*.example.com".into();
    let result = fixture
        .runtime
        .diagnose_domain_inner(request, Some(dns.resolver()))
        .await
        .unwrap();
    assert_eq!(result.stages.dns.code, Code::WildcardDomain);
    assert_eq!(result.stages.upstream.code, Code::WildcardDomain);
    assert!(dns.queries.lock().await.is_empty());
    assert!(http.requests.lock().await.is_empty());
    fixture.assert_pure();
}
#[tokio::test]
async fn configured_lan_http_uses_head_root_without_credentials_and_keeps_partial_results() {
    let http = HttpFixture::new(200, None, false).await;
    let fixture = Fixture::new(http.port).await;
    let dns = DnsFixture::new(|request| answer(request, None)).await;
    let result = fixture.probe(&dns).await;
    assert_eq!(result.stages.configuration.status, Status::Passed);
    assert_eq!(result.stages.dns.code, Code::DnsNotFound);
    assert_eq!(result.stages.upstream.code, Code::UpstreamResponded);
    assert_eq!(result.stages.tls.code, Code::HttpUpstream);
    let requests = http.requests.lock().await;
    assert_eq!(requests.len(), 1);
    let request = requests[0].to_ascii_lowercase();
    assert!(request.starts_with("head / http/1.1\r\n"));
    assert!(request.contains(&format!("host: {DOMAIN}\r\n")));
    for forbidden in ["authorization:", "cookie:", "x-forwarded", "secret"] {
        assert!(!request.contains(forbidden));
    }
    fixture.assert_pure();
}
#[tokio::test]
async fn redirect_and_http_error_results_do_not_follow_or_overstate_health() {
    let trap = HttpFixture::new(200, None, false).await;
    for (status, expected, state) in [
        (302, Code::RedirectNotFollowed, Status::Unknown),
        (401, Code::AccessDenied, Status::Failed),
        (404, Code::UnexpectedStatus, Status::Unknown),
        (405, Code::UnexpectedStatus, Status::Unknown),
        (503, Code::UpstreamError, Status::Failed),
    ] {
        let http = HttpFixture::new(
            status,
            Some(format!(
                "http://127.0.0.1:{}/credential-stealing-path",
                trap.port
            )),
            false,
        )
        .await;
        let fixture = Fixture::new(http.port).await;
        let dns = DnsFixture::normal().await;
        let result = fixture.probe(&dns).await;
        assert_eq!(result.stages.upstream.code, expected);
        assert_eq!(result.stages.upstream.status, state);
        assert_eq!(result.stages.upstream.http_status, Some(status));
        assert_eq!(http.requests.lock().await.len(), 1);
        fixture.assert_pure();
    }
    assert!(trap.requests.lock().await.is_empty());
}
#[tokio::test]
async fn redirect_hosts_only_observe_dns_and_never_dial_destination() {
    let http = HttpFixture::new(200, None, false).await;
    let fixture = Fixture::new(http.port).await;
    let dns = DnsFixture::normal().await;
    {
        let mut active = fixture.runtime.active_configuration.lock().await;
        let config = active.as_mut().unwrap();
        config.proxy_hosts.clear();
        config.redirect_hosts.push(RedirectHost {
            id: HOST.into(),
            domains: vec![DOMAIN.into()],
            destination: format!("http://127.0.0.1:{}/", http.port),
            status_code: 302,
            preserve_request_uri: false,
            certificate_id: None,
        });
    }
    let mut request = fixture.request();
    request.host_type = HostType::Redirect;
    let result = fixture
        .runtime
        .diagnose_domain_inner(request, Some(dns.resolver()))
        .await
        .unwrap();
    assert_eq!(result.stages.dns.code, Code::DnsResolved);
    assert_eq!(result.stages.upstream.code, Code::RedirectHost);
    assert_eq!(result.stages.tls.code, Code::RedirectHost);
    assert!(http.requests.lock().await.is_empty());
    fixture.assert_pure();
}
#[tokio::test]
async fn dns_owner_provenance_rebinding_and_pinned_backend_are_bounded() {
    let http = HttpFixture::new(200, None, false).await;
    let fixture = Fixture::new(http.port).await;
    fixture
        .runtime
        .active_configuration
        .lock()
        .await
        .as_mut()
        .unwrap()
        .proxy_hosts[0]
        .forward_host = BACKEND.into();
    let answers = Arc::new(AtomicUsize::new(0));
    let seen = answers.clone();
    let dns = DnsFixture::new(move |request| {
        let mut result = answer(request.clone(), Some(Ipv4Addr::LOCALHOST));
        if request.queries[0].name() == &name(BACKEND)
            && request.queries[0].query_type() == RecordType::A
        {
            let n = seen.fetch_add(1, Ordering::SeqCst);
            if n > 0 {
                return answer(request, Some(Ipv4Addr::new(169, 254, 169, 254)));
            }
            result.add_answer(Record::from_rdata(
                name("unrelated.example.net"),
                0,
                RData::A(A(Ipv4Addr::new(169, 254, 169, 254))),
            ));
        }
        result
    })
    .await;
    let result = fixture.probe(&dns).await;
    assert_eq!(result.stages.upstream.code, Code::UpstreamResponded);
    assert_eq!(answers.load(Ordering::SeqCst), 1);
    assert_eq!(http.requests.lock().await.len(), 1);
    fixture.assert_pure();
    for ip in [
        "0.0.0.0",
        "169.254.169.254",
        "255.255.255.255",
        "224.0.0.1",
        "100.100.100.200",
        "168.63.129.16",
        "::",
        "fe80::1",
        "ff02::1",
        "fd00:ec2::254",
        "::ffff:169.254.169.254",
    ] {
        assert!(!upstream::allowed(ip.parse().unwrap()), "unsafe {ip}");
    }
    for ip in [
        "127.0.0.1",
        "10.0.0.1",
        "192.168.1.1",
        "172.16.1.1",
        "100.64.0.1",
        "fd12::1",
        "::1",
    ] {
        assert!(
            upstream::allowed(ip.parse().unwrap()),
            "configured unicast {ip}"
        );
    }
}
#[tokio::test]
async fn cname_cycles_and_foreign_address_records_cannot_produce_dns_success() {
    for cycle in [false, true] {
        let dns = DnsFixture::new(move |request| {
            let mut result = response(&request);
            if matches!(
                request.queries[0].query_type(),
                RecordType::A | RecordType::AAAA
            ) && cycle
            {
                let target = if request.queries[0].name() == &name(DOMAIN) {
                    "cycle.example.net"
                } else {
                    DOMAIN
                };
                result.add_answer(Record::from_rdata(
                    request.queries[0].name().clone(),
                    0,
                    RData::CNAME(CNAME(name(target))),
                ));
            } else if request.queries[0].query_type() == RecordType::A {
                result.add_answer(Record::from_rdata(
                    name("unrelated.example.net"),
                    0,
                    RData::A(A(Ipv4Addr::LOCALHOST)),
                ));
            }
            result
        })
        .await;
        let fixture = Fixture::new(1).await;
        let result = fixture.probe(&dns).await;
        assert_ne!(result.stages.dns.status, Status::Passed);
        assert!(dns.queries.lock().await.len() <= 20);
        fixture.assert_pure();
    }
}
#[tokio::test]
async fn changed_configuration_discards_positive_network_results_without_engine_or_file_writes() {
    let http = HttpFixture::new(200, None, true).await;
    let fixture = Fixture::new(http.port).await;
    let dns = DnsFixture::normal().await;
    let runtime = fixture.runtime.clone();
    let request = fixture.request();
    let resolver = dns.resolver();
    let check =
        tokio::spawn(async move { runtime.diagnose_domain_inner(request, Some(resolver)).await });
    timeout(Duration::from_secs(2), http.started.notified())
        .await
        .unwrap();
    fixture
        .runtime
        .apply_sequence
        .fetch_add(1, Ordering::SeqCst);
    http.release.add_permits(1);
    let result = check.await.unwrap().unwrap();
    assert_eq!(result.stages.configuration.code, Code::ConfigurationChanged);
    for stage in [
        &result.stages.dns,
        &result.stages.upstream,
        &result.stages.tls,
    ] {
        assert_eq!(stage.status, Status::Unknown);
        assert_eq!(stage.code, Code::Skipped);
        assert!(stage.addresses.is_empty());
        assert!(stage.http_status.is_none());
    }
    fixture.assert_pure();
}
#[tokio::test]
async fn admission_timeout_and_request_cancellation_release_bounded_resources() {
    let http = HttpFixture::new(200, None, true).await;
    let fixture = Fixture::new(http.port).await;
    let dns = DnsFixture::normal().await;
    let permits = fixture
        .runtime
        .diagnostics_admission
        .acquire_many(2)
        .await
        .unwrap();
    assert!(matches!(
        fixture.runtime.diagnose_domain(fixture.request()).await,
        Err(Error::Busy)
    ));
    drop(permits);
    let runtime = fixture.runtime.clone();
    let request = fixture.request();
    let resolver = dns.resolver();
    let check =
        tokio::spawn(async move { runtime.diagnose_domain_inner(request, Some(resolver)).await });
    timeout(Duration::from_secs(2), http.started.notified())
        .await
        .unwrap();
    check.abort();
    let _ = check.await;
    assert_eq!(fixture.runtime.diagnostics_admission.available_permits(), 2);
    let start = Instant::now();
    let result = fixture.probe(&dns).await;
    assert_eq!(result.stages.upstream.code, Code::UpstreamTimeout);
    assert_eq!(result.stages.dns.code, Code::DnsResolved);
    assert!(start.elapsed() < Duration::from_secs(5));
    fixture.assert_pure();
}

struct TlsFixture {
    port: u16,
    pem: String,
    task: JoinHandle<()>,
    seen_sni: Arc<Mutex<Vec<String>>>,
}
impl Drop for TlsFixture {
    fn drop(&mut self) {
        self.task.abort();
    }
}
impl TlsFixture {
    async fn new() -> Self {
        crate::runtime::tls::ensure_crypto_provider();
        let cert = rcgen::generate_simple_self_signed(vec![SNI.into()]).unwrap();
        let pem = cert.cert.pem();
        let key = rustls::pki_types::PrivatePkcs8KeyDer::from(cert.signing_key.serialize_der());
        let config = Arc::new(
            rustls::ServerConfig::builder()
                .with_no_client_auth()
                .with_single_cert(vec![cert.cert.der().clone()], key.into())
                .unwrap(),
        );
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let seen_sni = Arc::new(Mutex::new(Vec::new()));
        let seen = seen_sni.clone();
        let task = tokio::spawn(async move {
            let mut children = JoinSet::new();
            loop {
                tokio::select! {accepted=listener.accept()=>{let(stream,_)=accepted.unwrap();let config=config.clone();let seen=seen.clone();children.spawn(async move{tls_serve(stream,config,seen).await;});},_=children.join_next(),if !children.is_empty()=>{}}
            }
        });
        Self {
            port,
            pem,
            task,
            seen_sni,
        }
    }
}
async fn tls_serve(
    mut stream: TcpStream,
    config: Arc<rustls::ServerConfig>,
    seen: Arc<Mutex<Vec<String>>>,
) {
    let Ok(mut connection) = rustls::ServerConnection::new(config) else {
        return;
    };
    let mut plain = Vec::new();
    let mut observed = false;
    loop {
        while connection.wants_write() {
            let mut bytes = Vec::new();
            if connection.write_tls(&mut bytes).is_err() {
                return;
            }
            if stream.write_all(&bytes).await.is_err() {
                return;
            }
        }
        if !connection.is_handshaking() && !observed {
            seen.lock()
                .await
                .push(connection.server_name().unwrap_or("").to_owned());
            observed = true;
        }
        let mut buffer = [0; 16384];
        let Ok(n) = stream.read(&mut buffer).await else {
            return;
        };
        if n == 0 {
            return;
        }
        if connection.read_tls(&mut Cursor::new(&buffer[..n])).is_err()
            || connection.process_new_packets().is_err()
        {
            return;
        }
        let mut bytes = [0; 4096];
        while let Ok(n) = connection.reader().read(&mut bytes) {
            if n == 0 {
                break;
            }
            plain.extend_from_slice(&bytes[..n]);
        }
        if plain.windows(4).any(|bytes| bytes == b"\r\n\r\n") {
            if connection
                .writer()
                .write_all(b"HTTP/1.1 204 Fixture\r\nConnection: close\r\n\r\n")
                .is_err()
            {
                return;
            }
            while connection.wants_write() {
                let mut bytes = Vec::new();
                if connection.write_tls(&mut bytes).is_err() {
                    return;
                }
                if stream.write_all(&bytes).await.is_err() {
                    return;
                }
            }
            return;
        }
    }
}
#[tokio::test]
async fn https_pins_backend_separately_from_sni_and_honors_custom_trust_and_disabled_verification()
{
    for mode in 0..3 {
        let tls = TlsFixture::new().await;
        let fixture = Fixture::new(tls.port).await;
        let dns = DnsFixture::normal().await;
        {
            let mut configuration = fixture.runtime.active_configuration.lock().await;
            let config = configuration.as_mut().unwrap();
            let host = &mut config.proxy_hosts[0];
            host.forward_scheme = "https".into();
            host.forward_host = BACKEND.into();
            host.upstream_tls = Some(UpstreamTls {
                verify: mode != 2,
                server_name: Some(if mode == 1 { "wrong.example.net" } else { SNI }.into()),
                trusted_ca_id: if mode == 2 { None } else { Some(HOST.into()) },
            });
            if mode != 2 {
                config.trusted_cas.push(TrustedCa {
                    id: HOST.into(),
                    pem: tls.pem.clone(),
                    fingerprint_sha256: revision(),
                });
            }
        }
        let result = fixture.probe(&dns).await;
        if mode == 1 {
            assert_ne!(result.stages.tls.status, Status::Passed);
            assert_eq!(result.stages.tls.code, Code::TlsFailed);
        } else {
            assert_eq!(result.stages.upstream.code, Code::UpstreamResponded);
            assert_eq!(
                result.stages.tls.code,
                if mode == 2 {
                    Code::TlsVerificationDisabled
                } else {
                    Code::TlsVerified
                }
            );
            assert_eq!(tls.seen_sni.lock().await.as_slice(), &[SNI.to_owned()]);
        }
        assert!(
            !dns.queries
                .lock()
                .await
                .iter()
                .any(|query| query == &format!("{SNI}."))
        );
        fixture.assert_pure();
    }
}

#[tokio::test]
async fn numeric_sni_and_forward_names_cannot_escape_pinned_addresses() {
    for spelling in ["2130706433", "0x7f000001", "127.1", "127.0.0.1"] {
        let trap = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let fixture = Fixture::new(trap.local_addr().unwrap().port()).await;
        let dns =
            DnsFixture::new(|request| answer(request, Some(Ipv4Addr::new(127, 0, 0, 2)))).await;
        {
            let mut active = fixture.runtime.active_configuration.lock().await;
            let host = &mut active.as_mut().unwrap().proxy_hosts[0];
            host.forward_scheme = "https".into();
            host.forward_host = BACKEND.into();
            host.upstream_tls = Some(UpstreamTls {
                verify: false,
                server_name: Some(spelling.into()),
                trusted_ca_id: None,
            });
        }
        let result = fixture.probe(&dns).await;
        assert_eq!(result.stages.upstream.code, Code::UpstreamUnreachable);
        assert_ne!(result.stages.tls.status, Status::Passed);
        assert!(
            timeout(Duration::from_millis(80), trap.accept())
                .await
                .is_err(),
            "numeric SNI bypassed pin: {spelling}"
        );
        if spelling == "127.0.0.1" {
            fixture.assert_pure();
            continue;
        }
        {
            let mut active = fixture.runtime.active_configuration.lock().await;
            let host = &mut active.as_mut().unwrap().proxy_hosts[0];
            host.forward_scheme = "http".into();
            host.forward_host = spelling.into();
            host.upstream_tls = None;
        }
        assert_eq!(
            fixture.probe(&dns).await.stages.upstream.code,
            Code::UpstreamUnreachable
        );
        assert!(
            timeout(Duration::from_millis(80), trap.accept())
                .await
                .is_err(),
            "numeric forward host bypassed pin: {spelling}"
        );
        fixture.assert_pure();
    }
}

#[tokio::test]
async fn entire_snapshot_wait_is_bounded_and_releases_admission() {
    let fixture = Fixture::new(1).await;
    let active = fixture.runtime.active_configuration.lock().await;
    let started = Instant::now();
    let result = fixture
        .runtime
        .diagnose_domain_budget(fixture.request(), None, Duration::from_millis(240))
        .await;
    assert!(matches!(result, Err(Error::Unavailable)));
    assert!(started.elapsed() < Duration::from_secs(1));
    assert_eq!(fixture.runtime.diagnostics_admission.available_permits(), 2);
    drop(active);
    fixture.assert_pure();
}

#[tokio::test]
async fn configured_system_ca_bundle_is_used_without_platform_root_fallback() {
    for matches in [true, false] {
        let tls = TlsFixture::new().await;
        let mut fixture = Fixture::new(tls.port).await;
        let root = if matches {
            tls.pem.clone()
        } else {
            rcgen::generate_simple_self_signed(vec!["unrelated-root.example.net".into()])
                .unwrap()
                .cert
                .pem()
        };
        let path = fixture.path.join("synthetic-public-root.pem");
        std::fs::write(&path, &root).unwrap();
        Arc::get_mut(&mut fixture.runtime)
            .unwrap()
            .settings
            .system_ca_bundle = path.clone();
        {
            let mut active = fixture.runtime.active_configuration.lock().await;
            let host = &mut active.as_mut().unwrap().proxy_hosts[0];
            host.forward_scheme = "https".into();
            host.upstream_tls = Some(UpstreamTls {
                verify: true,
                server_name: Some(SNI.into()),
                trusted_ca_id: None,
            });
        }
        let dns = DnsFixture::normal().await;
        let result = fixture.probe(&dns).await;
        assert_eq!(
            result.stages.tls.code,
            if matches {
                Code::TlsVerified
            } else {
                Code::TlsFailed
            }
        );
        assert_eq!(
            result.stages.upstream.code,
            if matches {
                Code::UpstreamResponded
            } else {
                Code::UpstreamUnreachable
            }
        );
        assert_eq!(std::fs::read_to_string(path).unwrap(), root);
        assert_eq!(fixture.calls.load(Ordering::SeqCst), 0);
    }
}

#[tokio::test]
async fn final_snapshot_mutex_wait_cannot_outlive_the_request_deadline() {
    let http = HttpFixture::new(200, None, true).await;
    let fixture = Fixture::new(http.port).await;
    let dns = DnsFixture::normal().await;
    let runtime = fixture.runtime.clone();
    let request = fixture.request();
    let resolver = dns.resolver();
    let start = Instant::now();
    let check = tokio::spawn(async move {
        runtime
            .diagnose_domain_budget(
                request,
                Some(resolver::Resolver::provided(resolver)),
                Duration::from_millis(400),
            )
            .await
    });
    timeout(Duration::from_millis(250), http.started.notified())
        .await
        .unwrap();
    let guard = fixture.runtime.active_configuration.lock().await;
    http.release.add_permits(1);
    let result = check.await.unwrap().unwrap();
    assert_eq!(result.stages.configuration.code, Code::ConfigurationChanged);
    assert_eq!(result.stages.upstream.code, Code::Skipped);
    assert!(start.elapsed() < Duration::from_secs(1));
    assert_eq!(fixture.runtime.diagnostics_admission.available_permits(), 2);
    assert!(fixture.runtime.apply_lock.try_lock().is_ok());
    drop(guard);
    fixture.assert_pure();
}

#[tokio::test]
async fn configured_hosts_aliases_and_short_lan_search_names_match_appliance_resolution() {
    for backend in ["host.docker.internal", "localhost"] {
        let http = HttpFixture::new(200, None, false).await;
        let fixture = Fixture::new(http.port).await;
        fixture
            .runtime
            .active_configuration
            .lock()
            .await
            .as_mut()
            .unwrap()
            .proxy_hosts[0]
            .forward_host = backend.into();
        let dns = DnsFixture::new(|request| answer(request, None)).await;
        let policy = resolver::Resolver::with_policy(
            dns.resolver(),
            b"127.0.0.1 host.docker.internal localhost\n",
            vec![],
            1,
        );
        let result = fixture
            .runtime
            .diagnose_domain_budget(fixture.request(), Some(policy), Duration::from_secs(12))
            .await
            .unwrap();
        assert_eq!(result.stages.dns.code, Code::DnsNotFound);
        assert_eq!(result.stages.upstream.code, Code::UpstreamResponded);
        assert!(
            !dns.queries
                .lock()
                .await
                .iter()
                .any(|query| query == &format!("{backend}."))
        );
        assert_eq!(http.requests.lock().await.len(), 1);
        fixture.assert_pure();
    }
    let http = HttpFixture::new(200, None, false).await;
    let fixture = Fixture::new(http.port).await;
    fixture
        .runtime
        .active_configuration
        .lock()
        .await
        .as_mut()
        .unwrap()
        .proxy_hosts[0]
        .forward_host = "nas".into();
    let dns = DnsFixture::new(|request| {
        if request.queries[0].name() == &name("nas.home.arpa") {
            answer(request, Some(Ipv4Addr::LOCALHOST))
        } else {
            answer(request, None)
        }
    })
    .await;
    let policy = resolver::Resolver::with_policy(dns.resolver(), b"", vec![name("home.arpa")], 1);
    let result = fixture
        .runtime
        .diagnose_domain_budget(fixture.request(), Some(policy), Duration::from_secs(12))
        .await
        .unwrap();
    assert_eq!(result.stages.upstream.code, Code::UpstreamResponded);
    assert!(!dns.queries.lock().await.iter().any(|query| query == "nas."));
    assert!(
        dns.queries
            .lock()
            .await
            .iter()
            .any(|query| query == "nas.home.arpa.")
    );
    fixture.assert_pure();
}

#[tokio::test]
async fn dead_engine_before_or_during_probe_never_returns_an_active_success() {
    let http = HttpFixture::new(200, None, true).await;
    let fixture = Fixture::new(http.port).await;
    let dns = DnsFixture::normal().await;
    fixture.engine_alive.store(false, Ordering::SeqCst);
    let result = fixture.probe(&dns).await;
    assert_eq!(result.stages.configuration.code, Code::RuntimeUnavailable);
    assert!(dns.queries.lock().await.is_empty());
    assert!(http.requests.lock().await.is_empty());
    fixture.engine_alive.store(true, Ordering::SeqCst);
    let runtime = fixture.runtime.clone();
    let request = fixture.request();
    let resolver = dns.resolver();
    let check =
        tokio::spawn(async move { runtime.diagnose_domain_inner(request, Some(resolver)).await });
    timeout(Duration::from_secs(2), http.started.notified())
        .await
        .unwrap();
    fixture.engine_alive.store(false, Ordering::SeqCst);
    http.release.add_permits(1);
    let result = check.await.unwrap().unwrap();
    assert_eq!(result.stages.configuration.code, Code::ConfigurationChanged);
    assert_eq!(result.stages.upstream.code, Code::Skipped);
    assert!(fixture.liveness_reads.load(Ordering::SeqCst) >= 3);
    fixture.assert_pure();
}

#[tokio::test]
async fn fast_direct_a_survives_stalled_cname_and_aaaa_without_optional_queries() {
    let cnames = Arc::new(AtomicUsize::new(0));
    let seen = cnames.clone();
    let dns = DnsFixture::new_filtered(move |request| match request.queries[0].query_type() {
        RecordType::CNAME => {
            seen.fetch_add(1, Ordering::SeqCst);
            None
        }
        RecordType::AAAA => None,
        _ => Some(answer(request, Some(Ipv4Addr::LOCALHOST))),
    })
    .await;
    let started = Instant::now();
    let ips = dns::addresses(
        &dns.resolver(),
        "backend-tls",
        Instant::now() + Duration::from_millis(180),
    )
    .await
    .unwrap();
    assert_eq!(ips, vec![std::net::IpAddr::V4(Ipv4Addr::LOCALHOST)]);
    assert_eq!(cnames.load(Ordering::SeqCst), 0);
    assert!(started.elapsed() < Duration::from_secs(1));
}

#[tokio::test]
async fn upstream_http_keeps_its_budget_after_dns_waits_for_the_other_family() {
    let http = HttpFixture::new(200, None, false).await;
    let fixture = Fixture::new(http.port).await;
    fixture
        .runtime
        .active_configuration
        .lock()
        .await
        .as_mut()
        .unwrap()
        .proxy_hosts[0]
        .forward_host = "backend-tls".into();
    let dns = DnsFixture::new_filtered(|request| {
        if request.queries[0].query_type() == RecordType::CNAME
            || (request.queries[0].query_type() == RecordType::AAAA
                && request.queries[0].name() == &name("backend-tls"))
        {
            None
        } else {
            Some(answer(request, Some(Ipv4Addr::LOCALHOST)))
        }
    })
    .await;
    let start = Instant::now();
    let result = fixture.probe(&dns).await;
    assert_eq!(result.stages.upstream.code, Code::UpstreamResponded);
    assert!(start.elapsed() < Duration::from_secs(5));
    assert_eq!(http.requests.lock().await.len(), 1);
    fixture.assert_pure();
}

#[tokio::test]
async fn address_family_chain_proofs_are_rooted_and_malformed_peer_is_fatal() {
    use hickory_resolver::{
        lookup::Lookup,
        proto::{op::Query, rr::rdata::AAAA},
    };
    let origin = name(BACKEND);
    let target = name("alias.example.net");
    let make =
        |kind, records| Lookup::new_with_max_ttl(Query::query(origin.clone(), kind), records);
    let chain = make(
        RecordType::A,
        vec![
            Record::from_rdata(origin.clone(), 0, RData::CNAME(CNAME(target.clone()))),
            Record::from_rdata(target.clone(), 0, RData::A(A(Ipv4Addr::LOCALHOST))),
            Record::from_rdata(
                name("unrelated.example.net"),
                0,
                RData::A(A(Ipv4Addr::new(169, 254, 169, 254))),
            ),
        ],
    );
    assert_eq!(
        dns::proven_addresses(&chain, &origin, RecordType::A).unwrap(),
        vec![std::net::IpAddr::V4(Ipv4Addr::LOCALHOST)]
    );
    let foreign = make(
        RecordType::A,
        vec![Record::from_rdata(
            name("unrelated.example.net"),
            0,
            RData::A(A(Ipv4Addr::LOCALHOST)),
        )],
    );
    assert!(matches!(
        dns::proven_addresses(&foreign, &origin, RecordType::A),
        Err(dns::DnsError::Missing)
    ));
    let dns = DnsFixture::new(move |request| {
        let mut result = response(&request);
        if request.queries[0].query_type() == RecordType::A {
            result.add_answer(Record::from_rdata(
                request.queries[0].name().clone(),
                0,
                RData::A(A(Ipv4Addr::LOCALHOST)),
            ));
        } else {
            result.add_answer(Record::from_rdata(
                origin.clone(),
                0,
                RData::CNAME(CNAME(target.clone())),
            ));
            result.add_answer(Record::from_rdata(
                target.clone(),
                0,
                RData::CNAME(CNAME(origin.clone())),
            ));
            result.add_answer(Record::from_rdata(
                origin.clone(),
                0,
                RData::AAAA(AAAA(std::net::Ipv6Addr::LOCALHOST)),
            ));
        }
        result
    })
    .await;
    assert!(matches!(
        dns::addresses(
            &dns.resolver(),
            BACKEND,
            Instant::now() + Duration::from_secs(1)
        )
        .await,
        Err(dns::DnsError::Invalid)
    ));
}

#[tokio::test]
async fn non_in_class_records_at_rooted_owners_cannot_authorize_an_address_or_alias() {
    use hickory_resolver::proto::rr::DNSClass;
    use hickory_resolver::{lookup::Lookup, proto::op::Query};
    let origin = name(BACKEND);
    for data in [
        RData::A(A(Ipv4Addr::LOCALHOST)),
        RData::CNAME(CNAME(name("alias.example.net"))),
    ] {
        let mut wrong = Record::from_rdata(origin.clone(), 0, data);
        wrong.dns_class = DNSClass::CH;
        let lookup = Lookup::new_with_max_ttl(
            Query::query(origin.clone(), RecordType::A),
            [
                Record::from_rdata(origin.clone(), 0, RData::A(A(Ipv4Addr::LOCALHOST))),
                wrong,
            ],
        );
        assert!(matches!(
            dns::proven_addresses(&lookup, &origin, RecordType::A),
            Err(dns::DnsError::Invalid)
        ));
    }
    for alias in [false, true] {
        let dns = DnsFixture::new(move |request| {
            let mut result = answer(request.clone(), Some(Ipv4Addr::LOCALHOST));
            if request.queries[0].query_type() == RecordType::A {
                let data = if alias {
                    RData::CNAME(CNAME(name("foreign-class.example.net")))
                } else {
                    RData::A(A(Ipv4Addr::new(169, 254, 169, 254)))
                };
                let mut foreign = Record::from_rdata(request.queries[0].name().clone(), 0, data);
                foreign.dns_class = DNSClass::CH;
                result.add_answer(foreign);
            }
            result
        })
        .await;
        let result = dns::addresses(
            &dns.resolver(),
            BACKEND,
            Instant::now() + Duration::from_secs(1),
        )
        .await;
        assert!(
            matches!(result, Err(dns::DnsError::Invalid)),
            "alias={alias}, result={result:?}"
        );
    }
}
#[tokio::test]
async fn positive_multihop_alias_keeps_its_own_address_proof_and_ignores_foreign_chains() {
    let http = HttpFixture::new(200, None, false).await;
    let fixture = Fixture::new(http.port).await;
    fixture
        .runtime
        .active_configuration
        .lock()
        .await
        .as_mut()
        .unwrap()
        .proxy_hosts[0]
        .forward_host = BACKEND.into();
    let dns = DnsFixture::new(|request| {
        let owner = request.queries[0].name().clone();
        let next = if owner == name(BACKEND) {
            Some("middle.example.net")
        } else if owner == name("middle.example.net") {
            Some("terminal.example.net")
        } else {
            None
        };
        let mut result = if let Some(next) = next {
            let mut result = response(&request);
            result.add_answer(Record::from_rdata(
                owner,
                0,
                RData::CNAME(CNAME(name(next))),
            ));
            result
        } else {
            answer(request.clone(), Some(Ipv4Addr::LOCALHOST))
        };
        result.add_answer(Record::from_rdata(
            name("foreign.example.net"),
            0,
            RData::CNAME(CNAME(name("wrong.example.net"))),
        ));
        result.add_answer(Record::from_rdata(
            name("wrong.example.net"),
            0,
            RData::A(A(Ipv4Addr::new(169, 254, 169, 254))),
        ));
        result
    })
    .await;
    let result = fixture.probe(&dns).await;
    assert_eq!(result.stages.upstream.code, Code::UpstreamResponded);
    assert!(
        !dns.queries
            .lock()
            .await
            .iter()
            .any(|name| name == "foreign.example.net." || name == "wrong.example.net.")
    );
    assert_eq!(http.requests.lock().await.len(), 1);
    fixture.assert_pure();
}
