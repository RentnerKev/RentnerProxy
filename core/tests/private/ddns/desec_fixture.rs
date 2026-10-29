pub(super) use super::fixture::{ACTOR, CONNECTION};
use super::{
    Engine,
    models::{RecordType, Request, Selection, Target},
};
use crate::runtime::{
    dns::capabilities::ProviderId,
    dns_connections::{SaveRequest, Store},
    state::prepare_state_dir,
};
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    routing::get,
};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
};
pub(super) struct Data {
    pub rrsets: Vec<Value>,
    pub writes: Vec<Value>,
    pub methods: Vec<String>,
    pub ip: String,
    pub minimum_ttl: u32,
    pub status: StatusCode,
    pub write_status: StatusCode,
    pub bad_ack: bool,
    pub next_page: bool,
    pub pause_ack: bool,
    pub replace_before_create: bool,
    pub entered: Arc<tokio::sync::Notify>,
    pub release: Arc<tokio::sync::Notify>,
}
pub(super) struct Fixture {
    pub store: Store,
    pub engine: Engine,
    pub data: Arc<Mutex<Data>>,
    pub path: PathBuf,
    task: tokio::task::JoinHandle<()>,
}
pub(super) fn rrset(kind: &str, records: &[&str]) -> Value {
    json!({"domain":"example.com","subname":"","name":"example.com.","type":kind,
        "ttl":3600,"created":"2026-01-01T00:00:00Z","records":records})
}
pub(super) fn target(selection: Selection) -> Target {
    Target {
        zone_id: "example.com".into(),
        name: "example.com".into(),
        proxied: false,
        ..super::fixture::target(10, "example.com", RecordType::Aaaa, selection)
    }
}
pub(super) fn request(selection: Selection) -> Request {
    Request {
        actor_user_id: ACTOR.into(),
        ipv4: false,
        ipv6: true,
        targets: vec![target(selection)],
    }
}
fn auth(headers: &HeaderMap) {
    assert_eq!(headers["authorization"], "Token private-desec-fixture");
}
impl Fixture {
    pub async fn new(rrsets: Vec<Value>) -> Self {
        let data = Arc::new(Mutex::new(Data {
            rrsets,
            writes: vec![],
            methods: vec![],
            ip: "2001:4860:4860::8844".into(),
            minimum_ttl: 900,
            status: StatusCode::OK,
            write_status: StatusCode::OK,
            bad_ack: false,
            next_page: false,
            pause_ack: false,
            replace_before_create: false,
            entered: Arc::new(tokio::sync::Notify::new()),
            release: Arc::new(tokio::sync::Notify::new()),
        }));
        let router = Router::new()
            .route("/domains/", get(|headers: HeaderMap| async move { auth(&headers); Json(json!([{"name":"example.com","minimum_ttl":900}])) }))
            .route("/domains/example.com/", get(|State(data): State<Arc<Mutex<Data>>>, headers:HeaderMap| async move {
                auth(&headers); Json(json!({"name":"example.com","minimum_ttl":data.lock().unwrap().minimum_ttl}))
            }))
            .route("/domains/example.com/rrsets/", get(list).post(create))
            .route("/domains/example.com/rrsets/{subname}/{kind}/", axum::routing::patch(update))
            .route("/v6", get(|State(data):State<Arc<Mutex<Data>>>, headers:HeaderMap| async move {
                assert!(headers.get("authorization").is_none()); format!("ip={}\n", data.lock().unwrap().ip)
            })).with_state(data.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let task = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
        static N: AtomicUsize = AtomicUsize::new(0);
        let path = std::env::temp_dir().join(format!(
            "rentnerproxy-desec-ddns-{}-{}-{}",
            std::process::id(),
            N.fetch_add(1, Ordering::SeqCst),
            time::OffsetDateTime::now_utc().unix_timestamp_nanos()
        ));
        prepare_state_dir(&path).unwrap();
        let store = Store::fixture(path.clone(), format!("http://{address}/"));
        store
            .save(
                CONNECTION.into(),
                SaveRequest {
                    provider: Some(ProviderId::Desec),
                    expected_revision: 0,
                    name: "deSEC fixture".into(),
                    api_token: Some("private-desec-fixture".into()),
                    zone_ids: vec!["example.com".into()],
                    actor_user_id: ACTOR.into(),
                },
            )
            .await
            .unwrap();
        let engine = Engine {
            discovery_urls: Some([
                format!("http://{address}/unused"),
                format!("http://{address}/v6"),
            ]),
            ..Engine::new()
        };
        Self {
            store,
            engine,
            data,
            path,
            task,
        }
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.task.abort();
        assert_eq!(self.path.parent(), Some(std::env::temp_dir().as_path()));
        assert!(
            self.path
                .file_name()
                .unwrap()
                .to_str()
                .unwrap()
                .starts_with("rentnerproxy-desec-ddns-")
        );
        let _ = std::fs::remove_dir_all(&self.path);
    }
}
async fn list(
    State(data): State<Arc<Mutex<Data>>>,
    Query(query): Query<HashMap<String, String>>,
    headers: HeaderMap,
) -> (StatusCode, HeaderMap, Json<Value>) {
    auth(&headers);
    assert_eq!(query.get("subname").map(String::as_str), Some(""));
    assert_eq!(query.get("cursor").map(String::as_str), Some(""));
    let data = data.lock().unwrap();
    let mut headers = HeaderMap::new();
    headers.insert("retry-after", "17".parse().unwrap());
    if data.next_page {
        headers.insert(
            "link",
            "<https://evil.invalid/>; rel=\"next\"".parse().unwrap(),
        );
    }
    (data.status, headers, Json(json!(data.rrsets)))
}
async fn create(
    State(data): State<Arc<Mutex<Data>>>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> (StatusCode, HeaderMap, Json<Value>) {
    auth(&headers);
    let result = mutate(data.clone(), body, None);
    pause_ack(&data).await;
    result
}
async fn update(
    State(data): State<Arc<Mutex<Data>>>,
    Path((subname, kind)): Path<(String, String)>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> (StatusCode, HeaderMap, Json<Value>) {
    auth(&headers);
    assert_eq!(subname, "@");
    let result = mutate(data.clone(), body, Some(kind));
    pause_ack(&data).await;
    result
}
fn mutate(
    data: Arc<Mutex<Data>>,
    body: Value,
    kind: Option<String>,
) -> (StatusCode, HeaderMap, Json<Value>) {
    let mut data = data.lock().unwrap();
    data.writes.push(body.clone());
    data.methods
        .push(if kind.is_some() { "PATCH" } else { "POST" }.into());
    let mut headers = HeaderMap::new();
    headers.insert("retry-after", "23".parse().unwrap());
    if !data.write_status.is_success() {
        return (data.write_status, headers, Json(json!({})));
    }
    if kind.is_none() {
        if data.replace_before_create {
            let mut replacement = rrset(body["type"].as_str().unwrap(), &["2001:4860:4860::9999"]);
            replacement["created"] = json!("2026-02-01T00:00:00Z");
            data.rrsets.push(replacement);
            data.replace_before_create = false;
        }
        if data
            .rrsets
            .iter()
            .any(|rrset| rrset["type"] == body["type"])
        {
            return (StatusCode::BAD_REQUEST, headers, Json(json!({})));
        }
    }
    let mut result = if let Some(kind) = kind {
        data.rrsets
            .iter()
            .find(|rrset| rrset["type"] == kind)
            .unwrap()
            .clone()
    } else {
        let mut value = rrset(body["type"].as_str().unwrap(), &[]);
        value["ttl"] = body["ttl"].clone();
        value
    };
    result["records"] = body["records"].clone();
    data.rrsets.retain(|rrset| rrset["type"] != result["type"]);
    data.rrsets.push(result.clone());
    if data.bad_ack {
        result["domain"] = json!("evil.example");
    }
    (StatusCode::OK, headers, Json(result))
}

async fn pause_ack(data: &Arc<Mutex<Data>>) {
    let wait = {
        let data = data.lock().unwrap();
        data.pause_ack
            .then(|| (data.entered.clone(), data.release.clone()))
    };
    if let Some((entered, release)) = wait {
        entered.notify_one();
        release.notified().await;
    }
}
