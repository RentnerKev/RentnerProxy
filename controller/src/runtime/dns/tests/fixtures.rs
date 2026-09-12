use std::{net::SocketAddr, sync::Arc};

use axum::{
    Json, Router,
    extract::{Path, State},
    http::{StatusCode, Uri},
    routing::{delete as delete_route, get},
};
use serde::Deserialize;
use serde_json::json;
use tokio::{
    net::TcpListener,
    sync::{Mutex, oneshot},
    task::JoinHandle,
};

use super::super::{DnsProvider, DnsProviderConfig};

pub(super) const ZONE_ID: &str = "0123456789abcdef0123456789abcdef";

#[derive(Clone, Debug)]
pub(super) struct MockRecord {
    pub(super) id: String,
    pub(super) name: String,
    pub(super) content: String,
    pub(super) comment: String,
}

#[derive(Debug)]
pub(super) struct MockState {
    pub(super) records: Vec<MockRecord>,
    pub(super) next_id: u32,
    pub(super) post_count: u32,
    pub(super) zone_status: Option<StatusCode>,
    pub(super) list_status: Option<StatusCode>,
    pub(super) post_status: Option<StatusCode>,
    pub(super) ambiguous_post: bool,
    pub(super) delete_failures: u32,
}

impl Default for MockState {
    fn default() -> Self {
        Self {
            records: Vec::new(),
            next_id: 1,
            post_count: 0,
            zone_status: None,
            list_status: None,
            post_status: None,
            ambiguous_post: false,
            delete_failures: 0,
        }
    }
}

#[derive(Deserialize)]
struct MockCreateRecord {
    name: String,
    content: String,
    comment: String,
}

fn mock_record_json(record: &MockRecord) -> serde_json::Value {
    json!({
        "id": record.id,
        "name": record.name,
        "type": "TXT",
        "content": record.content,
        "comment": record.comment,
    })
}

fn mock_error(status: StatusCode) -> (StatusCode, Json<serde_json::Value>) {
    (
        status,
        Json(json!({
            "success": false,
            "errors": [{"code": 10000}],
        })),
    )
}

async fn mock_zone(
    State(state): State<Arc<Mutex<MockState>>>,
    Path(_zone_id): Path<String>,
) -> (StatusCode, Json<serde_json::Value>) {
    let state = state.lock().await;
    if let Some(status) = state.zone_status {
        return mock_error(status);
    }
    (
        StatusCode::OK,
        Json(json!({
            "success": true,
            "result": {"id": ZONE_ID, "name": "example.com"},
        })),
    )
}

async fn mock_list(
    State(state): State<Arc<Mutex<MockState>>>,
    Path(_zone_id): Path<String>,
    uri: Uri,
) -> (StatusCode, Json<serde_json::Value>) {
    let state = state.lock().await;
    if let Some(status) = state.list_status {
        return mock_error(status);
    }
    let query = uri.query().unwrap_or_default();
    let query_value = |key: &str| {
        query.split('&').find_map(|pair| {
            let (candidate, value) = pair.split_once('=')?;
            (candidate == key).then(|| value.to_owned())
        })
    };
    let name = query_value("name");
    let page = query_value("page")
        .and_then(|value| value.parse::<u32>().ok())
        .unwrap_or(1)
        .max(1);
    let per_page = query_value("per_page")
        .and_then(|value| value.parse::<u32>().ok())
        .unwrap_or(100)
        .clamp(1, 100);
    let filtered = state
        .records
        .iter()
        .filter(|record| name.as_deref().is_none_or(|name| record.name == name))
        .cloned()
        .collect::<Vec<_>>();
    let total_pages = filtered.len().div_ceil(per_page as usize).max(1);
    let start = (page.saturating_sub(1) as usize).saturating_mul(per_page as usize);
    let result = filtered
        .iter()
        .skip(start)
        .take(per_page as usize)
        .map(mock_record_json)
        .collect::<Vec<_>>();
    (
        StatusCode::OK,
        Json(json!({
            "success": true,
            "result": result,
            "result_info": {
                "page": page,
                "per_page": per_page,
                "total_pages": total_pages,
            },
        })),
    )
}

async fn mock_post(
    State(state): State<Arc<Mutex<MockState>>>,
    Path(_zone_id): Path<String>,
    Json(body): Json<MockCreateRecord>,
) -> (StatusCode, Json<serde_json::Value>) {
    let mut state = state.lock().await;
    if let Some(status) = state.post_status {
        return mock_error(status);
    }
    state.post_count += 1;
    let record = MockRecord {
        id: format!("record-{}", state.next_id),
        name: body.name,
        content: body.content,
        comment: body.comment,
    };
    state.next_id += 1;
    state.records.push(record.clone());
    if state.ambiguous_post {
        state.ambiguous_post = false;
        return mock_error(StatusCode::BAD_GATEWAY);
    }
    (
        StatusCode::OK,
        Json(json!({"success": true, "result": mock_record_json(&record)})),
    )
}

async fn mock_delete(
    State(state): State<Arc<Mutex<MockState>>>,
    Path((_zone_id, record_id)): Path<(String, String)>,
) -> (StatusCode, Json<serde_json::Value>) {
    let mut state = state.lock().await;
    if state.delete_failures > 0 {
        state.delete_failures -= 1;
        return mock_error(StatusCode::SERVICE_UNAVAILABLE);
    }
    let Some(index) = state
        .records
        .iter()
        .position(|record| record.id == record_id)
    else {
        return mock_error(StatusCode::NOT_FOUND);
    };
    state.records.remove(index);
    (
        StatusCode::OK,
        Json(json!({"success": true, "result": {"id": record_id}})),
    )
}

pub(super) async fn fixture(
    state: Arc<Mutex<MockState>>,
) -> (
    DnsProvider,
    Arc<Mutex<MockState>>,
    oneshot::Sender<()>,
    JoinHandle<()>,
) {
    let app = Router::new()
        .route("/client/v4/zones/{zone_id}", get(mock_zone))
        .route(
            "/client/v4/zones/{zone_id}/dns_records",
            get(mock_list).post(mock_post),
        )
        .route(
            "/client/v4/zones/{zone_id}/dns_records/{record_id}",
            delete_route(mock_delete),
        )
        .with_state(state.clone());
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address: SocketAddr = listener.local_addr().unwrap();
    let (shutdown, receiver) = oneshot::channel();
    let task = tokio::spawn(async move {
        axum::serve(listener, app)
            .with_graceful_shutdown(async {
                let _ = receiver.await;
            })
            .await
            .unwrap();
    });
    let provider =
        DnsProvider::with_endpoint_for_test(super::config(), &format!("http://{address}")).unwrap();
    (provider, state, shutdown, task)
}

pub(super) fn config() -> DnsProviderConfig {
    DnsProviderConfig::cloudflare(
        "0123456789abcdef0123456789abcdef",
        "token-without-whitespace",
    )
    .unwrap()
}
