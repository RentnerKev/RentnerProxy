use crate::{proxy::is_canonical_domain, server::AppState};
use axum::{
    extract::Path,
    http::{
        HeaderMap, HeaderValue, StatusCode,
        header::{CACHE_CONTROL, CONTENT_TYPE, HOST},
    },
    response::{IntoResponse, Response},
};

pub(in crate::server) async fn challenge_response(
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
