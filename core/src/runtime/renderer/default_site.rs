use std::{collections::BTreeMap, sync::LazyLock};

use base64::{Engine, engine::general_purpose::STANDARD};

use crate::models::DefaultSite;

use super::{
    model::{AbortResponse, Handler, Route, StaticResponse},
    routes::not_found_route,
};

const WELCOME_HTML: &str = include_str!("welcome.html");
const HTML_CSP: &str = "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src http: https: data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const WELCOME_CSP: &str = "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

static WELCOME_PAGE: LazyLock<String> = LazyLock::new(|| {
    // The fallback can be served on any hostname, without the application's asset routes.
    WELCOME_HTML
        .replace(
            "__WELCOME_LOGO__",
            &STANDARD.encode(include_bytes!("welcome-assets/logo.webp")),
        )
        .replace(
            "__WELCOME_ILLUSTRATION__",
            &STANDARD.encode(include_bytes!("welcome-assets/end-of-the-road.webp")),
        )
        .replace(
            "__WELCOME_FONT__",
            &STANDARD.encode(include_bytes!(
                "welcome-assets/lilita-one-latin-400-normal.woff2"
            )),
        )
        .replace(
            "__WELCOME_FONT_LICENSE__",
            include_str!("welcome-assets/LILITA-ONE-LICENSE.txt"),
        )
});

pub(super) fn default_site_route(site: &DefaultSite) -> Route {
    let response = match site {
        DefaultSite::NotFound => return not_found_route(),
        DefaultSite::Close => Handler::AbortResponse(AbortResponse { abort: true }),
        DefaultSite::Redirect { url } => Handler::StaticResponse(StaticResponse {
            body: None,
            status_code: Some(302),
            headers: Some(BTreeMap::from([
                ("Location".to_owned(), vec![url.clone()]),
                ("Cache-Control".to_owned(), vec!["no-store".to_owned()]),
            ])),
        }),
        DefaultSite::Welcome => html_response(&WELCOME_PAGE, WELCOME_CSP),
        DefaultSite::CustomHtml { html } => html_response(html, HTML_CSP),
    };
    Route {
        matchers: Vec::new(),
        handle: vec![response],
        terminal: true,
    }
}

fn html_response(html: &str, content_security_policy: &str) -> Handler {
    Handler::StaticResponse(StaticResponse {
        body: Some(html.replace('{', "\\{").replace('}', "\\}")),
        status_code: Some(200),
        headers: Some(BTreeMap::from([
            (
                "Content-Type".to_owned(),
                vec!["text/html; charset=utf-8".to_owned()],
            ),
            ("Cache-Control".to_owned(), vec!["no-store".to_owned()]),
            (
                "X-Content-Type-Options".to_owned(),
                vec!["nosniff".to_owned()],
            ),
            ("Referrer-Policy".to_owned(), vec!["no-referrer".to_owned()]),
            (
                "Content-Security-Policy".to_owned(),
                vec![content_security_policy.to_owned()],
            ),
        ])),
    })
}
