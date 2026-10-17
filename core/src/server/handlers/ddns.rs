use super::{no_store_json, no_store_status_json};
use crate::{
    runtime::ddns::{Action, AutomationError, Request, SaveConfiguration},
    server::AppState,
};
use axum::{
    body::Bytes,
    extract::{Query, rejection::BytesRejection},
    http::{HeaderValue, StatusCode, header::RETRY_AFTER},
    response::Response,
};
use serde::{Deserialize, de::DeserializeOwned};

fn error(error: AutomationError) -> Response {
    no_store_status_json(
        match error {
            AutomationError::InvalidInput => StatusCode::BAD_REQUEST,
            AutomationError::Conflict
            | AutomationError::Busy
            | AutomationError::Disabled
            | AutomationError::RestorePaused => StatusCode::CONFLICT,
            AutomationError::RetryDeferred => StatusCode::TOO_MANY_REQUESTS,
            _ => StatusCode::SERVICE_UNAVAILABLE,
        },
        serde_json::json!({"error":error}),
    )
}
fn parse<T: DeserializeOwned>(body: Result<Bytes, BytesRejection>) -> Result<T, AutomationError> {
    body.ok()
        .filter(|body| body.len() <= 128 * 1024)
        .and_then(|body| serde_json::from_slice(body.as_ref()).ok())
        .ok_or(AutomationError::InvalidInput)
}

async fn run_error(state: &AppState, reason: AutomationError) -> Response {
    if reason != AutomationError::RetryDeferred {
        return error(reason);
    }
    let now = time::OffsetDateTime::now_utc().unix_timestamp();
    let seconds = match state
        .runtime
        .ddns_automation
        .status(&state.runtime.dns_connections)
        .await
    {
        Ok(value) => {
            let target_retry = value
                .targets
                .iter()
                .filter(|target| target.consecutive_failures > 0)
                .filter_map(|target| target.retry_not_before)
                .filter(|at| *at > now)
                .min()
                .unwrap_or(now + 1);
            target_retry
                .max(value.provider_not_before.unwrap_or(0))
                .max(value.manual_not_before.unwrap_or(0))
                .saturating_sub(now)
                .clamp(1, 86_400)
        }
        Err(_) => 1,
    };
    let mut response = no_store_status_json(
        StatusCode::TOO_MANY_REQUESTS,
        serde_json::json!({"error":reason,"retryAfterSeconds":seconds}),
    );
    if let Ok(value) = HeaderValue::from_str(&seconds.to_string()) {
        response.headers_mut().insert(RETRY_AFTER, value);
    }
    response
}

pub(in crate::server) async fn execute(
    state: AppState,
    body: Result<Bytes, BytesRejection>,
    preview: bool,
) -> Response {
    let result = if preview {
        match parse::<Request>(body) {
            Ok(request) => {
                state
                    .runtime
                    .ddns_automation
                    .preview(&state.runtime.dns_connections, &state.runtime.ddns, request)
                    .await
            }
            Err(e) => return error(e),
        }
    } else {
        match parse::<Action>(body) {
            Ok(action) => {
                state
                    .runtime
                    .ddns_automation
                    .manual(&state.runtime.dns_connections, &state.runtime.ddns, action)
                    .await
            }
            Err(e) => return error(e),
        }
    };
    match result {
        Ok(result) => no_store_json(result),
        Err(e) => run_error(&state, e).await,
    }
}

pub(in crate::server) async fn status(state: AppState) -> Response {
    match state
        .runtime
        .ddns_automation
        .status(&state.runtime.dns_connections)
        .await
    {
        Ok(value) => no_store_json(value),
        Err(e) => error(e),
    }
}
pub(in crate::server) async fn save(
    state: AppState,
    body: Result<Bytes, BytesRejection>,
) -> Response {
    let request = match parse::<SaveConfiguration>(body) {
        Ok(value) => value,
        Err(e) => return error(e),
    };
    match state
        .runtime
        .ddns_automation
        .save(&state.runtime.dns_connections, request)
        .await
    {
        Ok(value) => no_store_json(value),
        Err(e) => error(e),
    }
}
pub(in crate::server) async fn enabled(
    state: AppState,
    body: Result<Bytes, BytesRejection>,
    enabled: bool,
) -> Response {
    let action = match parse::<Action>(body) {
        Ok(value) => value,
        Err(e) => return error(e),
    };
    let result = if enabled {
        state
            .runtime
            .ddns_automation
            .enable(&state.runtime.dns_connections, action)
            .await
    } else {
        state
            .runtime
            .ddns_automation
            .disable(&state.runtime.dns_connections, action)
            .await
    };
    match result {
        Ok(value) => no_store_json(value),
        Err(e) => error(e),
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(in crate::server) struct EventsQuery {
    after: Option<u32>,
    limit: Option<usize>,
}
pub(in crate::server) async fn events(
    state: AppState,
    query: Result<Query<EventsQuery>, axum::extract::rejection::QueryRejection>,
) -> Response {
    let Query(query) = match query {
        Ok(value) => value,
        Err(_) => return error(AutomationError::InvalidInput),
    };
    let limit = query.limit.unwrap_or(64);
    if !(1..=64).contains(&limit) {
        return error(AutomationError::InvalidInput);
    }
    match state
        .runtime
        .ddns_automation
        .status(&state.runtime.dns_connections)
        .await
    {
        Ok(value) => {
            let after = query.after.unwrap_or(0);
            let oldest = value
                .events
                .first()
                .map_or(value.event_sequence, |event| event.sequence);
            let events: Vec<_> = value
                .events
                .iter()
                .filter(|event| event.sequence > after)
                .take(limit)
                .collect();
            no_store_json(
                serde_json::json!({"events":events,"latestSequence":value.event_sequence,"oldestSequence":oldest,"truncated":after.saturating_add(1) < oldest}),
            )
        }
        Err(e) => error(e),
    }
}
