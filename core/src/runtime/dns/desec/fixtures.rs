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
    pub(super) read_status: Option<StatusCode>,
    pub(super) zone_status: Option<StatusCode>,
    pub(super) write_status: Option<StatusCode>,
    pub(super) ambiguous_write: bool,
    pub(super) discard_write: bool,
    pub(super) malformed_read: bool,
    pub(super) oversized_read: bool,
    pub(super) wrong_zone: bool,
    pub(super) wrong_rrset: bool,
    pub(super) minimum_ttl: Option<u32>,
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
    DnsProviderConfig::Desec {
        zone_id: "example.com".to_owned(),
        api_token: "fixture-secret".to_owned(),
    }
}

pub(super) fn rrset(subname: &str, ttl: u32, records: &[&str]) -> Value {
    json!({ "domain": "example.com", "name": if subname.is_empty() { "example.com.".to_owned() } else { format!("{subname}.example.com.") }, "subname": subname, "type": "TXT", "ttl": ttl, "records": records })
}

async fn handler(
    State(state): State<Arc<Mutex<MockState>>>,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if headers
        .get("authorization")
        .and_then(|header| header.to_str().ok())
        != Some("Token fixture-secret")
    {
        return (StatusCode::UNAUTHORIZED, "fixture authorization rejected").into_response();
    }
    let mut state = state.lock().await;
    let body: Value = if body.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&body).unwrap()
    };
    state
        .requests
        .push((method.clone(), uri.path().to_owned(), body.clone()));
    if uri.path() == "/api/v1/domains/example.com/" {
        if let Some(status) = state.zone_status {
            return status.into_response();
        }
        return Json(json!({"name": if state.wrong_zone {"other.com"} else {"example.com"}, "minimum_ttl": state.minimum_ttl.unwrap_or(3600)})).into_response();
    }
    let Some(rest) = uri
        .path()
        .strip_prefix("/api/v1/domains/example.com/rrsets/")
    else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let collection = rest.is_empty();
    let subname = if collection {
        body["subname"].as_str().unwrap().to_owned()
    } else {
        let Some(subname) = rest.strip_suffix("/TXT/") else {
            return StatusCode::BAD_REQUEST.into_response();
        };
        if subname == "@" {
            String::new()
        } else {
            subname.to_owned()
        }
    };
    if method == Method::GET {
        if let Some(status) = state.read_status {
            return status.into_response();
        }
        if state.malformed_read {
            return (StatusCode::OK, "{bad-json").into_response();
        }
        if state.oversized_read {
            return (StatusCode::OK, "x".repeat(65537)).into_response();
        }
        return if let Some(rrset) = state.rrsets.get(&subname) {
            let mut rrset = rrset.clone();
            if state.wrong_rrset {
                rrset["domain"] = json!("other.com");
            }
            Json(rrset).into_response()
        } else {
            StatusCode::NOT_FOUND.into_response()
        };
    }
    if let Some(status) = state.write_status {
        return status.into_response();
    }
    assert!((collection && method == Method::POST) || (!collection && method == Method::PATCH));
    let value = if collection {
        if state.rrsets.contains_key(&subname) {
            return StatusCode::BAD_REQUEST.into_response();
        }
        let mut value = body;
        value["domain"] = json!("example.com");
        value["name"] = json!(if subname.is_empty() {
            "example.com.".to_owned()
        } else {
            format!("{subname}.example.com.")
        });
        value
    } else {
        assert_eq!(body.as_object().unwrap().len(), 1);
        let Some(mut value) = state.rrsets.get(&subname).cloned() else {
            return StatusCode::NOT_FOUND.into_response();
        };
        value["records"] = body["records"].clone();
        value
    };
    let deleted = value["records"].as_array().unwrap().is_empty();
    if !state.discard_write {
        if deleted {
            state.rrsets.remove(&subname);
        } else {
            state.rrsets.insert(subname, value.clone());
        }
    }
    if state.ambiguous_write {
        state.ambiguous_write = false;
        return StatusCode::BAD_GATEWAY.into_response();
    }
    if deleted {
        StatusCode::NO_CONTENT.into_response()
    } else {
        (
            if collection {
                StatusCode::CREATED
            } else {
                StatusCode::OK
            },
            Json(value),
        )
            .into_response()
    }
}

pub(super) async fn fixture(initial: MockState) -> Fixture {
    let state = Arc::new(Mutex::new(initial));
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
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
