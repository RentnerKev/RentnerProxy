use super::no_store_json;
use crate::{
    models::{CrowdSecConfigRequest, CrowdSecConsoleEnrollRequest},
    runtime::{CrowdSecError, crowdsec_dashboard::CrowdSecDashboardQuery},
    server::{AppState, error::ApiError},
};
use axum::{
    body::Bytes,
    extract::{Query, Request, rejection::BytesRejection},
    response::Response,
};

pub(in crate::server) async fn crowdsec_status(state: AppState) -> Response {
    no_store_json(state.runtime.crowdsec_status().await)
}

pub(in crate::server) async fn crowdsec_dashboard(
    request: Request,
    state: AppState,
) -> Result<Response, ApiError> {
    if request
        .uri()
        .query()
        .is_some_and(|query| query.len() > 2048)
    {
        return Err(ApiError::validation_failed());
    }
    let Query(query) = Query::<CrowdSecDashboardQuery>::try_from_uri(request.uri())
        .map_err(|_| ApiError::validation_failed())?;
    if !query.validate() {
        return Err(ApiError::validation_failed());
    }
    Ok(no_store_json(
        state.runtime.crowdsec_dashboard(&query).await,
    ))
}

pub(in crate::server) async fn apply_crowdsec_config(
    state: AppState,
    body: Result<Bytes, BytesRejection>,
) -> Result<Response, ApiError> {
    let request = crowdsec_request(body)?;
    state
        .runtime
        .apply_crowdsec(request)
        .await
        .map(no_store_json)
        .map_err(crowdsec_error)
}

pub(in crate::server) async fn test_crowdsec_connection(
    state: AppState,
    body: Result<Bytes, BytesRejection>,
) -> Result<Response, ApiError> {
    let request = crowdsec_request(body)?;
    state
        .runtime
        .test_crowdsec_connection(request)
        .await
        .map_err(crowdsec_error)?;
    Ok(no_store_json(serde_json::json!({ "status": "connected" })))
}

pub(in crate::server) async fn enroll_crowdsec_console(
    state: AppState,
    body: Result<Bytes, BytesRejection>,
) -> Result<Response, ApiError> {
    let body = body.map_err(|_| ApiError::payload_too_large())?;
    if body.len() > 1_024 {
        return Err(ApiError::payload_too_large());
    }
    let request: CrowdSecConsoleEnrollRequest =
        serde_json::from_slice(&body).map_err(|_| ApiError::invalid_crowdsec_configuration())?;
    state
        .runtime
        .enroll_crowdsec_console(&request.enrollment_key)
        .await
        .map_err(crowdsec_error)?;
    Ok(no_store_json(serde_json::json!({ "status": "pending" })))
}

fn crowdsec_request(
    body: Result<Bytes, BytesRejection>,
) -> Result<CrowdSecConfigRequest, ApiError> {
    let body = body.map_err(|_| ApiError::payload_too_large())?;
    if body.len() > 8 * 1_024 {
        return Err(ApiError::payload_too_large());
    }
    serde_json::from_slice(&body).map_err(|_| ApiError::invalid_crowdsec_configuration())
}

fn crowdsec_error(error: CrowdSecError) -> ApiError {
    match error {
        CrowdSecError::Busy => ApiError::busy(),
        CrowdSecError::InvalidConfiguration => ApiError::invalid_crowdsec_configuration(),
        CrowdSecError::ConnectionFailed => ApiError::crowdsec_connection_failed(),
        CrowdSecError::RuntimeUnavailable => ApiError::runtime_unavailable(),
        CrowdSecError::ApplyFailed => ApiError::apply_failed(),
    }
}
