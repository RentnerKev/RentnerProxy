use std::{
    collections::{BTreeMap, BTreeSet},
    net::IpAddr,
    path::{Path, PathBuf},
};

use serde::Serialize;

use crate::models::{ProxyHost, ProxyHttpSettings, RedirectHost, ValidatedProxyConfig};

pub(crate) const MAX_RENDERED_PROXY_CONFIG_BYTES: usize = 16 * 1024 * 1024;
pub(crate) const MAX_RENDERED_PROXY_HOST_SOURCE_BYTES: usize = 128 * 1024;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct RenderSettings {
    pub(crate) http_port: u16,
    pub(crate) probe_socket: Option<PathBuf>,
    pub(crate) admin_socket: Option<PathBuf>,
    pub(crate) state_dir: PathBuf,
    pub(crate) controller_port: u16,
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

#[derive(Serialize)]
struct CaddyConfig {
    admin: Admin,
    storage: Storage,
    apps: Apps,
}

#[derive(Serialize)]
struct Admin {
    listen: String,
    config: AdminConfig,
}

#[derive(Serialize)]
struct AdminConfig {
    persist: bool,
}

#[derive(Serialize)]
struct Storage {
    module: String,
    root: String,
}

#[derive(Serialize)]
struct Apps {
    http: HttpApp,
    #[serde(skip_serializing_if = "Option::is_none")]
    tls: Option<TlsApp>,
}

#[derive(Serialize)]
struct HttpApp {
    servers: BTreeMap<String, HttpServer>,
}

#[derive(Serialize)]
struct HttpServer {
    listen: Vec<String>,
    routes: Vec<Route>,
    automatic_https: AutoHttps,
    protocols: Vec<String>,
    read_header_timeout: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    write_timeout: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    idle_timeout: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    strict_sni_host: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tls_connection_policies: Option<Vec<TlsConnectionPolicy>>,
}

#[derive(Serialize)]
struct AutoHttps {
    disable: bool,
}

#[derive(Serialize)]
struct Route {
    #[serde(rename = "match", skip_serializing_if = "Vec::is_empty")]
    matchers: Vec<Matcher>,
    handle: Vec<Handler>,
    terminal: bool,
}

#[derive(Serialize)]
#[serde(untagged)]
enum Matcher {
    Host { host: Vec<String> },
    Path { path: Vec<String> },
}

#[derive(Serialize)]
#[serde(tag = "handler")]
enum Handler {
    #[serde(rename = "static_response")]
    StaticResponse(StaticResponse),
    #[serde(rename = "reverse_proxy")]
    ReverseProxy(Box<ReverseProxy>),
    #[serde(rename = "request_body")]
    RequestBody(RequestBody),
}

#[derive(Serialize)]
struct StaticResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    body: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    status_code: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    headers: Option<BTreeMap<String, Vec<String>>>,
}

#[derive(Serialize)]
struct RequestBody {
    max_size: u64,
}

#[derive(Serialize)]
struct ReverseProxy {
    upstreams: Vec<Upstream>,
    headers: RequestHeaders,
    transport: HttpTransport,
    stream_close_delay: String,
}

#[derive(Serialize)]
struct Upstream {
    dial: String,
}

#[derive(Serialize)]
struct RequestHeaders {
    request: HeaderOps,
}

#[derive(Serialize)]
struct HeaderOps {
    set: BTreeMap<String, Vec<String>>,
    delete: Vec<String>,
}

#[derive(Serialize)]
struct HttpTransport {
    protocol: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    dial_timeout: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    read_timeout: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    response_header_timeout: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    write_timeout: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tls: Option<UpstreamTls>,
}

#[derive(Serialize)]
struct UpstreamTls {
    #[serde(skip_serializing_if = "Option::is_none")]
    ca: Option<CaSource>,
    #[serde(skip_serializing_if = "Option::is_none")]
    insecure_skip_verify: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    server_name: Option<String>,
}

#[derive(Serialize)]
struct CaSource {
    provider: String,
    pem_files: Vec<String>,
}

#[derive(Serialize)]
struct TlsApp {
    certificates: CertificateLoaders,
}

#[derive(Serialize)]
struct CertificateLoaders {
    load_files: Vec<CertificateFile>,
}

#[derive(Serialize)]
struct CertificateFile {
    certificate: String,
    key: String,
    tags: Vec<String>,
}

#[derive(Serialize)]
struct TlsConnectionPolicy {
    #[serde(rename = "match")]
    matcher: TlsMatcher,
    certificate_selection: CertificateSelection,
    protocol_min: String,
    alpn: Vec<String>,
}

#[derive(Serialize)]
struct TlsMatcher {
    sni: Vec<String>,
}

#[derive(Serialize)]
struct CertificateSelection {
    any_tag: Vec<String>,
}

pub(crate) fn render_config(
    config: Option<&ValidatedProxyConfig>,
    settings: &RenderSettings,
) -> Result<String, RenderError> {
    render_config_inner(config, settings, None, None, None)
}

pub(crate) fn render_config_with_tls(
    config: &ValidatedProxyConfig,
    settings: &RenderSettings,
    tls: &TlsRenderSettings,
    materials: &BTreeMap<String, TlsMaterial>,
    upstream_tls: &UpstreamTlsRenderSettings,
) -> Result<String, RenderError> {
    render_config_inner(
        Some(config),
        settings,
        Some(tls),
        Some(materials),
        Some(upstream_tls),
    )
}

fn render_config_inner(
    config: Option<&ValidatedProxyConfig>,
    settings: &RenderSettings,
    tls: Option<&TlsRenderSettings>,
    materials: Option<&BTreeMap<String, TlsMaterial>>,
    upstream_tls: Option<&UpstreamTlsRenderSettings>,
) -> Result<String, RenderError> {
    let config = config.cloned().unwrap_or_else(empty_config);
    let revision = if config.revision.is_empty() {
        "none"
    } else {
        &config.revision
    };
    let admin_listen = admin_listen(settings.admin_socket.as_deref())?;
    let state_root = path_string(&settings.state_dir, RenderError::InvalidProbeSocket)?;
    let mut servers = BTreeMap::new();
    servers.insert(
        "rentnerproxy-http".to_owned(),
        HttpServer {
            listen: vec![format!(":{}", settings.http_port)],
            routes: http_routes(
                &config,
                settings,
                tls.map_or(443, |v| v.public_https_port),
                upstream_tls,
            )?,
            automatic_https: AutoHttps { disable: true },
            protocols: vec!["h1".to_owned(), "h2".to_owned()],
            read_header_timeout: "15s".to_owned(),
            write_timeout: seconds(config.http_settings.send_timeout_seconds),
            idle_timeout: seconds(config.http_settings.keepalive_timeout_seconds),
            strict_sni_host: None,
            tls_connection_policies: None,
        },
    );
    {
        let listen = settings
            .probe_socket
            .as_deref()
            .map(probe_listen)
            .transpose()?
            .unwrap_or_else(|| "127.0.0.1:2020".to_owned());
        servers.insert(
            "rentnerproxy-probe".to_owned(),
            HttpServer {
                listen: vec![listen],
                routes: vec![
                    Route {
                        matchers: vec![Matcher::Path {
                            path: vec!["/__rentnerproxy_runtime_probe".to_owned()],
                        }],
                        handle: vec![Handler::StaticResponse(StaticResponse {
                            body: Some(format!("{revision}\n")),
                            status_code: Some(200),
                            headers: None,
                        })],
                        terminal: true,
                    },
                    not_found_route(),
                ],
                automatic_https: AutoHttps { disable: true },
                protocols: vec!["h1".to_owned()],
                read_header_timeout: "15s".to_owned(),
                write_timeout: None,
                idle_timeout: None,
                strict_sni_host: None,
                tls_connection_policies: None,
            },
        );
    }

    let mut tls_app = None;
    if let (Some(tls), Some(materials), Some(upstream_tls)) = (tls, materials, upstream_tls) {
        let mut certs = Vec::new();
        let mut loaded_certificate_ids = BTreeSet::new();
        let mut policies = Vec::new();
        let mut https_routes = vec![challenge_route(settings.controller_port)];
        for host in &config.proxy_hosts {
            let Some(certificate_id) = host.certificate_id.as_ref() else {
                continue;
            };
            let material = materials
                .get(certificate_id)
                .ok_or(RenderError::MissingCertificate)?;
            if loaded_certificate_ids.insert(certificate_id.clone()) {
                certs.push(CertificateFile {
                    certificate: certificate_path(&material.fullchain_path)?,
                    key: certificate_path(&material.private_key_path)?,
                    tags: vec![certificate_id.clone()],
                });
            }
            policies.push(TlsConnectionPolicy {
                matcher: TlsMatcher {
                    sni: host.domains.clone(),
                },
                certificate_selection: CertificateSelection {
                    any_tag: vec![certificate_id.clone()],
                },
                protocol_min: "tls1.2".to_owned(),
                alpn: vec!["h2".to_owned(), "http/1.1".to_owned()],
            });
            https_routes.push(host_route(
                host,
                tls.public_https_port,
                Some(upstream_tls),
                true,
                &config.http_settings,
            )?);
        }
        for host in &config.redirect_hosts {
            let Some(certificate_id) = host.certificate_id.as_ref() else {
                continue;
            };
            let material = materials
                .get(certificate_id)
                .ok_or(RenderError::MissingCertificate)?;
            if loaded_certificate_ids.insert(certificate_id.clone()) {
                certs.push(CertificateFile {
                    certificate: certificate_path(&material.fullchain_path)?,
                    key: certificate_path(&material.private_key_path)?,
                    tags: vec![certificate_id.clone()],
                });
            }
            policies.push(TlsConnectionPolicy {
                matcher: TlsMatcher {
                    sni: host.domains.clone(),
                },
                certificate_selection: CertificateSelection {
                    any_tag: vec![certificate_id.clone()],
                },
                protocol_min: "tls1.2".to_owned(),
                alpn: vec!["h2".to_owned(), "http/1.1".to_owned()],
            });
            https_routes.push(redirect_route(host)?);
        }
        if !certs.is_empty() {
            https_routes.push(not_found_route());
            servers.insert(
                "rentnerproxy-https".to_owned(),
                HttpServer {
                    listen: vec![format!(":{}", tls.https_port)],
                    routes: https_routes,
                    automatic_https: AutoHttps { disable: true },
                    protocols: vec!["h1".to_owned(), "h2".to_owned()],
                    read_header_timeout: "15s".to_owned(),
                    write_timeout: seconds(config.http_settings.send_timeout_seconds),
                    idle_timeout: seconds(config.http_settings.keepalive_timeout_seconds),
                    strict_sni_host: Some(true),
                    tls_connection_policies: Some(policies),
                },
            );
            tls_app = Some(TlsApp {
                certificates: CertificateLoaders { load_files: certs },
            });
        }
    }

    let output = serde_json::to_string(&CaddyConfig {
        admin: Admin {
            listen: admin_listen,
            config: AdminConfig { persist: true },
        },
        storage: Storage {
            module: "file_system".to_owned(),
            root: format!("{state_root}/caddy/data"),
        },
        apps: Apps {
            http: HttpApp { servers },
            tls: tls_app,
        },
    })
    .map_err(|_| RenderError::ConfigTooLarge)?;
    if output.len() > MAX_RENDERED_PROXY_CONFIG_BYTES {
        return Err(RenderError::ConfigTooLarge);
    }
    Ok(output)
}

fn empty_config() -> ValidatedProxyConfig {
    ValidatedProxyConfig {
        revision: String::new(),
        proxy_hosts: Vec::new(),
        redirect_hosts: Vec::new(),
        http_settings: ProxyHttpSettings::default(),
        trusted_cas: Vec::new(),
    }
}

fn http_routes(
    config: &ValidatedProxyConfig,
    settings: &RenderSettings,
    public_https_port: u16,
    upstream_tls: Option<&UpstreamTlsRenderSettings>,
) -> Result<Vec<Route>, RenderError> {
    let mut routes = vec![challenge_route(settings.controller_port)];
    for host in &config.proxy_hosts {
        routes.push(host_route(
            host,
            public_https_port,
            upstream_tls,
            false,
            &config.http_settings,
        )?);
    }
    for host in &config.redirect_hosts {
        routes.push(redirect_route(host)?);
    }
    routes.push(not_found_route());
    Ok(routes)
}

fn challenge_route(controller_port: u16) -> Route {
    Route {
        matchers: vec![Matcher::Path {
            path: vec!["/.well-known/acme-challenge/*".to_owned()],
        }],
        handle: vec![Handler::ReverseProxy(Box::new(
            reverse_proxy(&format!("127.0.0.1:{controller_port}"), None, None, None)
                .expect("controller challenge proxy is always valid"),
        ))],
        terminal: true,
    }
}

fn host_route(
    host: &ProxyHost,
    public_https_port: u16,
    upstream_tls: Option<&UpstreamTlsRenderSettings>,
    https_listener: bool,
    defaults: &ProxyHttpSettings,
) -> Result<Route, RenderError> {
    let mut handle = Vec::new();
    if let Some(max_size) = host
        .http_settings
        .client_max_body_size_bytes
        .or(defaults.client_max_body_size_bytes)
        && (!host.force_https || https_listener)
    {
        // Redirects do not consume the body; apply its limit only when forwarding.
        handle.push(Handler::RequestBody(RequestBody {
            max_size: u64::from(max_size),
        }));
    }
    if host.force_https && !https_listener {
        handle.push(Handler::StaticResponse(StaticResponse {
            body: None,
            status_code: Some(308),
            headers: Some(location_headers(force_https_location(public_https_port))),
        }));
    } else {
        let upstream = upstream_dial(&host.forward_host, host.forward_port);
        handle.push(Handler::ReverseProxy(Box::new(reverse_proxy(
            &upstream,
            Some(host),
            Some(defaults),
            upstream_tls,
        )?)));
    }
    Ok(Route {
        matchers: vec![Matcher::Host {
            host: host.domains.clone(),
        }],
        handle,
        terminal: true,
    })
}

fn redirect_route(host: &RedirectHost) -> Result<Route, RenderError> {
    Ok(Route {
        matchers: vec![Matcher::Host {
            host: host.domains.clone(),
        }],
        handle: vec![Handler::StaticResponse(StaticResponse {
            body: None,
            status_code: Some(host.status_code),
            headers: Some(location_headers(redirect_location(host))),
        })],
        terminal: true,
    })
}

fn not_found_route() -> Route {
    Route {
        matchers: Vec::new(),
        handle: vec![Handler::StaticResponse(StaticResponse {
            body: None,
            status_code: Some(404),
            headers: None,
        })],
        terminal: true,
    }
}

fn reverse_proxy(
    upstream: &str,
    host: Option<&ProxyHost>,
    defaults: Option<&ProxyHttpSettings>,
    ca_settings: Option<&UpstreamTlsRenderSettings>,
) -> Result<ReverseProxy, RenderError> {
    let mut set = BTreeMap::new();
    set.insert("Host".to_owned(), vec!["{http.request.host}".to_owned()]);
    set.insert(
        "X-Real-IP".to_owned(),
        vec!["{http.request.remote.host}".to_owned()],
    );
    let mut transport = HttpTransport {
        protocol: "http".to_owned(),
        dial_timeout: None,
        read_timeout: None,
        response_header_timeout: None,
        write_timeout: None,
        tls: None,
    };
    if let Some(host) = host {
        let settings = &host.http_settings;
        transport.dial_timeout = seconds(
            settings
                .proxy_connect_timeout_seconds
                .or_else(|| defaults.and_then(|v| v.proxy_connect_timeout_seconds)),
        );
        transport.read_timeout = seconds(
            settings
                .proxy_read_timeout_seconds
                .or_else(|| defaults.and_then(|v| v.proxy_read_timeout_seconds)),
        );
        transport.response_header_timeout = seconds(
            settings
                .proxy_read_timeout_seconds
                .or_else(|| defaults.and_then(|v| v.proxy_read_timeout_seconds)),
        );
        transport.write_timeout = seconds(
            settings
                .proxy_send_timeout_seconds
                .or_else(|| defaults.and_then(|v| v.proxy_send_timeout_seconds)),
        );
        if host.forward_scheme == "https" {
            let policy = Some(
                host.upstream_tls
                    .as_ref()
                    .ok_or(RenderError::MissingUpstreamTlsPolicy)?,
            );
            let server_name = policy.and_then(|p| p.server_name.clone()).or_else(|| {
                host.forward_host
                    .parse::<IpAddr>()
                    .ok()
                    .is_none()
                    .then(|| host.forward_host.clone())
            });
            let (ca, insecure) = match (policy, ca_settings) {
                (Some(policy), Some(settings)) if policy.verify => {
                    let path = match policy.trusted_ca_id.as_ref() {
                        Some(id) => settings
                            .trusted_ca_paths
                            .get(id)
                            .ok_or(RenderError::MissingTrustedCa)?,
                        None => &settings.system_ca_bundle,
                    };
                    (
                        Some(CaSource {
                            provider: "file".to_owned(),
                            pem_files: vec![certificate_path(path)?],
                        }),
                        None,
                    )
                }
                (Some(policy), None) if policy.verify => return Err(RenderError::MissingTrustedCa),
                (Some(_), _) => (None, Some(true)),
                _ => (None, None),
            };
            transport.tls = Some(UpstreamTls {
                ca,
                insecure_skip_verify: insecure,
                server_name,
            });
        }
    }
    Ok(ReverseProxy {
        upstreams: vec![Upstream {
            dial: upstream.to_owned(),
        }],
        headers: RequestHeaders {
            request: HeaderOps {
                set,
                // Caddy rebuilds X-Forwarded-{For,Host,Proto} from the actual peer by default.
                // Remove additional client assertions it intentionally forwards unchanged.
                delete: [
                    "Forwarded",
                    "X-Forwarded-Port",
                    "X-Forwarded-Prefix",
                    "Proxy",
                ]
                .into_iter()
                .map(str::to_owned)
                .collect(),
            },
        },
        transport,
        stream_close_delay: "5m".to_owned(),
    })
}

fn location_headers(value: String) -> BTreeMap<String, Vec<String>> {
    BTreeMap::from([(String::from("Location"), vec![value])])
}

fn upstream_dial(host: &str, port: u16) -> String {
    if host.parse::<std::net::Ipv6Addr>().is_ok() {
        format!("[{host}]:{port}")
    } else {
        format!("{host}:{port}")
    }
}

fn force_https_location(port: u16) -> String {
    if port == 443 {
        "https://{http.request.host}{http.request.uri}".to_owned()
    } else {
        format!("https://{{http.request.host}}:{port}{{http.request.uri}}")
    }
}

fn redirect_location(host: &RedirectHost) -> String {
    if host.preserve_request_uri {
        format!("{}{{http.request.uri}}", host.destination)
    } else {
        host.destination.clone()
    }
}

fn seconds(value: Option<u32>) -> Option<String> {
    value.map(|value| format!("{value}s"))
}

fn path_string(path: &Path, error: RenderError) -> Result<String, RenderError> {
    let value = path.to_str().ok_or(error)?.replace('\\', "/");
    if !path.is_absolute()
        || value.is_empty()
        || value
            .bytes()
            .any(|b| b.is_ascii_control() || matches!(b, b'|' | b'{' | b'}'))
    {
        return Err(error);
    }
    Ok(value)
}

fn admin_listen(path: Option<&Path>) -> Result<String, RenderError> {
    path.map(|path| {
        path_string(path, RenderError::InvalidProbeSocket).map(|value| format!("unix/{value}|0600"))
    })
    .transpose()?
    .map_or_else(|| Ok("127.0.0.1:2019".to_owned()), Ok)
}

fn probe_listen(path: &Path) -> Result<String, RenderError> {
    path_string(path, RenderError::InvalidProbeSocket).map(|value| format!("unix/{value}|0600"))
}

fn certificate_path(path: &Path) -> Result<String, RenderError> {
    path_string(path, RenderError::InvalidCertificatePath)
}

/// Read-only route fragments; server and certificate loading policy is in the full configuration.
#[derive(Serialize)]
struct HostSource {
    http: Route,
    #[serde(skip_serializing_if = "Option::is_none")]
    https: Option<Route>,
}

pub(crate) fn render_host_config_for_runtime(
    host: &ProxyHost,
    defaults: &ProxyHttpSettings,
    public_https_port: u16,
    upstream_tls: Option<&UpstreamTlsRenderSettings>,
) -> Result<String, RenderError> {
    let source = HostSource {
        http: host_route(host, public_https_port, upstream_tls, false, defaults)?,
        https: host
            .certificate_id
            .as_ref()
            .map(|_| host_route(host, public_https_port, upstream_tls, true, defaults))
            .transpose()?,
    };
    serde_json::to_string(&source).map_err(|_| RenderError::ConfigTooLarge)
}

pub(crate) fn render_host_sources_for_runtime(
    configuration: &ValidatedProxyConfig,
    public_https_port: u16,
    upstream_tls: Option<&UpstreamTlsRenderSettings>,
) -> Result<BTreeMap<String, String>, RenderError> {
    let mut sources = BTreeMap::new();
    for host in &configuration.proxy_hosts {
        let source = render_host_config_for_runtime(
            host,
            &configuration.http_settings,
            public_https_port,
            upstream_tls,
        )?;
        if source.len() > MAX_RENDERED_PROXY_HOST_SOURCE_BYTES {
            return Err(RenderError::ConfigTooLarge);
        }
        sources.insert(host.id.clone(), source);
    }
    Ok(sources)
}
