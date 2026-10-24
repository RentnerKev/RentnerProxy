use super::*;
use crate::runtime::{
    RuntimeSettings,
    crowdsec_dashboard::CrowdSecDashboardQuery,
    engine::{EngineError, EngineFuture, ProxyEngine},
};
use axum::body::Bytes;
use std::{
    future::Future,
    path::PathBuf,
    pin::Pin,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::oneshot,
    time::timeout,
};

const KEY: &str = "synthetic-dashboard-bouncer-key";
const DECISIONS: &str = r#"[{"id":1,"type":"ban","scope":"Ip","value":"203.0.113.1","origin":"CAPI","scenario":"community","duration":"1h"}]"#;
static NEXT_ID: AtomicUsize = AtomicUsize::new(0);

struct MetricsEngine(AtomicUsize);

impl ProxyEngine for MetricsEngine {
    fn start<'a>(&'a self, _: &'a str, _: &'a str) -> EngineFuture<'a> {
        Box::pin(async { panic!("dashboard must not start Caddy") })
    }

    fn load<'a>(&'a self, _: &'a str) -> EngineFuture<'a> {
        Box::pin(async { panic!("dashboard must not reload Caddy") })
    }

    fn probe<'a>(&'a self, _: &'a str) -> EngineFuture<'a> {
        Box::pin(async { panic!("dashboard must not probe a revision") })
    }

    fn shutdown(&self) -> EngineFuture<'_> {
        Box::pin(async { panic!("dashboard must not stop Caddy") })
    }

    fn is_running(&self) -> Pin<Box<dyn Future<Output = bool> + Send + '_>> {
        Box::pin(async { true })
    }

    fn metrics(&self) -> Pin<Box<dyn Future<Output = Result<Bytes, EngineError>> + Send + '_>> {
        self.0.fetch_add(1, Ordering::SeqCst);
        Box::pin(async {
            Ok(Bytes::from_static(
                b"crowdsec_requests_blocked_total{origin=\"CAPI\"} 7\n",
            ))
        })
    }
}

struct Fixture {
    runtime: Arc<ProxyRuntime>,
    engine: Arc<MetricsEngine>,
    root: PathBuf,
}

impl Fixture {
    async fn external(url: String) -> Self {
        let root = std::env::temp_dir().join(format!(
            "rp-dashboard-{}-{}",
            std::process::id(),
            NEXT_ID.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir(&root).unwrap();
        let engine = Arc::new(MetricsEngine(AtomicUsize::new(0)));
        let runtime = ProxyRuntime::new(
            RuntimeSettings::new(root.clone(), 18_080),
            Some(engine.clone()),
        );
        {
            let mut state = runtime.crowdsec.lock().await;
            state.desired = DesiredProvider::External {
                api_url: url.clone(),
            };
            state.active = ActiveProvider::External {
                api_url: url,
                api_key: SecretString::new(KEY.to_owned()),
            };
        }
        Self {
            runtime,
            engine,
            root,
        }
    }

    async fn snapshot(&self, query: &CrowdSecDashboardQuery) -> serde_json::Value {
        let snapshot = timeout(
            Duration::from_secs(3),
            self.runtime.crowdsec_dashboard(query),
        )
        .await
        .unwrap();
        let json = serde_json::to_value(snapshot).unwrap();
        assert!(!json.to_string().contains(KEY));
        json
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

async fn accept_request(listener: &TcpListener, key: &str) -> TcpStream {
    let (mut stream, _) = timeout(Duration::from_secs(3), listener.accept())
        .await
        .unwrap()
        .unwrap();
    timeout(Duration::from_secs(3), async {
        let mut headers = Vec::new();
        while !headers.ends_with(b"\r\n\r\n") {
            headers.push(stream.read_u8().await.unwrap());
            assert!(headers.len() < 4_096);
        }
        let headers = String::from_utf8(headers).unwrap().to_ascii_lowercase();
        assert!(headers.starts_with("get /v1/decisions http/1.1\r\n"));
        assert!(headers.contains(&format!("x-api-key: {key}\r\n")));
        assert!(headers.contains("accept: application/json\r\n"));
    })
    .await
    .unwrap();
    stream
}

async fn respond(stream: &mut TcpStream, body: &str) {
    stream
        .write_all(
            format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            )
            .as_bytes(),
        )
        .await
        .unwrap();
    stream.shutdown().await.unwrap();
}

#[tokio::test]
async fn dashboard_cache_keeps_filtering_independent_and_invalidates_when_credentials_change() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/", listener.local_addr().unwrap());
    let fixture = Fixture::external(url.clone()).await;
    let server = tokio::spawn(async move {
        for key in [KEY, "replacement-dashboard-key"] {
            let mut stream = accept_request(&listener, key).await;
            respond(&mut stream, DECISIONS).await;
        }
    });
    let first = fixture.snapshot(&CrowdSecDashboardQuery::default()).await;
    assert_eq!(first["decisions"]["entries"][0]["id"], 1);
    assert_eq!(first["metrics"]["blockedRequests"], 7);
    let filtered = fixture
        .snapshot(&CrowdSecDashboardQuery {
            search: "no matching ban".to_owned(),
            ..Default::default()
        })
        .await;
    assert_eq!(filtered["decisions"]["total"], 1);
    assert_eq!(filtered["decisions"]["filteredTotal"], 0);
    assert_eq!(fixture.engine.0.load(Ordering::SeqCst), 1);
    fixture.runtime.crowdsec.lock().await.active = ActiveProvider::External {
        api_url: url,
        api_key: SecretString::new("replacement-dashboard-key".to_owned()),
    };
    let refreshed = fixture.snapshot(&CrowdSecDashboardQuery::default()).await;
    assert_eq!(refreshed["decisions"]["entries"][0]["id"], 1);
    assert_eq!(fixture.engine.0.load(Ordering::SeqCst), 2);
    timeout(Duration::from_secs(3), server)
        .await
        .unwrap()
        .unwrap();
}

#[tokio::test]
async fn dashboard_discards_inflight_results_after_provider_is_disabled() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let fixture = Fixture::external(format!("http://{}/", listener.local_addr().unwrap())).await;
    let (entered, requested) = oneshot::channel();
    let (finish, released) = oneshot::channel();
    let server = tokio::spawn(async move {
        let mut stream = accept_request(&listener, KEY).await;
        entered.send(()).unwrap();
        timeout(Duration::from_secs(3), released)
            .await
            .unwrap()
            .unwrap();
        respond(&mut stream, DECISIONS).await;
    });
    let disable = async {
        timeout(Duration::from_secs(3), requested)
            .await
            .unwrap()
            .unwrap();
        {
            let mut state = fixture.runtime.crowdsec.lock().await;
            state.desired = DesiredProvider::Disabled;
            state.active = ActiveProvider::Disabled;
        }
        finish.send(()).unwrap();
    };
    let query = CrowdSecDashboardQuery::default();
    let (snapshot, ()) = tokio::join!(fixture.snapshot(&query), disable);
    assert!(snapshot["metrics"].is_null());
    assert!(snapshot["decisions"].is_null());
    assert!(
        fixture
            .runtime
            .crowdsec_dashboard_cache
            .lock()
            .await
            .is_none()
    );
    server.await.unwrap();
}

#[tokio::test]
async fn dashboard_keeps_metrics_when_decisions_are_invalid_redirected_or_oversized() {
    for raw in [
        "HTTP/1.1 200 OK\r\nContent-Length: 8\r\n\r\nnot json".to_owned(),
        "HTTP/1.1 302 Redirect\r\nLocation: https://must-not-contact.example.invalid/\r\nContent-Length: 0\r\n\r\n".to_owned(),
        "HTTP/1.1 503 Unavailable\r\nContent-Length: 0\r\n\r\n".to_owned(),
        "HTTP/1.1 200 OK\r\nContent-Length: 16777217\r\n\r\n".to_owned(),
        "HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\n[]".to_owned(),
    ] {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let fixture =
            Fixture::external(format!("http://{}/", listener.local_addr().unwrap())).await;
        let server = tokio::spawn(async move {
            let mut stream = accept_request(&listener, KEY).await;
            stream.write_all(raw.as_bytes()).await.unwrap();
            stream.shutdown().await.unwrap();
        });
        let snapshot = fixture.snapshot(&CrowdSecDashboardQuery::default()).await;
        assert_eq!(snapshot["metrics"]["blockedRequests"], 7);
        assert!(snapshot["decisions"].is_null());
        server.await.unwrap();
    }
}
