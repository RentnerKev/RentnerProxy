use super::super::{
    Engine,
    models::{RecordType, Request, Selection, Target},
};
use crate::runtime::{
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
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
};
use tokio::sync::Notify;

pub(super) const CONNECTION: &str = "0198d98a-0000-7000-8000-000000000001";
pub(super) const ACTOR: &str = "0198d98a-0000-7000-8000-000000000002";
pub(super) const SECRET: &str = "private-ddns-fixture-token";
pub(super) fn provider_id(c: char) -> String {
    c.to_string().repeat(32)
}
pub(super) fn target(n: usize, name: &str, family: RecordType, selection: Selection) -> Target {
    Target {
        id: format!("0198d98a-0000-7000-8000-{n:012x}"),
        connection_id: CONNECTION.into(),
        zone_id: provider_id('a'),
        name: name.into(),
        record_type: family,
        proxied: true,
        selection,
    }
}
pub(super) fn request(targets: Vec<Target>) -> Request {
    Request {
        actor_user_id: ACTOR.into(),
        ipv4: true,
        ipv6: false,
        targets,
    }
}
pub(super) fn record(id: char, zone: char, name: &str, kind: &str, content: &str) -> Value {
    json!({"id":provider_id(id),"zone_id":provider_id(zone),"name":name,"type":kind,"content":content,"proxied":false,"ttl":3600,"comment":"keep this comment","tags":["owner:fixture"]})
}
pub(super) struct Data {
    pub(super) records: Vec<Value>,
    pub(super) v4: String,
    pub(super) v6: String,
    pub(super) status: StatusCode,
    pub(super) bad_ack: bool,
    pub(super) change_on_second_read: bool,
    pub(super) malformed_page: bool,
    pub(super) redirect: bool,
    pub(super) oversized: bool,
}
pub(super) struct Mock {
    pub(super) data: Mutex<Data>,
    pub(super) writes: AtomicUsize,
    pub(super) reads: AtomicUsize,
    pub(super) ipv4_calls: AtomicUsize,
    pub(super) ipv6_calls: AtomicUsize,
    pub(super) pause: AtomicBool,
    pub(super) entered: Notify,
    pub(super) release: Notify,
    pub(super) leaked: AtomicUsize,
}
pub(super) struct Fixture {
    pub(super) store: Store,
    pub(super) engine: Engine,
    pub(super) mock: Arc<Mock>,
    pub(super) path: PathBuf,
    task: tokio::task::JoinHandle<()>,
}
impl Fixture {
    pub(super) async fn new(records: Vec<Value>) -> Self {
        let mock = Arc::new(Mock {
            data: Mutex::new(Data {
                records,
                v4: "ip=8.8.4.4\n".into(),
                v6: "ip=2001:4860:4860::8844\n".into(),
                status: StatusCode::OK,
                bad_ack: false,
                change_on_second_read: false,
                malformed_page: false,
                redirect: false,
                oversized: false,
            }),
            writes: AtomicUsize::new(0),
            reads: AtomicUsize::new(0),
            ipv4_calls: AtomicUsize::new(0),
            ipv6_calls: AtomicUsize::new(0),
            pause: AtomicBool::new(false),
            entered: Notify::new(),
            release: Notify::new(),
            leaked: AtomicUsize::new(0),
        });
        let router = Router::new()
            .route("/v4", get(|State(mock): State<Arc<Mock>>, headers: HeaderMap| async move {
                assert!(headers.get("authorization").is_none());
                mock.ipv4_calls.fetch_add(1, Ordering::SeqCst);
                mock.data.lock().unwrap().v4.clone()
            }))
            .route("/v6", get(|State(mock): State<Arc<Mock>>, headers: HeaderMap| async move {
                assert!(headers.get("authorization").is_none());
                mock.ipv6_calls.fetch_add(1, Ordering::SeqCst);
                mock.data.lock().unwrap().v6.clone()
            }))
            .route("/leak", get(|State(mock): State<Arc<Mock>>| async move {
                mock.leaked.fetch_add(1, Ordering::SeqCst);
                "must not be called"
            }))
            .route("/zones", get(|| async { Json(json!({"success":true,"result":[{"id":provider_id('a'),"name":"example.com"},{"id":provider_id('b'),"name":"example.org"}],"result_info":{"page":1,"per_page":20,"total_pages":1}})) }))
            .route("/zones/{zone}/dns_records", get(list).post(create))
            .route("/zones/{zone}/dns_records/{id}", axum::routing::patch(update))
            .with_state(mock.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let task = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
        static N: AtomicUsize = AtomicUsize::new(0);
        let path = std::env::temp_dir().join(format!(
            "rentnerproxy-ddns-{}-{}-{}",
            std::process::id(),
            N.fetch_add(1, Ordering::SeqCst),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        prepare_state_dir(&path).unwrap();
        let store = Store::fixture(path.clone(), format!("http://{address}/"));
        store
            .save(
                CONNECTION.into(),
                SaveRequest {
                    expected_revision: 0,
                    name: "Fixture Cloudflare".into(),
                    api_token: Some(SECRET.into()),
                    zone_ids: vec![provider_id('a'), provider_id('b')],
                    actor_user_id: ACTOR.into(),
                },
            )
            .await
            .unwrap();
        let engine = Engine {
            discovery_urls: Some([
                format!("http://{address}/v4"),
                format!("http://{address}/v6"),
            ]),
            ..Engine::new()
        };
        Self {
            store,
            engine,
            mock,
            path,
            task,
        }
    }
    pub(super) fn writes(&self) -> usize {
        self.mock.writes.load(Ordering::SeqCst)
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.task.abort();
        assert!(self.path.parent() == Some(std::env::temp_dir().as_path()));
        assert!(
            self.path
                .file_name()
                .unwrap()
                .to_str()
                .unwrap()
                .starts_with("rentnerproxy-ddns-")
        );
        let _ = std::fs::remove_dir_all(&self.path);
    }
}
fn authenticated(headers: &HeaderMap) {
    assert_eq!(headers["authorization"], format!("Bearer {SECRET}"));
}
async fn list(
    State(mock): State<Arc<Mock>>,
    Path(zone): Path<String>,
    Query(query): Query<HashMap<String, String>>,
    headers: HeaderMap,
) -> (StatusCode, HeaderMap, Json<Value>) {
    authenticated(&headers);
    if mock.pause.load(Ordering::SeqCst) {
        mock.entered.notify_one();
        mock.release.notified().await;
    }
    let read = mock.reads.fetch_add(1, Ordering::SeqCst) + 1;
    let mut data = mock.data.lock().unwrap();
    let mut response_headers = HeaderMap::new();
    response_headers.insert("retry-after", "17".parse().unwrap());
    if data.redirect {
        response_headers.insert("location", "/leak".parse().unwrap());
        return (StatusCode::FOUND, response_headers, Json(json!({})));
    }
    if data.status != StatusCode::OK {
        return (
            data.status,
            response_headers,
            Json(json!({"success":false,"errors":[{"message":SECRET}]})),
        );
    }
    if data.oversized {
        return (
            StatusCode::OK,
            response_headers,
            Json(
                json!({"success":true,"padding":"a".repeat(128*1024+1),"result":[],"result_info":{"page":1,"per_page":100,"total_pages":1}}),
            ),
        );
    }
    if read == 2 && data.change_on_second_read {
        data.records[0]["content"] = json!("9.9.9.9");
    }
    assert_eq!(query.get("per_page").unwrap(), "100");
    assert_eq!(query.get("page").unwrap(), "1");
    let name = query.get("name").unwrap();
    let records: Vec<_> = data
        .records
        .iter()
        .filter(|record| record["zone_id"] == zone && record["name"] == *name)
        .cloned()
        .collect();
    (
        StatusCode::OK,
        response_headers,
        Json(
            json!({"success":true,"result":records,"result_info":{"page":1,"per_page":100,"total_pages":if data.malformed_page {2} else {1}}}),
        ),
    )
}
async fn create(
    State(mock): State<Arc<Mock>>,
    Path(zone): Path<String>,
    headers: HeaderMap,
    Json(mut value): Json<Value>,
) -> (StatusCode, Json<Value>) {
    authenticated(&headers);
    let sequence = mock.writes.fetch_add(1, Ordering::SeqCst) + 1;
    assert!(matches!(value["type"].as_str(), Some("A" | "AAAA")));
    assert!(
        value["comment"]
            .as_str()
            .unwrap()
            .starts_with("rentnerproxy-ddns:")
    );
    let mut data = mock.data.lock().unwrap();
    value["zone_id"] = json!(zone);
    value["id"] = json!(format!("f{sequence:031x}"));
    data.records.push(value.clone());
    (
        StatusCode::OK,
        Json(
            json!({"success":true,"result":if data.bad_ack {json!({"private":SECRET})} else {value}}),
        ),
    )
}
async fn update(
    State(mock): State<Arc<Mock>>,
    Path((zone, id)): Path<(String, String)>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> (StatusCode, Json<Value>) {
    authenticated(&headers);
    mock.writes.fetch_add(1, Ordering::SeqCst);
    let keys: std::collections::BTreeSet<_> = body
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    assert_eq!(keys, ["content", "proxied"].into_iter().collect());
    let mut data = mock.data.lock().unwrap();
    let record = data
        .records
        .iter_mut()
        .find(|record| record["zone_id"] == zone && record["id"] == id)
        .unwrap();
    record["content"] = body["content"].clone();
    record["proxied"] = body["proxied"].clone();
    let value = record.clone();
    (
        StatusCode::OK,
        Json(
            json!({"success":true,"result":if data.bad_ack {json!({"private":SECRET})} else {value}}),
        ),
    )
}
