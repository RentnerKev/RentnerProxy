use axum::{
    extract::{Request, State},
    http::HeaderMap,
    middleware::Next,
    response::{IntoResponse, Response},
};

use crate::config::ControllerToken;

use super::{AppState, error::ApiError};

pub(super) async fn authorize_internal_request(
    State(state): State<AppState>,
    request: Request,
    next: Next,
) -> Response {
    match authorize(request.headers(), state.controller_token.as_ref()) {
        Ok(()) => next.run(request).await,
        Err(error) => error.into_response(),
    }
}

fn authorize(headers: &HeaderMap, token: Option<&ControllerToken>) -> Result<(), ApiError> {
    let Some(token) = token else {
        return Ok(());
    };
    let Some(value) = headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
    else {
        return Err(ApiError::unauthorized());
    };
    let Some(value) = value.strip_prefix("Bearer ") else {
        return Err(ApiError::unauthorized());
    };
    if constant_time_equal(value.as_bytes(), token.as_str().as_bytes()) {
        Ok(())
    } else {
        Err(ApiError::unauthorized())
    }
}

pub(crate) fn constant_time_equal(left: &[u8], right: &[u8]) -> bool {
    let mut difference = left.len() ^ right.len();
    let width = left.len().max(right.len());
    for index in 0..width {
        difference |= usize::from(*left.get(index).unwrap_or(&0) ^ *right.get(index).unwrap_or(&0));
    }
    difference == 0
}
