use super::{certificates::manual_dns_action, no_store_json};
use crate::{
    proxy::is_canonical_uuid_v7,
    runtime::{CertificateError, dns_setup::SetupRequest},
    server::{AppState, error::ApiError},
};
use axum::{
    body::Bytes,
    extract::{Path, rejection::BytesRejection},
    response::Response,
};

pub(in crate::server) async fn setup(
    state: AppState,
    body: Result<Bytes, BytesRejection>,
) -> Result<Response, ApiError> {
    let body = body.map_err(|_| ApiError::validation_failed())?;
    if body.len() > 32 * 1024 {
        return Err(ApiError::validation_failed());
    }
    let request: SetupRequest =
        serde_json::from_slice(&body).map_err(|_| ApiError::validation_failed())?;
    Ok(no_store_json(
        state
            .runtime
            .dns_setup(request)
            .await
            .map_err(ApiError::certificate)?,
    ))
}

pub(in crate::server) async fn check(
    Path(id): Path<String>,
    state: AppState,
    body: Result<Bytes, BytesRejection>,
) -> Result<Response, ApiError> {
    if !is_canonical_uuid_v7(&id) {
        return Err(ApiError::certificate(CertificateError::NotFound));
    }
    let action = manual_dns_action(body)?;
    Ok(no_store_json(
        state
            .runtime
            .check_manual_dns(&id, &action)
            .await
            .map_err(ApiError::certificate)?,
    ))
}
