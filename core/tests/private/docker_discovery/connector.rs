use super::*;
use axum::{
    Router,
    body::{Body, Bytes},
    extract::{Request, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::any,
};
use models::{Error, Status};
use std::{
    convert::Infallible,
    pin::Pin,
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU8},
    },
    task::{Context, Poll},
    time::Duration,
};
use tokio::sync::{Mutex, mpsc};

struct EventBody(mpsc::Receiver<Bytes>);
impl hyper::body::Body for EventBody {
    type Data = Bytes;
    type Error = Infallible;
    fn poll_frame(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<hyper::body::Frame<Bytes>, Self::Error>>> {
        self.0
            .poll_recv(cx)
            .map(|chunk| chunk.map(|chunk| Ok(hyper::body::Frame::data(chunk))))
    }
}
#[derive(Default)]
struct Fixture {
    containers: Mutex<Vec<Value>>,
    requests: Mutex<Vec<(String, String)>>,
    streams: Mutex<Vec<mpsc::Sender<Bytes>>>,
    fail: AtomicBool,
    missing_inspect: AtomicBool,
    fail_inspect: AtomicBool,
    response_mode: AtomicU8,
}
async fn response(State(state): State<Arc<Fixture>>, request: Request) -> Response {
    let path = request.uri().path();
    state
        .requests
        .lock()
        .await
        .push((request.method().to_string(), request.uri().to_string()));
    if state.fail.load(Ordering::SeqCst) {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    }
    if path == "/v1.47/events" {
        let (tx, rx) = mpsc::channel(8);
        state.streams.lock().await.push(tx);
        return Response::new(Body::new(EventBody(rx)));
    }
    if path.starts_with("/v1.47/containers/") && path != "/v1.47/containers/json" {
        if state.fail_inspect.load(Ordering::SeqCst) {
            return StatusCode::SERVICE_UNAVAILABLE.into_response();
        }
        if state.missing_inspect.load(Ordering::SeqCst) && path.contains(&"a".repeat(64)) {
            return StatusCode::NOT_FOUND.into_response();
        }
    }
    let containers = state.containers.lock().await;
    if path == "/v1.47/containers/json" {
        match state.response_mode.load(Ordering::SeqCst) {
            1 => {
                return (
                    StatusCode::FOUND,
                    [("location", "/redirected-private-endpoint")],
                )
                    .into_response();
            }
            2 => return "private Docker error payload".into_response(),
            3 => return vec![b' '; 2 * 1024 * 1024 + 1].into_response(),
            _ => {}
        }
        return axum::Json(
            containers
                .iter()
                .map(|value| json!({"Id":value["Id"],"Labels":value["Config"]["Labels"]}))
                .collect::<Vec<_>>(),
        )
        .into_response();
    }
    let value = containers
        .iter()
        .find(|value| path == format!("/v1.47/containers/{}/json", value["Id"].as_str().unwrap()));
    match value {
        Some(value) => axum::Json(value.clone()).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}
async fn fixture() -> (String, Arc<Fixture>, tokio::task::JoinHandle<()>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    let fixture = Arc::new(Fixture::default());
    let router = Router::new()
        .fallback(any(response))
        .with_state(fixture.clone());
    let task = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    (endpoint, fixture, task)
}
async fn ready(discovery: &Discovery) -> models::Snapshot {
    tokio::time::timeout(Duration::from_secs(8), async {
        loop {
            let value = discovery.status().await.unwrap();
            if value.status == Status::Ready {
                return value;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("discovery becomes ready")
}

#[tokio::test]
async fn connector_uses_only_filtered_get_reads_and_sorts_complete_inventory() {
    let (endpoint, fixture, task) = fixture().await;
    let mut opted_out = container('c');
    opted_out["Config"]["Labels"]
        .as_object_mut()
        .unwrap()
        .remove(labels::ENABLE);
    *fixture.containers.lock().await = vec![container('b'), opted_out, container('a')];
    let docker = client::Docker::new(&endpoint).unwrap();
    let result = docker.inventory().await.unwrap();
    assert_eq!(
        result.iter().map(|v| &v.container_id).collect::<Vec<_>>(),
        [&"a".repeat(64), &"b".repeat(64)]
    );
    assert!(
        result
            .iter()
            .all(|v| v.issues == [models::Issue::DomainConflict])
    );
    let requests = fixture.requests.lock().await;
    assert_eq!(requests.len(), 3);
    assert!(requests.iter().all(|(method, _)| method == "GET"));
    assert!(requests[0].1.contains("all=1&filters="));
    assert!(
        !requests
            .iter()
            .any(|(_, path)| path.contains(&"c".repeat(64)))
    );
    task.abort();
}

#[tokio::test]
async fn incomplete_inventory_errors_do_not_become_empty_success_and_duplicate_ids_are_rejected() {
    let (endpoint, fixture, task) = fixture().await;
    *fixture.containers.lock().await = vec![container('a'), container('a')];
    let docker = client::Docker::new(&endpoint).unwrap();
    assert_eq!(
        docker.inventory().await.unwrap_err(),
        Error::InvalidResponse
    );
    *fixture.containers.lock().await = (0..257).map(|_| container('a')).collect();
    assert_eq!(
        docker.inventory().await.unwrap_err(),
        Error::InventoryTooLarge
    );
    fixture.fail.store(true, Ordering::SeqCst);
    assert_eq!(
        docker.inventory().await.unwrap_err(),
        Error::EndpointUnavailable
    );
    task.abort();
}

#[tokio::test]
async fn connector_does_not_follow_redirects_and_bounds_untrusted_response_bodies() {
    let (endpoint, fixture, task) = fixture().await;
    let docker = client::Docker::new(&endpoint).unwrap();
    for (mode, error) in [
        (1, Error::EndpointUnavailable),
        (2, Error::InvalidResponse),
        (3, Error::InvalidResponse),
    ] {
        fixture.response_mode.store(mode, Ordering::SeqCst);
        assert_eq!(docker.inventory().await.unwrap_err(), error);
    }
    assert_eq!(
        fixture.requests.lock().await.len(),
        3,
        "redirects never reach another endpoint"
    );
    task.abort();
}

#[tokio::test]
async fn a_container_removed_after_listing_does_not_hide_remaining_candidates() {
    let (endpoint, fixture, task) = fixture().await;
    *fixture.containers.lock().await = vec![container('a'), container('b')];
    fixture.missing_inspect.store(true, Ordering::SeqCst);
    let docker = client::Docker::new(&endpoint).unwrap();
    let result = docker.inventory().await.unwrap();
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].container_id, "b".repeat(64));
    assert!(
        result[0].issues.is_empty(),
        "removed candidates cannot cause stale conflicts"
    );
    fixture.fail_inspect.store(true, Ordering::SeqCst);
    assert_eq!(
        docker.inventory().await.unwrap_err(),
        Error::EndpointUnavailable
    );
    task.abort();
}

#[tokio::test]
async fn events_coalesce_reconnect_and_configuration_replacement_cancel_old_reads() {
    let path = directory();
    let discovery = Discovery::new(path.clone());
    let (endpoint, fixture, task) = fixture().await;
    *fixture.containers.lock().await = vec![container('a')];
    discovery.start().await;
    discovery
        .save(save(Some(endpoint.clone()), true, 0))
        .await
        .unwrap();
    assert_eq!(ready(&discovery).await.candidates.len(), 1);
    let event_request = fixture
        .requests
        .lock()
        .await
        .iter()
        .find(|(_, path)| path.starts_with("/v1.47/events?"))
        .unwrap()
        .1
        .clone();
    let url = reqwest::Url::parse(&format!("{endpoint}{event_request}")).unwrap();
    let filters: Value = serde_json::from_str(
        &url.query_pairs()
            .find(|(key, _)| key == "filters")
            .unwrap()
            .1,
    )
    .unwrap();
    assert_eq!(
        filters["event"],
        json!([
            "create",
            "start",
            "stop",
            "die",
            "destroy",
            "rename",
            "update",
            "pause",
            "unpause",
            "connect",
            "disconnect"
        ])
    );
    let before = fixture.requests.lock().await.len();
    fixture.containers.lock().await[0]["NetworkSettings"]["Networks"]["proxy"]["IPAddress"] =
        json!("172.22.0.9");
    let event = format!(
        "{}\n",
        json!({"Type":"container","Action":"start","Actor":{"ID":"a".repeat(64)},"timeNano":123})
    )
    .repeat(100);
    fixture
        .streams
        .lock()
        .await
        .last()
        .unwrap()
        .send(Bytes::from(event))
        .await
        .unwrap();
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let value = discovery.status().await.unwrap();
            if value
                .candidates
                .first()
                .and_then(|v| v.target.as_ref())
                .is_some_and(|v| v.address == "172.22.0.9")
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    assert_eq!(
        fixture.requests.lock().await.len() - before,
        2,
        "one list/inspect scan for duplicate events"
    );
    fixture.streams.lock().await.clear();
    tokio::time::timeout(Duration::from_secs(8), async {
        loop {
            let value = discovery.status().await.unwrap();
            assert_eq!(
                value.status,
                Status::Ready,
                "clean EOF is a reconnect, not an outage"
            );
            assert!(!value.stale);
            assert_eq!(value.error, None);
            if !fixture.streams.lock().await.is_empty() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    assert_eq!(
        ready(&discovery).await.candidates[0]
            .target
            .as_ref()
            .unwrap()
            .address,
        "172.22.0.9"
    );
    fixture.fail.store(true, Ordering::SeqCst);
    fixture.streams.lock().await.clear();
    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            let value = discovery.status().await.unwrap();
            if value.status == Status::Unavailable {
                assert!(value.stale);
                assert_eq!(value.candidates.len(), 1);
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    fixture.fail.store(false, Ordering::SeqCst);
    assert!(
        !ready(&discovery).await.stale,
        "endpoint outages recover without a restart"
    );
    discovery.save(save(None, false, 1)).await.unwrap();
    let disabled = discovery.status().await.unwrap();
    assert_eq!(disabled.status, Status::Disabled);
    assert!(disabled.candidates.is_empty());
    discovery.stop().await;
    task.abort();
    // Discovery persists only its own connection, never Proxy Hosts or Caddy configuration.
    let names: Vec<_> = std::fs::read_dir(&path)
        .unwrap()
        .map(|entry| entry.unwrap().file_name())
        .collect();
    assert_eq!(names, ["docker-discovery.json"]);
    std::fs::remove_dir_all(path).unwrap();
}

#[tokio::test]
async fn disabled_and_restored_connections_make_no_requests_until_explicit_activation() {
    let path = directory();
    let discovery = Discovery::new(path.clone());
    let (endpoint, fixture, task) = fixture().await;
    *fixture.containers.lock().await = vec![container('a')];
    discovery
        .save(save(Some(endpoint.clone()), false, 0))
        .await
        .unwrap();
    discovery.start().await;
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert!(fixture.requests.lock().await.is_empty());
    discovery.stop().await;
    let restored = Discovery::new(path.clone());
    restored
        .save(save(Some(endpoint.clone()), true, 1))
        .await
        .unwrap();
    std::fs::write(
        path.join("docker-discovery-restore-paused"),
        "explicit activation required",
    )
    .unwrap();
    restored.start().await;
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert_eq!(restored.status().await.unwrap().status, Status::Paused);
    assert!(fixture.requests.lock().await.is_empty());
    assert!(matches!(
        restored.save(save(Some(endpoint.clone()), true, 2)).await,
        Err(Error::Conflict)
    ));
    let mut request = save(Some(endpoint), true, 2);
    request.acknowledge_restore = true;
    restored.save(request).await.unwrap();
    assert_eq!(ready(&restored).await.candidates.len(), 1);
    restored.stop().await;
    task.abort();
    std::fs::remove_dir_all(path).unwrap();
}

#[tokio::test]
async fn management_routes_require_a_configured_bearer_even_on_loopback() {
    use crate::{
        config::Config,
        runtime::{ProxyRuntime, RuntimeSettings},
        server::{AppState, app_with_state},
    };
    use tower::ServiceExt;
    let path = directory();
    let runtime = ProxyRuntime::new(RuntimeSettings::new(path.clone(), 8080), None);
    let no_token = app_with_state(AppState::new(runtime.clone(), None));
    let request = || {
        axum::http::Request::builder()
            .uri("/internal/v1/discovery/docker/status")
            .body(Body::empty())
            .unwrap()
    };
    assert_eq!(
        no_token.oneshot(request()).await.unwrap().status(),
        StatusCode::UNAUTHORIZED
    );
    let config = Config::from_values(
        None,
        Some(&"a".repeat(64)),
        None,
        Some(path.clone()),
        None,
        false,
    )
    .unwrap();
    let app = app_with_state(AppState::new(runtime, config.controller_token));
    assert_eq!(
        app.clone().oneshot(request()).await.unwrap().status(),
        StatusCode::UNAUTHORIZED
    );
    let response = app
        .oneshot(
            axum::http::Request::builder()
                .uri("/internal/v1/discovery/docker/status")
                .header("authorization", format!("Bearer {}", "a".repeat(64)))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()["cache-control"], "no-store");
    std::fs::remove_dir_all(path).unwrap();
}
