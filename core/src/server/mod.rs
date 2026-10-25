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
    access_logs, apply_crowdsec_config, apply_proxy_config, certificate_events,
    certificate_store_status, challenge_response, crowdsec_dashboard, crowdsec_status,
    delete_certificate, enroll_crowdsec_console, get_certificate, health, import_certificate,
    issue_certificate, list_certificates, preview_proxy_config, preview_proxy_host_config,
    proxy_status, proxy_version, read_proxy_config, read_proxy_host_config, readiness,
    renew_certificate, test_crowdsec_connection, validate_trusted_ca,
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
        .route(
            "/internal/v1/certificates/events",
            get({
                let state = state.clone();
                move |request| certificate_events(request, state.clone())
            }),
        )
        .route(
            "/internal/v1/certificates/status",
            get({
                let state = state.clone();
                move || certificate_store_status(state.clone())
            }),
        )
        .route(
            "/internal/v1/certificates/{id}/status",
            get({
                let state = state.clone();
                move |id| get_certificate(id, state.clone())
            }),
        )
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
            "/internal/v1/certificates/{id}/dns-01/continue",
            post({
                let state = state.clone();
                move |id, body| handlers::continue_manual_dns(id, state.clone(), body)
            }),
        )
        .route(
            "/internal/v1/certificates/{id}/dns-01/cancel",
            post({
                let state = state.clone();
                move |id, body| handlers::cancel_manual_dns(id, state.clone(), body)
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
    let discovery = Router::new()
        .route(
            "/internal/v1/discovery/docker/inspect",
            post({
                let state = state.clone();
                move |body| handlers::docker_discovery::inspect(state.clone(), body)
            }),
        )
        .route(
            "/internal/v1/discovery/docker/status",
            get({
                let state = state.clone();
                move || handlers::docker_discovery::status(state.clone())
            }),
        )
        .route(
            "/internal/v1/discovery/docker/config",
            axum::routing::put({
                let state = state.clone();
                move |body| handlers::docker_discovery::save(state.clone(), body)
            }),
        )
        .layer(axum::extract::DefaultBodyLimit::max(4_096))
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            authorize_certificate_request,
        ));
    let ddns = Router::new()
        .route(
            "/internal/v1/ddns/config",
            get({
                let state = state.clone();
                move || handlers::ddns::status(state.clone())
            })
            .put({
                let state = state.clone();
                move |body| handlers::ddns::save(state.clone(), body)
            }),
        )
        .route(
            "/internal/v1/ddns/status",
            get({
                let state = state.clone();
                move || handlers::ddns::status(state.clone())
            }),
        )
        .route(
            "/internal/v1/ddns/events",
            get({
                let state = state.clone();
                move |query| handlers::ddns::events(state.clone(), query)
            }),
        )
        .route(
            "/internal/v1/ddns/enable",
            post({
                let state = state.clone();
                move |body| handlers::ddns::enabled(state.clone(), body, true)
            }),
        )
        .route(
            "/internal/v1/ddns/disable",
            post({
                let state = state.clone();
                move |body| handlers::ddns::enabled(state.clone(), body, false)
            }),
        )
        .route(
            "/internal/v1/ddns/preview",
            post({
                let state = state.clone();
                move |body| handlers::ddns::execute(state.clone(), body, true)
            }),
        )
        .route(
            "/internal/v1/ddns/sync",
            post({
                let state = state.clone();
                move |body| handlers::ddns::execute(state.clone(), body, false)
            }),
        )
        .layer(axum::extract::DefaultBodyLimit::max(128 * 1024))
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            authorize_certificate_request,
        ));
    let connections = Router::new()
        .route(
            "/internal/v1/dns/providers",
            get(handlers::dns_connections::providers),
        )
        .route(
            "/internal/v1/dns/connections",
            get({
                let state = state.clone();
                move || handlers::dns_connections::list(state.clone())
            }),
        )
        .route(
            "/internal/v1/dns/connections/test",
            post({
                let state = state.clone();
                move |body| handlers::dns_connections::test(state.clone(), body)
            }),
        )
        .route(
            "/internal/v1/dns/connections/references/validate",
            post({
                let state = state.clone();
                move |body| handlers::dns_connections::validate(state.clone(), body)
            }),
        )
        .route(
            "/internal/v1/dns/connections/{id}",
            axum::routing::put({
                let state = state.clone();
                move |id, body| handlers::dns_connections::save(id, state.clone(), body)
            })
            .delete({
                let state = state.clone();
                move |id, body| handlers::dns_connections::delete(id, state.clone(), body)
            }),
        )
        .layer(axum::extract::DefaultBodyLimit::max(32 * 1024))
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            authorize_certificate_request,
        ));
    let internal = Router::new()
        .route(
            "/internal/v1/proxy/version",
            get({
                let state = state.clone();
                move || proxy_version(state.clone())
            }),
        )
        .route(
            "/internal/v1/crowdsec/dashboard",
            get({
                let state = state.clone();
                move |request| crowdsec_dashboard(request, state.clone())
            }),
        )
        .route(
            "/internal/v1/crowdsec/status",
            get({
                let state = state.clone();
                move || crowdsec_status(state.clone())
            }),
        )
        .route(
            "/internal/v1/crowdsec/config",
            axum::routing::put({
                let state = state.clone();
                move |body| apply_crowdsec_config(state.clone(), body)
            }),
        )
        .route(
            "/internal/v1/crowdsec/test",
            post({
                let state = state.clone();
                move |body| test_crowdsec_connection(state.clone(), body)
            }),
        )
        .route(
            "/internal/v1/crowdsec/console/enroll",
            post({
                let state = state.clone();
                move |body| enroll_crowdsec_console(state.clone(), body)
            }),
        )
        .route(
            "/internal/v1/proxy/status",
            get({
                let state = state.clone();
                move || proxy_status(state.clone())
            }),
        )
        .route(
            "/internal/v1/proxy/access-logs",
            get({
                let state = state.clone();
                move |query| access_logs(query, state.clone())
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
        .merge(connections)
        .merge(ddns)
        .merge(discovery)
        .merge(internal)
        .layer(axum::extract::DefaultBodyLimit::max(
            MAX_PROXY_CONFIG_BODY_BYTES,
        ))
}
