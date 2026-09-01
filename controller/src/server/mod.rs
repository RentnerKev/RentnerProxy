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
    preview_proxy_host_config, proxy_status, read_proxy_config, read_proxy_host_config, readiness,
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
    // Capture application-owned state when registering routes. Only request extractors
    // belong in handler parameters; runtime paths and credentials are never request data.
    let certificates = Router::new()
        .route(
            "/internal/v1/certificates",
            get({
                let state = state.clone();
                move || list_certificates(state.clone())
            }),
        )
        .route(
            "/internal/v1/certificates/{id}",
            get({
                let state = state.clone();
                move |id| get_certificate(id, state.clone())
            })
            .delete({
                let state = state.clone();
                move |id| delete_certificate(id, state.clone())
            }),
        )
        .route(
            "/internal/v1/certificates/{id}/import",
            post({
                let state = state.clone();
                move |id, body| import_certificate(id, state.clone(), body)
            }),
        )
        .route(
            "/internal/v1/certificates/{id}/issue",
            post({
                let state = state.clone();
                move |id, body| issue_certificate(id, state.clone(), body)
            }),
        )
        .route(
            "/internal/v1/certificates/{id}/renew",
            post({
                let state = state.clone();
                move |id, body| renew_certificate(id, state.clone(), body)
            }),
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
        .route(
            "/internal/v1/proxy/status",
            get({
                let state = state.clone();
                move || proxy_status(state.clone())
            }),
        )
        .route(
            "/internal/v1/proxy/config",
            get({
                let state = state.clone();
                move || read_proxy_config(state.clone())
            })
            .put({
                let state = state.clone();
                move |body| apply_proxy_config(state.clone(), body)
            }),
        )
        .route(
            "/internal/v1/proxy/config/preview",
            post({
                let state = state.clone();
                move |body| preview_proxy_config(state.clone(), body)
            }),
        )
        .route(
            "/internal/v1/proxy/hosts/{id}/config",
            get({
                let state = state.clone();
                move |id| read_proxy_host_config(id, state.clone())
            }),
        )
        .route(
            "/internal/v1/proxy/hosts/{id}/config/preview",
            post({
                let state = state.clone();
                move |id, body| preview_proxy_host_config(id, state.clone(), body)
            }),
        )
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            authorize_internal_request,
        ));
    Router::new()
        .route("/health", get(health))
        .route(
            "/ready",
            get({
                let state = state.clone();
                move || readiness(state.clone())
            }),
        )
        .route(
            "/.well-known/acme-challenge/{token}",
            get({
                let state = state.clone();
                move |token, headers| challenge_response(token, state.clone(), headers)
            }),
        )
        .merge(certificates)
        .merge(internal)
        .layer(axum::extract::DefaultBodyLimit::max(
            MAX_PROXY_CONFIG_BODY_BYTES,
        ))
}
