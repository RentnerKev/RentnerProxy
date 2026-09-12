use std::{collections::BTreeMap, path::PathBuf};

mod config;
mod model;
mod policy;
mod proxy;
mod routes;

pub(crate) const MAX_RENDERED_PROXY_CONFIG_BYTES: usize = 16 * 1024 * 1024;
pub(crate) const MAX_RENDERED_PROXY_HOST_SOURCE_BYTES: usize = 128 * 1024;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct RenderSettings {
    pub(crate) http_port: u16,
    pub(crate) probe_socket: Option<PathBuf>,
    pub(crate) admin_socket: Option<PathBuf>,
    pub(crate) state_dir: PathBuf,
    pub(crate) controller_port: u16,
    pub(crate) trusted_proxy_cidrs: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct TlsRenderSettings {
    pub(crate) https_port: u16,
    pub(crate) public_https_port: u16,
    pub(crate) controller_port: u16,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct TlsMaterial {
    pub(crate) fullchain_path: PathBuf,
    pub(crate) private_key_path: PathBuf,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct UpstreamTlsRenderSettings {
    pub(crate) system_ca_bundle: PathBuf,
    pub(crate) trusted_ca_paths: BTreeMap<String, PathBuf>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum RenderError {
    InvalidProbeSocket,
    InvalidCertificatePath,
    MissingCertificate,
    MissingTrustedCa,
    MissingUpstreamTlsPolicy,
    ConfigTooLarge,
}

pub(crate) fn render_config(
    config: Option<&crate::models::ValidatedProxyConfig>,
    settings: &RenderSettings,
) -> Result<String, RenderError> {
    config::render_config_inner(config, settings, None, None, None)
}

pub(crate) fn render_config_with_tls(
    config: &crate::models::ValidatedProxyConfig,
    settings: &RenderSettings,
    tls: &TlsRenderSettings,
    materials: &BTreeMap<String, TlsMaterial>,
    upstream_tls: &UpstreamTlsRenderSettings,
) -> Result<String, RenderError> {
    config::render_config_inner(
        Some(config),
        settings,
        Some(tls),
        Some(materials),
        Some(upstream_tls),
    )
}

pub(crate) fn render_host_config_for_runtime(
    host: &crate::models::ProxyHost,
    defaults: &crate::models::ProxyHttpSettings,
    public_https_port: u16,
    upstream_tls: Option<&UpstreamTlsRenderSettings>,
    trusted_proxy_cidrs: &[String],
) -> Result<String, RenderError> {
    routes::render_host_config_for_runtime(
        host,
        defaults,
        public_https_port,
        upstream_tls,
        trusted_proxy_cidrs,
    )
}

pub(crate) fn render_host_sources_for_runtime(
    configuration: &crate::models::ValidatedProxyConfig,
    public_https_port: u16,
    upstream_tls: Option<&UpstreamTlsRenderSettings>,
    trusted_proxy_cidrs: &[String],
) -> Result<BTreeMap<String, String>, RenderError> {
    routes::render_host_sources_for_runtime(
        configuration,
        public_https_port,
        upstream_tls,
        trusted_proxy_cidrs,
    )
}
