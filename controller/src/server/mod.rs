pub(crate) mod auth;
pub(crate) mod challenges;
mod error;
mod handlers;

use std::sync::Arc;

use axum::{
    Router, middleware,
    routing::{get, post},
};

use crate::{config::ControllerToken, runtime::ProxyRuntime};

use challenges::ChallengeStore;

use auth::{authorize_certificate_request, authorize_internal_request};
use handlers::{
    apply_proxy_config, challenge_response, delete_certificate, get_certificate, health,
    import_certificate, issue_certificate, list_certificates, preview_proxy_config,
    preview_proxy_host_config, proxy_status, read_proxy_config, read_proxy_host_config,
    renew_certificate, validate_trusted_ca,
};

const MAX_PROXY_CONFIG_BODY_BYTES: usize = 16 * 1024 * 1024;

#[derive(Clone)]
pub(crate) struct AppState {
    runtime: Arc<ProxyRuntime>,
    controller_token: Option<ControllerToken>,
    pub(crate) challenges: ChallengeStore,
}

impl AppState {
    pub(crate) fn new(
        runtime: Arc<ProxyRuntime>,
        controller_token: Option<ControllerToken>,
    ) -> Self {
        Self {
            runtime,
            controller_token,
            challenges: ChallengeStore::new(),
        }
    }
}

pub(crate) fn app_with_state(state: AppState) -> Router {
    let certificates = Router::new()
        .route("/internal/v1/certificates", get(list_certificates))
        .route(
            "/internal/v1/certificates/{id}",
            get(get_certificate).delete(delete_certificate),
        )
        .route(
            "/internal/v1/certificates/{id}/import",
            post(import_certificate),
        )
        .route(
            "/internal/v1/certificates/{id}/issue",
            post(issue_certificate),
        )
        .route(
            "/internal/v1/certificates/{id}/renew",
            post(renew_certificate),
        )
        .route(
            "/internal/v1/trusted-cas/validate",
            post(validate_trusted_ca),
        )
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            authorize_certificate_request,
        ));
    let internal = Router::new()
        .route("/internal/v1/proxy/status", get(proxy_status))
        .route(
            "/internal/v1/proxy/config",
            get(read_proxy_config).put(apply_proxy_config),
        )
        .route(
            "/internal/v1/proxy/config/preview",
            post(preview_proxy_config),
        )
        .route(
            "/internal/v1/proxy/hosts/{id}/config",
            get(read_proxy_host_config),
        )
        .route(
            "/internal/v1/proxy/hosts/{id}/config/preview",
            post(preview_proxy_host_config),
        )
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            authorize_internal_request,
        ));
    Router::new()
        .route("/health", get(health))
        .route(
            "/.well-known/acme-challenge/{token}",
            get(challenge_response),
        )
        .merge(certificates)
        .merge(internal)
        .layer(axum::extract::DefaultBodyLimit::max(
            MAX_PROXY_CONFIG_BODY_BYTES,
        ))
        .with_state(state)
}
