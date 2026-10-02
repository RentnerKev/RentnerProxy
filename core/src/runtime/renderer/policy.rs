use std::collections::BTreeMap;

use ipnet::{IpNet, Ipv6Net};

use crate::models::{
    AccessPolicy, AccessPolicyMode, BasicAuth, ForwardAuth, IpDefaultAction, IpRules, ProxyHost,
    ProxyHttpSettings,
};
use crate::proxy::parse_forward_auth_endpoint;

use super::{
    RenderError, UpstreamTlsRenderSettings,
    model::{
        Authentication, BasicAuthHash, EmptyVars, Handler, HashCache, HeaderOps, Headers,
        HttpBasicAuth, HttpBasicAuthAccount, LogAppend, MatcherSet, ProxyResponseHandler,
        ProxyResponseMatcher, ProxyRewrite, RemoteIpMatcher, RequestBody, Route, StaticResponse,
        UpstreamTls,
    },
    proxy::{rendered_ranges, reverse_proxy, upstream_dial},
};

pub(super) fn denied_host_route(domains: &[String]) -> Route {
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
pub(super) fn proxy_route(
    host: &ProxyHost,
    upstream_tls: Option<&UpstreamTlsRenderSettings>,
    defaults: &ProxyHttpSettings,
    matcher: MatcherSet,
    basic_auth: Option<&BasicAuth>,
    forward_auth: Option<&ForwardAuth>,
    forwarded_proto: &str,
) -> Result<Route, RenderError> {
    let mut handle = Vec::new();
    if let Some(auth) = basic_auth {
        handle.push(Handler::Authentication(authentication_handler(auth)));
    }
    if let Some(auth) = forward_auth {
        handle.push(Handler::Headers(Headers {
            request: Some(HeaderOps {
                set: BTreeMap::new(),
                delete: identity_headers_to_strip(auth),
            }),
            response: None,
        }));
        handle.push(Handler::ReverseProxy(Box::new(forward_auth_proxy(
            auth,
            forwarded_proto,
        )?)));
    }
    if let Some(max_size) = host
        .http_settings
        .client_max_body_size_bytes
        .or(defaults.client_max_body_size_bytes)
    {
        handle.push(Handler::RequestBody(RequestBody {
            max_size: u64::from(max_size),
        }));
    }
    let upstream = upstream_dial(&host.forward_host, host.forward_port);
    let mut proxy = reverse_proxy(
        &upstream,
        Some(host),
        Some(defaults),
        upstream_tls,
        forwarded_proto,
    )?;
    if basic_auth.is_some()
        || forward_auth.is_some()
        || host.access_policy.as_ref().is_some_and(|policy| {
            policy.mode == AccessPolicyMode::Combined && policy.basic_auth.is_some()
        })
    {
        proxy
            .headers
            .request
            .delete
            .push("Authorization".to_owned());
    }
    handle.push(Handler::LogAppend(LogAppend {
        key: "upstream".to_owned(),
        value: "{http.reverse_proxy.upstream.address}".to_owned(),
    }));
    handle.push(Handler::ReverseProxy(Box::new(proxy)));
    Ok(Route {
        matchers: vec![matcher],
        handle,
        terminal: true,
    })
}

pub(super) fn gateway_route(
    host: &ProxyHost,
    auth: &ForwardAuth,
    forwarded_proto: &str,
) -> Result<Option<Route>, RenderError> {
    let Some(prefix) = auth.gateway_path_prefix.as_ref() else {
        return Ok(None);
    };
    let endpoint = parse_forward_auth_endpoint(&auth.endpoint)
        .ok_or(RenderError::InvalidForwardAuthEndpoint)?;
    let mut proxy = reverse_proxy(&endpoint.dial, None, None, None, forwarded_proto)?;
    if endpoint.https {
        proxy
            .headers
            .request
            .set
            .insert("Host".to_owned(), vec![endpoint.host.to_owned()]);
    }
    proxy.headers.request.set.insert(
        "X-Forwarded-For".to_owned(),
        vec!["{http.vars.client_ip}".to_owned()],
    );
    proxy.headers.request.set.insert(
        "X-Forwarded-Host".to_owned(),
        vec!["{http.request.host}".to_owned()],
    );
    proxy.headers.request.set.insert(
        "X-Real-IP".to_owned(),
        vec!["{http.vars.client_ip}".to_owned()],
    );
    proxy
        .headers
        .request
        .delete
        .extend(identity_headers_to_strip(auth));
    proxy.transport.tls = endpoint.https.then(|| UpstreamTls {
        ca: None,
        insecure_skip_verify: None,
        server_name: Some(endpoint.host.to_owned()),
    });
    proxy.transport.dial_timeout = Some(format!("{}s", auth.timeout_seconds));
    proxy.transport.response_header_timeout = Some(format!("{}s", auth.timeout_seconds));
    proxy.transport.read_timeout = Some(format!("{}s", auth.timeout_seconds));
    Ok(Some(Route {
        matchers: vec![MatcherSet {
            host: Some(host.domains.clone()),
            path: Some(vec![format!("{}*", prefix)]),
            ..MatcherSet::default()
        }],
        handle: vec![Handler::ReverseProxy(Box::new(proxy))],
        terminal: true,
    }))
}

fn identity_headers_to_strip(auth: &ForwardAuth) -> Vec<String> {
    let mut headers = vec![
        "Remote-*".to_owned(),
        "X-Authentik-*".to_owned(),
        "X-Auth-Request-*".to_owned(),
        "X-Forwarded-User".to_owned(),
        "X-Forwarded-Email".to_owned(),
        "X-User".to_owned(),
        "X-Email".to_owned(),
    ];
    headers.extend(auth.response_headers.iter().cloned());
    headers
}

fn forward_auth_proxy(
    auth: &ForwardAuth,
    forwarded_proto: &str,
) -> Result<super::model::ReverseProxy, RenderError> {
    let endpoint = parse_forward_auth_endpoint(&auth.endpoint)
        .ok_or(RenderError::InvalidForwardAuthEndpoint)?;
    let mut proxy = reverse_proxy(&endpoint.dial, None, None, None, forwarded_proto)?;
    let mut set = BTreeMap::from([
        (
            "Host".to_owned(),
            vec![if endpoint.https {
                endpoint.host.to_owned()
            } else {
                "{http.request.host}".to_owned()
            }],
        ),
        (
            "X-Forwarded-For".to_owned(),
            vec!["{http.vars.client_ip}".to_owned()],
        ),
        (
            "X-Real-IP".to_owned(),
            vec!["{http.vars.client_ip}".to_owned()],
        ),
        (
            "X-Forwarded-Host".to_owned(),
            vec!["{http.request.host}".to_owned()],
        ),
        (
            "X-Forwarded-Proto".to_owned(),
            vec![forwarded_proto.to_owned()],
        ),
        (
            "X-Forwarded-Method".to_owned(),
            vec!["{http.request.method}".to_owned()],
        ),
        (
            "X-Forwarded-Uri".to_owned(),
            vec!["{http.request.uri}".to_owned()],
        ),
    ]);
    for header in &auth.request_headers {
        set.insert(
            header.clone(),
            vec![format!("{{http.request.header.{header}}}")],
        );
    }
    proxy.headers.request = HeaderOps {
        set,
        delete: vec!["*".to_owned()],
    };
    proxy.transport.tls = endpoint.https.then(|| UpstreamTls {
        ca: None,
        insecure_skip_verify: None,
        server_name: Some(endpoint.host.to_owned()),
    });
    let timeout = format!("{}s", auth.timeout_seconds);
    proxy.transport.dial_timeout = Some(timeout.clone());
    proxy.transport.response_header_timeout = Some(timeout.clone());
    proxy.transport.read_timeout = Some(timeout.clone());
    proxy.transport.write_timeout = Some(timeout);
    proxy.rewrite = Some(ProxyRewrite {
        method: "GET".to_owned(),
        uri: format!("{}?", endpoint.path),
    });
    let mut response_routes = Vec::new();
    for header in &auth.response_headers {
        let placeholder = format!("{{http.reverse_proxy.header.{header}}}");
        response_routes.push(Route {
            matchers: Vec::new(),
            handle: vec![Handler::Headers(Headers {
                request: Some(HeaderOps {
                    set: BTreeMap::new(),
                    delete: vec![header.clone()],
                }),
                response: None,
            })],
            terminal: false,
        });
        response_routes.push(Route {
            matchers: vec![MatcherSet {
                not: Some(vec![MatcherSet {
                    vars: Some(BTreeMap::from([(placeholder.clone(), vec![String::new()])])),
                    ..MatcherSet::default()
                }]),
                ..MatcherSet::default()
            }],
            handle: vec![Handler::Headers(Headers {
                request: Some(HeaderOps {
                    set: BTreeMap::from([(header.clone(), vec![placeholder])]),
                    delete: Vec::new(),
                }),
                response: None,
            })],
            terminal: false,
        });
    }
    if response_routes.is_empty() {
        response_routes.push(Route {
            matchers: Vec::new(),
            handle: vec![Handler::Vars(EmptyVars {})],
            terminal: false,
        });
    }
    proxy.handle_response = vec![ProxyResponseHandler {
        matcher: ProxyResponseMatcher {
            status_code: vec![2],
        },
        routes: response_routes,
    }];
    Ok(proxy)
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

pub(super) fn ip_only_routes(
    host: &ProxyHost,
    upstream_tls: Option<&UpstreamTlsRenderSettings>,
    defaults: &ProxyHttpSettings,
    rules: &IpRules,
    forwarded_proto: &str,
) -> Result<Vec<Route>, RenderError> {
    let mut routes = Vec::new();
    if !rules.deny.is_empty() {
        routes.push(static_route(ip_matcher(&host.domains, &rules.deny), 403));
    }
    if let Some(matcher) = ip_allowed_matcher(&host.domains, rules) {
        routes.push(proxy_route(
            host,
            upstream_tls,
            defaults,
            matcher,
            None,
            None,
            forwarded_proto,
        )?);
    }
    routes.push(denied_host_route(&host.domains));
    Ok(routes)
}

pub(super) fn combined_all_routes(
    host: &ProxyHost,
    upstream_tls: Option<&UpstreamTlsRenderSettings>,
    defaults: &ProxyHttpSettings,
    policy: &AccessPolicy,
    forwarded_proto: &str,
) -> Result<Vec<Route>, RenderError> {
    let Some(rules) = policy.ip_rules.as_ref() else {
        return Ok(vec![denied_host_route(&host.domains)]);
    };
    if policy.basic_auth.is_none() && policy.forward_auth.is_none() {
        return Ok(vec![denied_host_route(&host.domains)]);
    }
    let mut routes = Vec::new();
    if let Some(matcher) = ip_allowed_matcher(&host.domains, rules) {
        routes.push(proxy_route(
            host,
            upstream_tls,
            defaults,
            matcher,
            policy.basic_auth.as_ref(),
            policy.forward_auth.as_ref(),
            forwarded_proto,
        )?);
    }
    routes.push(denied_host_route(&host.domains));
    Ok(routes)
}

pub(super) fn combined_any_routes(
    host: &ProxyHost,
    upstream_tls: Option<&UpstreamTlsRenderSettings>,
    defaults: &ProxyHttpSettings,
    policy: &AccessPolicy,
    forwarded_proto: &str,
) -> Result<Vec<Route>, RenderError> {
    let mut routes = Vec::new();
    if let Some(rules) = policy.ip_rules.as_ref()
        && let Some(matcher) = ip_allowed_matcher(&host.domains, rules)
    {
        routes.push(proxy_route(
            host,
            upstream_tls,
            defaults,
            matcher,
            None,
            None,
            forwarded_proto,
        )?);
    }
    if let Some(auth) = policy.basic_auth.as_ref() {
        routes.push(proxy_route(
            host,
            upstream_tls,
            defaults,
            MatcherSet::host(&host.domains),
            Some(auth),
            None,
            forwarded_proto,
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

        append_not(&mut matcher, allowed);
    }
    matcher
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
