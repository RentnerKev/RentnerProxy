use super::no_store_json;
use crate::{
    models::{ApplyOutcome, ProxyConfigRequest, ProxyRuntimeStatus, ValidatedProxyConfig},
    proxy::{is_canonical_uuid, validate_proxy_config},
    runtime::RuntimeError,
    server::{AppState, error::ApiError},
};
use axum::{
    Json,
    body::Bytes,
    extract::{Path, rejection::BytesRejection},
    response::Response,
};
use serde::Serialize;
use serde_json::Value;

pub(in crate::server) async fn proxy_status(
    state: AppState,
) -> Result<Json<ProxyRuntimeStatus>, ApiError> {
    Ok(Json(state.runtime.status().await))
}

pub(in crate::server) async fn proxy_version(state: AppState) -> Response {
    no_store_json(ProxyVersionResponse {
        version: state.runtime.version().await,
    })
}

#[derive(Serialize)]
struct ProxyVersionResponse {
    version: Option<String>,
}

pub(in crate::server) async fn apply_proxy_config(
    state: AppState,
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

pub(in crate::server) async fn read_proxy_config(state: AppState) -> Result<Response, ApiError> {
    let (config, active_revision) = state.runtime.active_config().await.map_err(runtime_error)?;
    Ok(no_store_json(ProxyConfigSourceResponse {
        config: redacted_config_source(&config)?,
        active_revision,
    }))
}

pub(in crate::server) async fn read_proxy_host_config(
    Path(host_id): Path<String>,
    state: AppState,
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
        config: redacted_config_source(&config)?,
        active_revision: Some(active_revision),
    }))
}

pub(in crate::server) async fn preview_proxy_host_config(
    Path(host_id): Path<String>,
    state: AppState,
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
        config: redacted_config_source(&config)?,
        revision,
    }))
}

pub(in crate::server) async fn preview_proxy_config(
    state: AppState,
    body: Result<Bytes, BytesRejection>,
) -> Result<Response, ApiError> {
    let configuration = validated_proxy_config(body)?;
    let revision = configuration.revision.clone();
    let config = state
        .runtime
        .preview_config(&configuration)
        .await
        .map_err(runtime_error)?;
    Ok(no_store_json(ProxyConfigPreviewResponse {
        config: redacted_config_source(&config)?,
        revision,
    }))
}

fn redacted_config_source(config: &str) -> Result<String, ApiError> {
    let mut value = serde_json::from_str::<Value>(config).map_err(|_| ApiError::apply_failed())?;
    redact_auth_passwords(&mut value).map_err(|_| ApiError::apply_failed())?;
    serde_json::to_string(&value).map_err(|_| ApiError::apply_failed())
}

fn redact_auth_passwords(value: &mut Value) -> Result<(), ()> {
    match value {
        Value::Array(values) => {
            for value in values {
                redact_auth_passwords(value)?;
            }
        }
        Value::Object(object) => {
            if object.get("handler").and_then(Value::as_str) == Some("authentication") {
                let providers = object
                    .get_mut("providers")
                    .and_then(Value::as_object_mut)
                    .ok_or(())?;
                let basic = providers
                    .get_mut("http_basic")
                    .and_then(Value::as_object_mut)
                    .ok_or(())?;
                let accounts = basic
                    .get_mut("accounts")
                    .and_then(Value::as_array_mut)
                    .ok_or(())?;
                for account in accounts {
                    let account = account.as_object_mut().ok_or(())?;
                    let password = account.get_mut("password").ok_or(())?;
                    if !password.is_string() {
                        return Err(());
                    }
                    *password = Value::String("[redacted]".to_owned());
                }
            }
            for value in object.values_mut() {
                redact_auth_passwords(value)?;
            }
        }
        Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_) => {}
    }
    Ok(())
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::server) struct ProxyConfigSourceResponse {
    config: String,
    active_revision: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::server) struct ProxyConfigPreviewResponse {
    config: String,
    revision: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::server) struct ApplyResponse {
    status: &'static str,
    active_revision: String,
    last_apply_at: Option<String>,
}
