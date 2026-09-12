use std::{
    collections::{BTreeMap, BTreeSet},
    net::IpAddr,
    path::{Path, PathBuf},
};

use ipnet::{IpNet, Ipv6Net};
use serde::Serialize;

use crate::models::{
    AccessPolicy, AccessPolicyCombination, AccessPolicyMode, BasicAuth, IpDefaultAction, IpRules,
    ProxyHost, ProxyHttpSettings, RedirectHost, ValidatedProxyConfig,
};

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
    matchers: Vec<MatcherSet>,
    handle: Vec<Handler>,
    terminal: bool,
}

#[derive(Default, Serialize)]
struct MatcherSet {
    #[serde(skip_serializing_if = "Option::is_none")]
    host: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    remote_ip: Option<RemoteIpMatcher>,
    #[serde(skip_serializing_if = "Option::is_none")]
    not: Option<Vec<MatcherSet>>,
}

#[derive(Serialize)]
struct RemoteIpMatcher {
    ranges: Vec<String>,
}

impl MatcherSet {
    fn host(domains: &[String]) -> Self {
        Self {
            host: Some(domains.to_vec()),
            ..Self::default()
        }
    }

    fn path(paths: Vec<String>) -> Self {
        Self {
            path: Some(paths),
            ..Self::default()
        }
    }
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
    #[serde(rename = "authentication")]
    Authentication(Authentication),
}

#[derive(Serialize)]
struct Authentication {
    providers: BTreeMap<String, HttpBasicAuth>,
}

#[derive(Serialize)]
struct HttpBasicAuth {
    hash: BasicAuthHash,
    accounts: Vec<HttpBasicAuthAccount>,
    realm: String,
    hash_cache: HashCache,
}

#[derive(Serialize)]
struct BasicAuthHash {
    algorithm: String,
}

#[derive(Serialize)]
struct HttpBasicAuthAccount {
    username: String,
    password: String,
}

#[derive(Serialize)]
struct HashCache {}

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
                        matchers: vec![MatcherSet::path(vec![
                            "/__rentnerproxy_runtime_probe".to_owned(),
                        ])],
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
            https_routes.extend(host_routes(
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
        routes.extend(host_routes(
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
        matchers: vec![MatcherSet::path(vec![
            "/.well-known/acme-challenge/*".to_owned(),
        ])],
        handle: vec![Handler::ReverseProxy(Box::new(
            reverse_proxy(&format!("127.0.0.1:{controller_port}"), None, None, None)
                .expect("controller challenge proxy is always valid"),
        ))],
        terminal: true,
    }
}

fn host_routes(
    host: &ProxyHost,
    public_https_port: u16,
    upstream_tls: Option<&UpstreamTlsRenderSettings>,
    https_listener: bool,
    defaults: &ProxyHttpSettings,
) -> Result<Vec<Route>, RenderError> {
    let Some(policy) = host.access_policy.as_ref() else {
        if host.force_https && !https_listener {
            return Ok(vec![redirect_to_https_route(
                &host.domains,
                public_https_port,
            )]);
        }
        return Ok(vec![proxy_route(
            host,
            upstream_tls,
            defaults,
            MatcherSet::host(&host.domains),
            None,
        )?]);
    };

    let configured = match policy.mode {
        AccessPolicyMode::Public => true,
        AccessPolicyMode::Authenticated => policy.basic_auth.is_some(),
        AccessPolicyMode::IpRestricted => policy.ip_rules.is_some(),
        AccessPolicyMode::Combined => match policy.combination {
            Some(AccessPolicyCombination::All) => {
                policy.basic_auth.is_some() && policy.ip_rules.is_some()
            }
            Some(AccessPolicyCombination::Any) => {
                policy.basic_auth.is_some() || policy.ip_rules.is_some()
            }
            None => false,
        },
    };
    if policy.mode != AccessPolicyMode::Public && !configured {
        // A protected mode without an applicable provider is closed by default.
        return Ok(vec![denied_host_route(&host.domains)]);
    }
    if host.force_https && !https_listener {
        return Ok(vec![redirect_to_https_route(
            &host.domains,
            public_https_port,
        )]);
    }

    match policy.mode {
        AccessPolicyMode::Public => Ok(vec![proxy_route(
            host,
            upstream_tls,
            defaults,
            MatcherSet::host(&host.domains),
            None,
        )?]),
        AccessPolicyMode::Authenticated => Ok(vec![proxy_route(
            host,
            upstream_tls,
            defaults,
            MatcherSet::host(&host.domains),
            policy.basic_auth.as_ref(),
        )?]),
        AccessPolicyMode::IpRestricted => ip_only_routes(
            host,
            upstream_tls,
            defaults,
            policy.ip_rules.as_ref().expect("validated IP provider"),
        ),
        AccessPolicyMode::Combined => match policy.combination {
            Some(AccessPolicyCombination::All) => {
                combined_all_routes(host, upstream_tls, defaults, policy)
            }
            Some(AccessPolicyCombination::Any) => {
                combined_any_routes(host, upstream_tls, defaults, policy)
            }
            None => Ok(vec![denied_host_route(&host.domains)]),
        },
    }
}

fn denied_host_route(domains: &[String]) -> Route {
    Route {
        matchers: vec![MatcherSet::host(domains)],
        handle: vec![Handler::StaticResponse(StaticResponse {
            body: None,
            status_code: Some(403),
            headers: None,
        })],
        terminal: true,
    }
}

fn redirect_to_https_route(domains: &[String], public_https_port: u16) -> Route {
    Route {
        matchers: vec![MatcherSet::host(domains)],
        handle: vec![Handler::StaticResponse(StaticResponse {
            body: None,
            status_code: Some(308),
            headers: Some(location_headers(force_https_location(public_https_port))),
        })],
        terminal: true,
    }
}

fn proxy_route(
    host: &ProxyHost,
    upstream_tls: Option<&UpstreamTlsRenderSettings>,
    defaults: &ProxyHttpSettings,
    matcher: MatcherSet,
    basic_auth: Option<&BasicAuth>,
) -> Result<Route, RenderError> {
    let mut handle = Vec::new();
    if let Some(auth) = basic_auth {
        handle.push(Handler::Authentication(authentication_handler(auth)));
    }
    if let Some(max_size) = host
        .http_settings
        .client_max_body_size_bytes
        .or(defaults.client_max_body_size_bytes)
    {
        // Authentication does not consume the body; apply its limit only when forwarding.
        handle.push(Handler::RequestBody(RequestBody {
            max_size: u64::from(max_size),
        }));
    }
    let upstream = upstream_dial(&host.forward_host, host.forward_port);
    let mut proxy = reverse_proxy(&upstream, Some(host), Some(defaults), upstream_tls)?;
    if basic_auth.is_some()
        || host.access_policy.as_ref().is_some_and(|policy| {
            policy.mode == AccessPolicyMode::Combined && policy.basic_auth.is_some()
        })
    {
        // Browsers may send cached policy credentials even when the IP method already allows access.
        // Authentication policies own this header on both the IP and authentication paths.
        proxy
            .headers
            .request
            .delete
            .push("Authorization".to_owned());
    }
    handle.push(Handler::ReverseProxy(Box::new(proxy)));
    Ok(Route {
        matchers: vec![matcher],
        handle,
        terminal: true,
    })
}

fn static_route(matcher: MatcherSet, status_code: u16) -> Route {
    Route {
        matchers: vec![matcher],
        handle: vec![Handler::StaticResponse(StaticResponse {
            body: None,
            status_code: Some(status_code),
            headers: None,
        })],
        terminal: true,
    }
}

fn ip_only_routes(
    host: &ProxyHost,
    upstream_tls: Option<&UpstreamTlsRenderSettings>,
    defaults: &ProxyHttpSettings,
    rules: &IpRules,
) -> Result<Vec<Route>, RenderError> {
    let mut routes = Vec::new();
    if !rules.deny.is_empty() {
        routes.push(static_route(ip_matcher(&host.domains, &rules.deny), 403));
    }
    if let Some(matcher) = ip_allowed_matcher(&host.domains, rules) {
        routes.push(proxy_route(host, upstream_tls, defaults, matcher, None)?);
    }
    routes.push(denied_host_route(&host.domains));
    Ok(routes)
}

fn combined_all_routes(
    host: &ProxyHost,
    upstream_tls: Option<&UpstreamTlsRenderSettings>,
    defaults: &ProxyHttpSettings,
    policy: &AccessPolicy,
) -> Result<Vec<Route>, RenderError> {
    let Some(rules) = policy.ip_rules.as_ref() else {
        return Ok(vec![denied_host_route(&host.domains)]);
    };
    let Some(auth) = policy.basic_auth.as_ref() else {
        return Ok(vec![denied_host_route(&host.domains)]);
    };
    let mut routes = Vec::new();
    if let Some(matcher) = ip_allowed_matcher(&host.domains, rules) {
        routes.push(proxy_route(
            host,
            upstream_tls,
            defaults,
            matcher,
            Some(auth),
        )?);
    }
    routes.push(denied_host_route(&host.domains));
    Ok(routes)
}

fn combined_any_routes(
    host: &ProxyHost,
    upstream_tls: Option<&UpstreamTlsRenderSettings>,
    defaults: &ProxyHttpSettings,
    policy: &AccessPolicy,
) -> Result<Vec<Route>, RenderError> {
    let mut routes = Vec::new();
    if let Some(rules) = policy.ip_rules.as_ref()
        && let Some(matcher) = ip_allowed_matcher(&host.domains, rules)
    {
        routes.push(proxy_route(host, upstream_tls, defaults, matcher, None)?);
    }
    if let Some(auth) = policy.basic_auth.as_ref() {
        routes.push(proxy_route(
            host,
            upstream_tls,
            defaults,
            MatcherSet::host(&host.domains),
            Some(auth),
        )?);
    } else {
        routes.push(denied_host_route(&host.domains));
    }
    Ok(routes)
}

const MAPPED_IPV4_RANGE: &str = "::ffff:0:0/96";

fn ip_allowed_matcher(domains: &[String], rules: &IpRules) -> Option<MatcherSet> {
    match rules.default_action {
        IpDefaultAction::Allow => {
            let mut matcher = MatcherSet::host(domains);
            if !rules.deny.is_empty() {
                append_not(&mut matcher, ip_matcher(&[], &rules.deny));
            }
            Some(matcher)
        }
        IpDefaultAction::Deny => {
            if rules.allow.is_empty() {
                return None;
            }
            let mut matcher = ip_matcher(domains, &rules.allow);
            if !rules.deny.is_empty() {
                append_not(&mut matcher, ip_matcher(&[], &rules.deny));
            }
            Some(matcher)
        }
    }
}

fn ip_matcher(domains: &[String], ranges: &[String]) -> MatcherSet {
    let mut matcher = MatcherSet {
        host: (!domains.is_empty()).then(|| domains.to_vec()),
        remote_ip: Some(RemoteIpMatcher {
            ranges: rendered_ranges(ranges),
        }),
        ..MatcherSet::default()
    };
    if ranges
        .iter()
        .any(|range| matches!(range.parse::<IpNet>(), Ok(IpNet::V6(_))))
    {
        let mapped_ipv4_ranges = ranges
            .iter()
            .filter_map(|range| range.parse::<IpNet>().ok())
            .filter_map(|net| match net {
                IpNet::V4(net) => Some(
                    Ipv6Net::new(net.network().to_ipv6_mapped(), 96 + net.prefix_len())
                        .expect("mapped IPv4 CIDR is always valid")
                        .to_string(),
                ),
                IpNet::V6(_) => None,
            })
            .collect();
        append_not(&mut matcher, mapped_ipv4_exclusion(mapped_ipv4_ranges));
    }
    matcher
}

fn append_not(matcher: &mut MatcherSet, excluded: MatcherSet) {
    matcher.not.get_or_insert_with(Vec::new).push(excluded);
}

fn mapped_ipv4_exclusion(mapped_ipv4_ranges: Vec<String>) -> MatcherSet {
    let mut matcher = MatcherSet {
        remote_ip: Some(RemoteIpMatcher {
            ranges: vec![MAPPED_IPV4_RANGE.to_owned()],
        }),
        ..MatcherSet::default()
    };
    if !mapped_ipv4_ranges.is_empty() {
        let allowed = MatcherSet {
            remote_ip: Some(RemoteIpMatcher {
                ranges: mapped_ipv4_ranges,
            }),
            ..MatcherSet::default()
        };
        // Exclude mapped peers except those explicitly covered by an IPv4 rule.
        append_not(&mut matcher, allowed);
    }
    matcher
}

fn rendered_ranges(ranges: &[String]) -> Vec<String> {
    let mut rendered = Vec::with_capacity(ranges.len() * 2);
    for range in ranges {
        rendered.push(range.clone());
        if let Ok(IpNet::V4(net)) = range.parse::<IpNet>() {
            let mapped = Ipv6Net::new(net.network().to_ipv6_mapped(), 96 + net.prefix_len())
                .expect("mapped IPv4 CIDR is always valid");
            rendered.push(IpNet::V6(mapped).to_string());
        }
    }
    rendered
}

fn authentication_handler(auth: &BasicAuth) -> Authentication {
    Authentication {
        providers: BTreeMap::from([(
            "http_basic".to_owned(),
            HttpBasicAuth {
                hash: BasicAuthHash {
                    algorithm: "argon2id".to_owned(),
                },
                accounts: auth
                    .accounts
                    .iter()
                    .map(|account| HttpBasicAuthAccount {
                        username: account.username.clone(),
                        password: account.password_hash.clone(),
                    })
                    .collect(),
                realm: "RentnerProxy".to_owned(),
                hash_cache: HashCache {},
            },
        )]),
    }
}

fn redirect_route(host: &RedirectHost) -> Result<Route, RenderError> {
    Ok(Route {
        matchers: vec![MatcherSet::host(&host.domains)],
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
    http: HostSourceRoutes,
    #[serde(skip_serializing_if = "Option::is_none")]
    https: Option<HostSourceRoutes>,
}

#[derive(Serialize)]
#[serde(untagged)]
enum HostSourceRoutes {
    Single(Route),
    Group { routes: Vec<Route> },
}

impl HostSourceRoutes {
    fn from_routes(routes: Vec<Route>) -> Self {
        if routes.len() == 1 {
            Self::Single(routes.into_iter().next().expect("one route"))
        } else {
            Self::Group { routes }
        }
    }
}

pub(crate) fn render_host_config_for_runtime(
    host: &ProxyHost,
    defaults: &ProxyHttpSettings,
    public_https_port: u16,
    upstream_tls: Option<&UpstreamTlsRenderSettings>,
) -> Result<String, RenderError> {
    let source = HostSource {
        http: HostSourceRoutes::from_routes(host_routes(
            host,
            public_https_port,
            upstream_tls,
            false,
            defaults,
        )?),
        https: host
            .certificate_id
            .as_ref()
            .map(|_| {
                host_routes(host, public_https_port, upstream_tls, true, defaults)
                    .map(HostSourceRoutes::from_routes)
            })
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
