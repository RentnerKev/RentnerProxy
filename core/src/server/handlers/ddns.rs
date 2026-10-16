use super::{no_store_json, no_store_status_json};
use crate::{
    runtime::ddns::{Error, Request},
    server::AppState,
};
use axum::{body::Bytes, extract::rejection::BytesRejection, http::StatusCode, response::Response};

pub(in crate::server) async fn execute(
    state: AppState,
    body: Result<Bytes, BytesRejection>,
    preview: bool,
) -> Response {
    let request = body
        .ok()
        .filter(|body| body.len() <= 128 * 1024)
        .and_then(|body| serde_json::from_slice::<Request>(&body).ok());
    let Some(request) = request else {
        return no_store_status_json(
            StatusCode::BAD_REQUEST,
            serde_json::json!({"error":Error::InvalidInput}),
        );
    };
    match state
        .runtime
        .ddns
        .execute(&state.runtime.dns_connections, request, preview)
        .await
    {
        Ok(result) => no_store_json(result),
        Err(error) => no_store_status_json(
            match error {
                Error::Busy => StatusCode::CONFLICT,
                Error::InvalidInput => StatusCode::BAD_REQUEST,
                _ => StatusCode::SERVICE_UNAVAILABLE,
            },
            serde_json::json!({"error":error}),
        ),
    }
}
