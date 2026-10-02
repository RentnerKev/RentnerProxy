use std::collections::BTreeMap;

use crate::models::DefaultSite;

use super::{
    model::{AbortResponse, Handler, Route, StaticResponse},
    routes::not_found_route,
};

const WELCOME_HTML: &str = r#"<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Welcome to RentnerProxy</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#101b24;color:#e9f4f2;font-family:system-ui,sans-serif}main{max-width:38rem;margin:2rem;padding:3rem;border:1px solid #375650;border-radius:1.5rem;background:#172a30}small{color:#76dac2;letter-spacing:.14em}h1{font-size:clamp(2rem,6vw,3.5rem);line-height:1.1}p{color:#b7cfcc;line-height:1.6}</style></head><body><main><small>RENTNERPROXY</small><h1>Your proxy is ready.</h1><p>This address has no configured proxy host yet.</p></main></body></html>"#;
const HTML_CSP: &str = "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src http: https: data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

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
        DefaultSite::Welcome => html_response(WELCOME_HTML),
        DefaultSite::CustomHtml { html } => html_response(html),
    };
    Route {
        matchers: Vec::new(),
        handle: vec![response],
        terminal: true,
    }
}

fn html_response(html: &str) -> Handler {
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
                vec![HTML_CSP.to_owned()],
            ),
        ])),
    })
}
