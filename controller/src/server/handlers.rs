use axum::{
    Json,
    body::Bytes,
    extract::{State, rejection::BytesRejection},
};
use serde::Serialize;

use crate::{
    models::{ApplyOutcome, ProxyConfigRequest, ProxyRuntimeStatus},
    proxy::validate_proxy_config,
    runtime::RuntimeError,
};

use super::{AppState, error::ApiError};

#[derive(Debug, Serialize, PartialEq, Eq)]
pub(super) struct HealthResponse {
    status: &'static str,
    service: &'static str,
    version: &'static str,
}

pub(super) async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        service: env!("CARGO_PKG_NAME"),
        version: env!("CARGO_PKG_VERSION"),
    })
}

pub(super) async fn proxy_status(
    State(state): State<AppState>,
) -> Result<Json<ProxyRuntimeStatus>, ApiError> {
    Ok(Json(state.runtime.status().await))
}

pub(super) async fn apply_proxy_config(
    State(state): State<AppState>,
    body: Result<Bytes, BytesRejection>,
) -> Result<Json<ApplyResponse>, ApiError> {
    let body = body.map_err(|_| ApiError::payload_too_large())?;
    let request = serde_json::from_slice::<ProxyConfigRequest>(&body)
        .map_err(|_| ApiError::invalid_configuration())?;
    let configuration = validate_proxy_config(request).map_err(ApiError::from_validation)?;
    let active_revision = configuration.revision.clone();
    let status = match state.runtime.apply(configuration).await {
        Ok(ApplyOutcome::Applied) => "applied",
        Ok(ApplyOutcome::Unchanged) => "unchanged",
        Err(RuntimeError::Busy) => return Err(ApiError::busy()),
        Err(RuntimeError::Unavailable) => return Err(ApiError::runtime_unavailable()),
        Err(RuntimeError::ApplyFailed) => return Err(ApiError::apply_failed()),
    };
    let last_apply_at = state.runtime.status().await.last_apply_at;
    Ok(Json(ApplyResponse {
        status,
        active_revision,
        last_apply_at,
    }))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ApplyResponse {
    status: &'static str,
    active_revision: String,
    last_apply_at: Option<String>,
}
