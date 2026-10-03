use axum::{
    Json,
    http::{HeaderValue, StatusCode, header::CACHE_CONTROL},
    response::{IntoResponse, Response},
};
use serde::Serialize;

mod access_logs;
mod certificates;
mod challenges;
mod crowdsec;
mod health;
mod proxy;

pub(super) use access_logs::access_logs;
pub(super) use certificates::{
    certificate_events, certificate_store_status, delete_certificate, get_certificate,
    import_certificate, issue_certificate, list_certificates, renew_certificate,
    validate_trusted_ca,
};
pub(super) use challenges::challenge_response;
pub(super) use crowdsec::{
    apply_crowdsec_config, crowdsec_dashboard, crowdsec_status, enroll_crowdsec_console,
    test_crowdsec_connection,
};
pub(super) use health::{health, readiness};
pub(super) use proxy::{
    apply_proxy_config, preview_proxy_config, preview_proxy_host_config, proxy_status,
    read_proxy_config, read_proxy_host_config,
};

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
