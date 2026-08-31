use axum::{
    Json,
    body::Bytes,
    extract::{Path, State, rejection::BytesRejection},
    http::{HeaderValue, header::CACHE_CONTROL},
    response::{IntoResponse, Response},
};
use serde::Serialize;

use crate::{
    models::{ApplyOutcome, ProxyConfigRequest, ProxyRuntimeStatus, ValidatedProxyConfig},
    proxy::{is_canonical_uuid, validate_proxy_config},
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
    let configuration = validated_proxy_config(body)?;
    let active_revision = configuration.revision.clone();
    let status = match state.runtime.apply(configuration).await {
        Ok(ApplyOutcome::Applied) => "applied",
        Ok(ApplyOutcome::Unchanged) => "unchanged",
        Err(RuntimeError::Busy) => return Err(ApiError::busy()),
        Err(RuntimeError::Unavailable) => return Err(ApiError::runtime_unavailable()),
        Err(RuntimeError::ApplyFailed) => return Err(ApiError::apply_failed()),
        Err(RuntimeError::ConfigTooLarge) => return Err(ApiError::payload_too_large()),
        Err(RuntimeError::HostConfigNotFound) => return Err(ApiError::not_found()),
    };
    let last_apply_at = state.runtime.status().await.last_apply_at;
    Ok(Json(ApplyResponse {
        status,
        active_revision,
        last_apply_at,
    }))
}

pub(super) async fn read_proxy_config(State(state): State<AppState>) -> Result<Response, ApiError> {
    let (config, active_revision) = state.runtime.active_config().await.map_err(runtime_error)?;
    Ok(no_store_json(ProxyConfigSourceResponse {
        config,
        active_revision,
    }))
}

pub(super) async fn read_proxy_host_config(
    Path(host_id): Path<String>,
    State(state): State<AppState>,
) -> Result<Response, ApiError> {
    if !is_canonical_uuid(&host_id) {
        return Err(ApiError::not_found());
    }
    let (config, active_revision) = state
        .runtime
        .active_host_config(&host_id)
        .await
        .map_err(runtime_error)?;
    Ok(no_store_json(ProxyConfigSourceResponse {
        config,
        active_revision: Some(active_revision),
    }))
}

pub(super) async fn preview_proxy_host_config(
    Path(host_id): Path<String>,
    State(state): State<AppState>,
    body: Result<Bytes, BytesRejection>,
) -> Result<Response, ApiError> {
    if !is_canonical_uuid(&host_id) {
        return Err(ApiError::not_found());
    }
    let configuration = validated_proxy_config(body)?;
    if configuration.proxy_hosts.len() != 1 || configuration.proxy_hosts[0].id != host_id {
        return Err(ApiError::validation_failed());
    }
    let revision = configuration.revision.clone();
    let config = state
        .runtime
        .preview_host_config(&configuration, &host_id)
        .map_err(runtime_error)?;
    Ok(no_store_json(ProxyConfigPreviewResponse {
        config,
        revision,
    }))
}

pub(super) async fn preview_proxy_config(
    State(state): State<AppState>,
    body: Result<Bytes, BytesRejection>,
) -> Result<Response, ApiError> {
    let configuration = validated_proxy_config(body)?;
    let revision = configuration.revision.clone();
    let config = state
        .runtime
        .preview_config(&configuration)
        .map_err(runtime_error)?;
    Ok(no_store_json(ProxyConfigPreviewResponse {
        config,
        revision,
    }))
}

fn validated_proxy_config(
    body: Result<Bytes, BytesRejection>,
) -> Result<ValidatedProxyConfig, ApiError> {
    let body = body.map_err(|_| ApiError::payload_too_large())?;
    let request = serde_json::from_slice::<ProxyConfigRequest>(&body)
        .map_err(|_| ApiError::invalid_configuration())?;
    validate_proxy_config(request).map_err(ApiError::from_validation)
}

fn runtime_error(error: RuntimeError) -> ApiError {
    match error {
        RuntimeError::Busy => ApiError::busy(),
        RuntimeError::Unavailable => ApiError::runtime_unavailable(),
        RuntimeError::ApplyFailed => ApiError::apply_failed(),
        RuntimeError::ConfigTooLarge => ApiError::payload_too_large(),
        RuntimeError::HostConfigNotFound => ApiError::not_found(),
    }
}

fn no_store_json<T: Serialize>(payload: T) -> Response {
    let mut response = Json(payload).into_response();
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ProxyConfigSourceResponse {
    config: String,
    active_revision: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ProxyConfigPreviewResponse {
    config: String,
    revision: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ApplyResponse {
    status: &'static str,
    active_revision: String,
    last_apply_at: Option<String>,
}
