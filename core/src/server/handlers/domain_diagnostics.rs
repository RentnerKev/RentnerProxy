use super::{no_store_json, no_store_status_json};
use crate::{
    runtime::domain_diagnostics::{Error, Request},
    server::{AppState, error::ApiError},
};
use axum::{body::Bytes, extract::rejection::BytesRejection, http::StatusCode, response::Response};

fn invalid_input() -> Response {
    no_store_status_json(
        StatusCode::UNPROCESSABLE_ENTITY,
        serde_json::json!({"error":"invalid_input"}),
    )
}
pub(in crate::server) async fn diagnose(
    state: AppState,
    body: std::result::Result<Bytes, BytesRejection>,
) -> std::result::Result<Response, ApiError> {
    let body = match body {
        Ok(body) => body,
        Err(_) => return Ok(invalid_input()),
    };
    if body.len() > 4096 {
        return Ok(invalid_input());
    }
    let request: Request = match serde_json::from_slice(&body) {
        Ok(request) => request,
        Err(_) => return Ok(invalid_input()),
    };
    match state.runtime.diagnose_domain(request).await {
        Ok(result) => Ok(no_store_json(result)),
        Err(Error::InvalidInput) => Ok(invalid_input()),
        Err(Error::Busy) => Err(ApiError::busy()),
        Err(Error::Unavailable) => Err(ApiError::runtime_unavailable()),
    }
}
