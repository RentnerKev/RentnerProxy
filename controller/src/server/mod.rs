pub(crate) mod auth;
mod error;
mod handlers;

use std::sync::Arc;

use axum::{
    Router, middleware,
    routing::{get, put},
};

use crate::{config::ControllerToken, runtime::ProxyRuntime};

use auth::authorize_internal_request;
use handlers::{apply_proxy_config, health, proxy_status};

const MAX_PROXY_CONFIG_BODY_BYTES: usize = 16 * 1024 * 1024;

#[derive(Clone)]
pub(crate) struct AppState {
    runtime: Arc<ProxyRuntime>,
    controller_token: Option<ControllerToken>,
}

impl AppState {
    pub(crate) fn new(
        runtime: Arc<ProxyRuntime>,
        controller_token: Option<ControllerToken>,
    ) -> Self {
        Self {
            runtime,
            controller_token,
        }
    }
}

pub(crate) fn app_with_state(state: AppState) -> Router {
    let internal = Router::new()
        .route("/internal/v1/proxy/status", get(proxy_status))
        .route("/internal/v1/proxy/config", put(apply_proxy_config))
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            authorize_internal_request,
        ));
    Router::new()
        .route("/health", get(health))
        .merge(internal)
        .layer(axum::extract::DefaultBodyLimit::max(
            MAX_PROXY_CONFIG_BODY_BYTES,
        ))
        .with_state(state)
}
