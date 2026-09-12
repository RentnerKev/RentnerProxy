use std::collections::BTreeMap;

use ipnet::{IpNet, Ipv6Net};

use crate::models::{
    AccessPolicy, AccessPolicyMode, BasicAuth, IpDefaultAction, IpRules, ProxyHost,
    ProxyHttpSettings,
};

use super::{
    RenderError, UpstreamTlsRenderSettings,
    model::{
        Authentication, BasicAuthHash, Handler, HashCache, HttpBasicAuth, HttpBasicAuthAccount,
        LogAppend, MatcherSet, RemoteIpMatcher, RequestBody, Route, StaticResponse,
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
    forwarded_proto: &str,
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
