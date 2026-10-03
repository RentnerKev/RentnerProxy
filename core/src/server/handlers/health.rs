use super::no_store_status_json;
use crate::server::AppState;
use axum::{Json, http::StatusCode, response::Response};
use serde::Serialize;

#[derive(Debug, Serialize, PartialEq, Eq)]
pub(in crate::server) struct HealthResponse {
    status: &'static str,
    service: &'static str,
    version: &'static str,
}

pub(in crate::server) async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        service: env!("CARGO_PKG_NAME"),
        version: env!("CARGO_PKG_VERSION"),
    })
}

#[derive(Debug, Serialize, PartialEq, Eq)]
struct ReadinessResponse {
    status: &'static str,
}

pub(in crate::server) async fn readiness(state: AppState) -> Response {
    let ready = state.runtime.is_ready().await;
    no_store_status_json(
        if ready {
            StatusCode::OK
        } else {
            StatusCode::SERVICE_UNAVAILABLE
        },
        ReadinessResponse {
            status: if ready { "ready" } else { "not_ready" },
        },
    )
}
