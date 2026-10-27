use std::{collections::BTreeMap, sync::Arc};

use axum::{
    Json, Router,
    body::Bytes,
    extract::State,
    http::{HeaderMap, Method, StatusCode, Uri},
    response::{IntoResponse, Response},
    routing::any,
};
use serde_json::{Value, json};
use tokio::{net::TcpListener, sync::Mutex, task::JoinHandle};

use super::super::super::{DnsProvider, DnsProviderConfig};

#[derive(Default)]
pub(super) struct MockState {
    pub(super) rrsets: BTreeMap<String, Value>,
    pub(super) requests: Vec<(Method, String, Value)>,
    pub(super) write_status: Option<StatusCode>,
    pub(super) ambiguous_write: bool,
    pub(super) discard_write: bool,
    pub(super) wrong_action_resource: bool,
    pub(super) action_error: bool,
    pub(super) running_action: bool,
    pub(super) empty_rrset_after_cleanup: bool,
    pub(super) foreign_add_on_remove: bool,
    pub(super) lose_foreign_on_add: bool,
    pub(super) zone_mode: Option<String>,
}

pub(super) struct Fixture {
    pub(super) provider: DnsProvider,
    pub(super) state: Arc<Mutex<MockState>>,
    pub(super) endpoint: String,
    task: JoinHandle<()>,
}

impl Drop for Fixture {
    fn drop(&mut self) {
        self.task.abort();
    }
}

pub(super) fn config() -> DnsProviderConfig {
    DnsProviderConfig::Hetzner {
        zone_id: "42".to_owned(),
        api_token: "fixture-secret".to_owned(),
    }
}

pub(super) fn record(value: &str, comment: Option<&str>) -> Value {
    json!({"value": value, "comment": comment})
}

pub(super) fn rrset(name: &str, ttl: Option<u32>, records: Vec<Value>) -> Value {
    json!({"id": format!("{name}/TXT"), "name": name, "type": "TXT", "zone": 42, "ttl": ttl, "records": records, "protection": {"change": false}})
}

fn action(state: &MockState, command: &str) -> Value {
    json!({
        "id": 123, "command": command, "status": if state.action_error {"error"} else {"success"},
        "progress": 100, "started": "2026-10-27T00:00:00Z", "finished": "2026-10-27T00:00:01Z",
        "resources": [{"id": if state.wrong_action_resource {43} else {42}, "type": "zone"}],
        "error": if state.action_error {json!({"code": "action_failed", "message": "fixture private response"})} else {Value::Null}
    })
}

async fn handler(
    State(state): State<Arc<Mutex<MockState>>>,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    assert_eq!(
        headers
            .get("authorization")
            .and_then(|value| value.to_str().ok()),
        Some("Bearer fixture-secret")
    );
    let mut state = state.lock().await;
    let body: Value = if body.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&body).unwrap()
    };
    state
        .requests
        .push((method.clone(), uri.path().to_owned(), body.clone()));
    if uri.path() == "/v1/zones/42" {
        return Json(json!({"zone": {"id": 42, "name": "example.com", "mode": state.zone_mode.as_deref().unwrap_or("primary"), "ttl": 3600}})).into_response();
    }
    if uri.path() == "/v1/actions/123" {
        return Json(json!({"action": action(&state, "change_rrset")})).into_response();
    }
    let Some(rest) = uri.path().strip_prefix("/v1/zones/42/rrsets") else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let collection = rest.is_empty();
    let (name, command) = if collection {
        (body["name"].as_str().unwrap().to_owned(), "create_rrset")
    } else if let Some(name) = rest
        .strip_prefix('/')
        .and_then(|path| path.strip_suffix("/TXT"))
    {
        (name.to_owned(), "")
    } else if let Some((name, command)) = rest
        .strip_prefix('/')
        .and_then(|path| path.split_once("/TXT/actions/"))
    {
        (name.to_owned(), command)
    } else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if method == Method::GET {
        return state.rrsets.get(&name).map_or_else(
            || StatusCode::NOT_FOUND.into_response(),
            |rrset| Json(json!({"rrset": rrset})).into_response(),
        );
    }
    assert_eq!(method, Method::POST);
    if let Some(status) = state.write_status {
        return status.into_response();
    }
    let records = body["records"].as_array().unwrap();
    let value = if collection {
        assert_eq!(body["type"], "TXT");
        assert!(
            body.get("ttl").is_some(),
            "creation must explicitly inherit zone TTL"
        );
        if state.rrsets.contains_key(&name) {
            return StatusCode::CONFLICT.into_response();
        }
        rrset(
            &name,
            body["ttl"].as_u64().map(|ttl| ttl as u32),
            records.clone(),
        )
    } else {
        assert_eq!(
            body.as_object().unwrap().len(),
            1,
            "native record mutations must leave TTL unchanged"
        );
        let Some(mut existing) = state.rrsets.get(&name).cloned() else {
            return StatusCode::NOT_FOUND.into_response();
        };
        let current = existing["records"].as_array_mut().unwrap();
        match command {
            "add_records" => {
                if state.lose_foreign_on_add {
                    current.clear();
                }
                for record in records {
                    assert!(!current.iter().any(|old| old["value"] == record["value"]));
                    current.push(record.clone());
                }
            }
            "remove_records" => {
                if state.foreign_add_on_remove {
                    current.push(record("\"racing-foreign\"", Some("other client")));
                }
                current.retain(|old| !records.iter().any(|record| record["value"] == old["value"]));
            }
            _ => panic!("unexpected destructive mutation: {command}"),
        }
        existing
    };
    if !state.discard_write && !state.action_error && !state.wrong_action_resource {
        if value["records"].as_array().unwrap().is_empty() && !state.empty_rrset_after_cleanup {
            state.rrsets.remove(&name);
        } else {
            state.rrsets.insert(name, value.clone());
        }
    }
    if state.ambiguous_write {
        state.ambiguous_write = false;
        return StatusCode::BAD_GATEWAY.into_response();
    }
    let mut receipt = action(&state, command);
    if state.running_action {
        receipt["status"] = json!("running");
        receipt["finished"] = Value::Null;
        receipt["progress"] = json!(0);
    }
    (
        if collection {
            StatusCode::CREATED
        } else {
            StatusCode::OK
        },
        Json(json!({"rrset": value, "action": receipt})),
    )
        .into_response()
}

pub(super) async fn fixture(initial: MockState) -> Fixture {
    let state = Arc::new(Mutex::new(initial));
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}/v1/", listener.local_addr().unwrap());
    let app = Router::new()
        .fallback(any(handler))
        .with_state(state.clone());
    let task = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let provider = DnsProvider::with_endpoint_for_test(config(), &endpoint).unwrap();
    Fixture {
        provider,
        state,
        endpoint,
        task,
    }
}
