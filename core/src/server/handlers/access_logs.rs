use super::no_store_json;
use crate::{
    runtime::access_logs::AccessLogQuery,
    server::{AppState, error::ApiError},
};
use axum::{
    extract::{Query, Request},
    response::Response,
};

pub(in crate::server) async fn access_logs(
    request: Request,
    state: AppState,
) -> Result<Response, ApiError> {
    if request
        .uri()
        .query()
        .is_some_and(|query| query.len() > 4096)
    {
        return Err(ApiError::validation_failed());
    }
    let Query(query) = Query::<AccessLogQuery>::try_from_uri(request.uri())
        .map_err(|_| ApiError::validation_failed())?;
    let query = query.validate().map_err(|error| match error {
        crate::runtime::access_logs::AccessLogQueryError::Invalid => ApiError::validation_failed(),
        crate::runtime::access_logs::AccessLogQueryError::MalformedSnapshot => {
            ApiError::invalid_snapshot()
        }
    })?;
    state
        .runtime
        .access_logs(query)
        .await
        .map(no_store_json)
        .map_err(|error| match error {
            crate::runtime::access_logs::ReadError::Busy => ApiError::busy(),
            crate::runtime::access_logs::ReadError::Failed => ApiError::runtime_unavailable(),
        })
}
