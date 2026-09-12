use std::collections::BTreeMap;

use serde::Serialize;

use crate::models::{
    AccessPolicyCombination, AccessPolicyMode, ProxyHost, ProxyHttpSettings, RedirectHost,
    ValidatedProxyConfig,
};

use super::{
    MAX_RENDERED_PROXY_HOST_SOURCE_BYTES, RenderError, RenderSettings, UpstreamTlsRenderSettings,
    model::{Handler, MatcherSet, RemoteIpMatcher, Route, StaticResponse, Subroute},
    policy::{
        combined_all_routes, combined_any_routes, denied_host_route, ip_only_routes, proxy_route,
    },
    proxy::{
        force_https_headers, force_https_location, location_headers, redirect_location,
        rendered_ranges, reverse_proxy,
    },
};

pub(super) fn http_routes(
    config: &ValidatedProxyConfig,
    settings: &RenderSettings,
    public_https_port: u16,
    upstream_tls: Option<&UpstreamTlsRenderSettings>,
) -> Result<Vec<Route>, RenderError> {
    let mut routes = vec![challenge_route(settings.controller_port, "http")];
    for host in &config.proxy_hosts {
        routes.extend(host_routes(
            host,
            public_https_port,
            upstream_tls,
            false,
            &config.http_settings,
            &settings.trusted_proxy_cidrs,
        )?);
    }
    for host in &config.redirect_hosts {
        routes.push(redirect_route(host)?);
    }
    routes.push(not_found_route());
    Ok(routes)
}

pub(super) fn challenge_route(controller_port: u16, forwarded_proto: &str) -> Route {
    Route {
        matchers: vec![MatcherSet::path(vec![
            "/.well-known/acme-challenge/*".to_owned(),
        ])],
        handle: vec![Handler::ReverseProxy(Box::new(
            reverse_proxy(
                &format!("127.0.0.1:{controller_port}"),
                None,
                None,
                None,
                forwarded_proto,
            )
            .expect("controller challenge proxy is always valid"),
        ))],
        terminal: true,
    }
}

pub(super) fn host_routes(
    host: &ProxyHost,
    public_https_port: u16,
    upstream_tls: Option<&UpstreamTlsRenderSettings>,
    https_listener: bool,
    defaults: &ProxyHttpSettings,
    trusted_proxy_cidrs: &[String],
) -> Result<Vec<Route>, RenderError> {
    if !https_listener && !trusted_proxy_cidrs.is_empty() {
        let trusted_routes = host_routes_for_listener(
            host,
            public_https_port,
            upstream_tls,
            true,
            defaults,
            "https",
        )?;
        let trusted_route = Route {
            matchers: vec![trusted_forwarded_matcher(
                &host.domains,
                trusted_proxy_cidrs,
            )],
            handle: vec![Handler::Subroute(Subroute {
                routes: trusted_routes,
            })],
            terminal: true,
        };
        if host.force_https {
            return Ok(vec![
                trusted_route,
                redirect_to_https_route(&host.domains, public_https_port),
            ]);
        }
        let mut routes = vec![trusted_route];
        routes.extend(host_routes_for_listener(
            host,
            public_https_port,
            upstream_tls,
            false,
            defaults,
            "http",
        )?);
        return Ok(routes);
    }

    host_routes_for_listener(
        host,
        public_https_port,
        upstream_tls,
        https_listener,
        defaults,
        if https_listener { "https" } else { "http" },
    )
}

fn host_routes_for_listener(
    host: &ProxyHost,
    public_https_port: u16,
    upstream_tls: Option<&UpstreamTlsRenderSettings>,
    https_listener: bool,
    defaults: &ProxyHttpSettings,
    forwarded_proto: &str,
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
            forwarded_proto,
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
        return Ok(vec![denied_host_route(&host.domains)]);
    }
    if host.force_https && !https_listener {
        return Ok(vec![redirect_to_https_route(
            &host.domains,
            public_https_port,
        )]);
    }
    let routes = match policy.mode {
        AccessPolicyMode::Public => Ok(vec![proxy_route(
            host,
            upstream_tls,
            defaults,
            MatcherSet::host(&host.domains),
            None,
            forwarded_proto,
        )?]),
        AccessPolicyMode::Authenticated => Ok(vec![proxy_route(
            host,
            upstream_tls,
            defaults,
            MatcherSet::host(&host.domains),
            policy.basic_auth.as_ref(),
            forwarded_proto,
        )?]),
        AccessPolicyMode::IpRestricted => ip_only_routes(
            host,
            upstream_tls,
            defaults,
            policy.ip_rules.as_ref().expect("validated IP provider"),
            forwarded_proto,
        ),
        AccessPolicyMode::Combined => match policy.combination {
            Some(AccessPolicyCombination::All) => {
                combined_all_routes(host, upstream_tls, defaults, policy, forwarded_proto)
            }
            Some(AccessPolicyCombination::Any) => {
                combined_any_routes(host, upstream_tls, defaults, policy, forwarded_proto)
            }
            None => Ok(vec![denied_host_route(&host.domains)]),
        },
    }?;
    Ok(routes)
}

fn redirect_to_https_route(domains: &[String], public_https_port: u16) -> Route {
    Route {
        matchers: vec![MatcherSet::host(domains)],
        handle: vec![Handler::StaticResponse(StaticResponse {
            body: None,
            status_code: Some(308),
            headers: Some(force_https_headers(force_https_location(public_https_port))),
        })],
        terminal: true,
    }
}

fn trusted_forwarded_matcher(domains: &[String], trusted_proxy_cidrs: &[String]) -> MatcherSet {
    MatcherSet {
        host: Some(domains.to_vec()),
        remote_ip: Some(RemoteIpMatcher {
            ranges: rendered_ranges(trusted_proxy_cidrs),
        }),
        vars: Some(BTreeMap::from([(
            "{http.request.header.X-Forwarded-Proto}".to_owned(),
            vec!["https".to_owned()],
        )])),
        ..MatcherSet::default()
    }
}

pub(super) fn redirect_route(host: &RedirectHost) -> Result<Route, RenderError> {
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

pub(super) fn not_found_route() -> Route {
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

pub(super) fn render_host_config_for_runtime(
    host: &ProxyHost,
    defaults: &ProxyHttpSettings,
    public_https_port: u16,
    upstream_tls: Option<&UpstreamTlsRenderSettings>,
    trusted_proxy_cidrs: &[String],
) -> Result<String, RenderError> {
    let source = HostSource {
        http: HostSourceRoutes::from_routes(host_routes(
            host,
            public_https_port,
            upstream_tls,
            false,
            defaults,
            trusted_proxy_cidrs,
        )?),
        https: host
            .certificate_id
            .as_ref()
            .map(|_| {
                host_routes(
                    host,
                    public_https_port,
                    upstream_tls,
                    true,
                    defaults,
                    trusted_proxy_cidrs,
                )
                .map(HostSourceRoutes::from_routes)
            })
            .transpose()?,
    };
    serde_json::to_string(&source).map_err(|_| RenderError::ConfigTooLarge)
}

pub(super) fn render_host_sources_for_runtime(
    configuration: &ValidatedProxyConfig,
    public_https_port: u16,
    upstream_tls: Option<&UpstreamTlsRenderSettings>,
    trusted_proxy_cidrs: &[String],
) -> Result<BTreeMap<String, String>, RenderError> {
    let mut sources = BTreeMap::new();
    for host in &configuration.proxy_hosts {
        let source = render_host_config_for_runtime(
            host,
            &configuration.http_settings,
            public_https_port,
            upstream_tls,
            trusted_proxy_cidrs,
        )?;
        if source.len() > MAX_RENDERED_PROXY_HOST_SOURCE_BYTES {
            return Err(RenderError::ConfigTooLarge);
        }
        sources.insert(host.id.clone(), source);
    }
    Ok(sources)
}
