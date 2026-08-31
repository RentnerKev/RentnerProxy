use axum::{
    Json,
    body::Bytes,
    extract::{Path, rejection::BytesRejection},
    http::{
        HeaderMap, HeaderValue, StatusCode,
        header::{CACHE_CONTROL, CONTENT_TYPE, HOST},
    },
    response::{IntoResponse, Response},
};
use serde::Serialize;

use crate::{
    models::{ApplyOutcome, ProxyConfigRequest, ProxyRuntimeStatus, ValidatedProxyConfig},
    proxy::{
        TrustedCaValidationRequest, is_canonical_domain, is_canonical_uuid, is_canonical_uuid_v7,
        validate_proxy_config, validate_trusted_ca_pem,
    },
    runtime::{
        CertificateError, CertificateImportRequest, CertificateIssueRequest, CertificateMetadata,
        RuntimeError,
    },
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

pub(super) async fn challenge_response(
    Path(token): Path<String>,
    state: AppState,
    headers: HeaderMap,
) -> Response {
    let Some(domain) = challenge_domain(&headers) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if !is_challenge_token(&token) {
        return StatusCode::NOT_FOUND.into_response();
    }
    let Some(value) = state.challenges.get(&domain, &token).await else {
        return StatusCode::NOT_FOUND.into_response();
    };
    (
        StatusCode::OK,
        [
            (
                CONTENT_TYPE,
                HeaderValue::from_static("text/plain; charset=utf-8"),
            ),
            (CACHE_CONTROL, HeaderValue::from_static("no-store")),
        ],
        value,
    )
        .into_response()
}

fn challenge_domain(headers: &HeaderMap) -> Option<String> {
    let host = headers.get(HOST)?.to_str().ok()?.to_ascii_lowercase();
    let domain = host
        .split_once(':')
        .map_or(host.as_str(), |(domain, _)| domain);
    is_canonical_domain(domain).then(|| domain.to_owned())
}

fn is_challenge_token(value: &str) -> bool {
    (1..=128).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

pub(super) async fn proxy_status(state: AppState) -> Result<Json<ProxyRuntimeStatus>, ApiError> {
    Ok(Json(state.runtime.status().await))
}

pub(super) async fn list_certificates(state: AppState) -> Result<Response, ApiError> {
    Ok(no_store_json(CertificateListResponse {
        certificates: state
            .runtime
            .certificates()
            .await
            .map_err(certificate_error)?,
    }))
}

pub(super) async fn get_certificate(
    Path(id): Path<String>,
    state: AppState,
) -> Result<Response, ApiError> {
    certificate_id(&id)?;
    Ok(no_store_json(
        state
            .runtime
            .certificate(&id)
            .await
            .map_err(certificate_error)?,
    ))
}

pub(super) async fn validate_trusted_ca(
    body: Result<Bytes, BytesRejection>,
) -> Result<Response, ApiError> {
    let body = body.map_err(|_| ApiError::invalid_trusted_ca())?;
    let request = serde_json::from_slice::<TrustedCaValidationRequest>(&body)
        .map_err(|_| ApiError::invalid_trusted_ca())?;
    Ok(no_store_json(
        validate_trusted_ca_pem(&request.pem).map_err(|_| ApiError::invalid_trusted_ca())?,
    ))
}
pub(super) async fn import_certificate(
    Path(id): Path<String>,
    state: AppState,
    body: Result<Bytes, BytesRejection>,
) -> Result<Response, ApiError> {
    certificate_id(&id)?;
    let body = body.map_err(|_| ApiError::certificate(CertificateError::InvalidCertificate))?;
    let request = serde_json::from_slice::<CertificateImportRequest>(&body)
        .map_err(|_| ApiError::certificate(CertificateError::InvalidCertificate))?;
    Ok(no_store_json(
        state
            .runtime
            .import_certificate(&id, request)
            .await
            .map_err(certificate_error)?,
    ))
}

pub(super) async fn issue_certificate(
    Path(id): Path<String>,
    state: AppState,
    body: Result<Bytes, BytesRejection>,
) -> Result<Response, ApiError> {
    certificate_id(&id)?;
    let body = body.map_err(|_| ApiError::certificate(CertificateError::AcmeDomainInvalid))?;
    let request = serde_json::from_slice::<CertificateIssueRequest>(&body)
        .map_err(|_| ApiError::certificate(CertificateError::AcmeDomainInvalid))?;
    let metadata = state
        .runtime
        .start_acme_issue(id, request, state.challenges.clone())
        .await
        .map_err(certificate_error)?;
    Ok(no_store_status_json(StatusCode::ACCEPTED, metadata))
}

pub(super) async fn renew_certificate(
    Path(id): Path<String>,
    state: AppState,
    body: Result<Bytes, BytesRejection>,
) -> Result<Response, ApiError> {
    certificate_id(&id)?;
    let body = body.map_err(|_| ApiError::certificate(CertificateError::AcmeFailed))?;
    if !body.is_empty() && serde_json::from_slice::<serde_json::Value>(&body).is_err() {
        return Err(ApiError::certificate(CertificateError::AcmeFailed));
    }
    let metadata = state
        .runtime
        .start_acme_renewal(id, state.challenges.clone())
        .await
        .map_err(certificate_error)?;
    Ok(no_store_status_json(StatusCode::ACCEPTED, metadata))
}

pub(super) async fn delete_certificate(
    Path(id): Path<String>,
    state: AppState,
) -> Result<Response, ApiError> {
    certificate_id(&id)?;
    state
        .runtime
        .delete_certificate(&id)
        .await
        .map_err(certificate_error)?;
    Ok(no_store_json(DeletedCertificateResponse { deleted: true }))
}

fn certificate_id(id: &str) -> Result<(), ApiError> {
    if is_canonical_uuid_v7(id) {
        Ok(())
    } else {
        Err(ApiError::certificate(CertificateError::NotFound))
    }
}

fn certificate_error(error: CertificateError) -> ApiError {
    ApiError::certificate(error)
}

pub(super) async fn apply_proxy_config(
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

pub(super) async fn read_proxy_config(state: AppState) -> Result<Response, ApiError> {
    let (config, active_revision) = state.runtime.active_config().await.map_err(runtime_error)?;
    Ok(no_store_json(ProxyConfigSourceResponse {
        config,
        active_revision,
    }))
}

pub(super) async fn read_proxy_host_config(
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
        config,
        active_revision: Some(active_revision),
    }))
}

pub(super) async fn preview_proxy_host_config(
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
        config,
        revision,
    }))
}

pub(super) async fn preview_proxy_config(
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

fn no_store_status_json<T: Serialize>(status: StatusCode, payload: T) -> Response {
    let mut response = (status, Json(payload)).into_response();
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
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
struct CertificateListResponse {
    certificates: Vec<CertificateMetadata>,
}

#[derive(Serialize)]
struct DeletedCertificateResponse {
    deleted: bool,
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
