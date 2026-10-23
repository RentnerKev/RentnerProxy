use super::model::{Handler, Headers, MatcherSet, Route};
use crate::models::{AccessPolicyMode, ProxyHost};
use std::collections::BTreeMap;

// Fill absent policy only after inspecting the complete upstream response.
// Access-controlled hosts bypass this feature before any authentication rewrites.
pub(super) fn handlers(host: &ProxyHost) -> Vec<Handler> {
    let mut handle = Vec::new();
    if host
        .access_policy
        .as_ref()
        .is_none_or(|policy| policy.mode == AccessPolicyMode::Public)
        && let Some(cache) = host
            .http_settings
            .browser_cache
            .as_ref()
            .filter(|cache| cache.enabled)
    {
        let routes = cache
            .rules
            .iter()
            .map(|rule| {
                let request_headers = [
                    "Cookie",
                    "Remote-User",
                    "Remote-Email",
                    "Remote-Name",
                    "Remote-Groups",
                    "X-Auth-Request-User",
                    "X-Auth-Request-Email",
                    "X-Auth-Request-Groups",
                    "X-Auth-Request-Preferred-Username",
                    "X-Forwarded-User",
                    "X-Forwarded-Email",
                    "X-User",
                    "X-Email",
                    "X-Authentik-Username",
                    "X-Authentik-Email",
                    "X-Authentik-Name",
                    "X-Authentik-Groups",
                    "X-Authentik-Uid",
                    "Authorization",
                    "Proxy-Authorization",
                    "Range",
                    "If-Range",
                    "If-Match",
                    "If-None-Match",
                    "If-Modified-Since",
                    "If-Unmodified-Since",
                    "Cache-Control",
                    "Pragma",
                ]
                .into_iter()
                .map(|name| (name.to_owned(), None))
                .collect();
                let mut response_headers: BTreeMap<String, Option<Vec<String>>> = [
                    "Cache-Control",
                    "Set-Cookie",
                    "Pragma",
                    "Expires",
                    "Vary",
                    "Content-Range",
                ]
                .into_iter()
                .map(|name| (name.to_owned(), None))
                .collect();
                response_headers.insert(
                    "Content-Type".to_owned(),
                    Some(
                        [
                            "text/css",
                            "text/javascript",
                            "application/javascript",
                            "application/x-javascript",
                            "image/png",
                            "image/jpeg",
                            "image/gif",
                            "image/webp",
                            "image/avif",
                            "image/svg+xml",
                            "image/x-icon",
                            "image/vnd.microsoft.icon",
                            "font/woff",
                            "font/woff2",
                            "font/ttf",
                            "font/otf",
                        ]
                        .into_iter()
                        .flat_map(|mime| [mime.to_owned(), format!("{mime};*")])
                        .collect(),
                    ),
                );
                Route {
                    matchers: vec![MatcherSet {
                        path: Some(vec![if rule.path.ends_with('/') {
                            format!("{}*", rule.path)
                        } else {
                            rule.path.clone()
                        }]),
                        method: Some(vec!["GET".to_owned(), "HEAD".to_owned()]),
                        expression: Some("{http.request.uri.query} == ''".to_owned()),
                        header: Some(request_headers),
                        ..MatcherSet::default()
                    }],
                    handle: vec![Handler::Headers(Headers {
                        request: None,
                        response: Some(super::model::ResponseHeaders {
                            set: BTreeMap::from([(
                                "Cache-Control".to_owned(),
                                vec![format!(
                                    "public, max-age={}{}",
                                    rule.max_age_seconds,
                                    if rule.immutable { ", immutable" } else { "" }
                                )],
                            )]),
                            deferred: true,
                            matcher: Some(super::model::ResponseHeaderMatcher {
                                status_code: vec![200],
                                headers: response_headers,
                            }),
                        }),
                    })],
                    terminal: false,
                }
            })
            .collect();
        handle.push(Handler::Subroute(super::model::Subroute { routes }));
    }
    handle
}
