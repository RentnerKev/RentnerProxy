use std::collections::BTreeMap;

use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use super::fixtures::{host, request};
use crate::{
    models::{DefaultSite, ProxyConfigRequest, RedirectHost},
    proxy::{
        ProxyValidationError, revision_for_full_configuration, revision_from_config,
        validate_proxy_config,
    },
    runtime::renderer::{
        CrowdSecRenderSettings, RenderSettings, TlsMaterial, TlsRenderSettings,
        UpstreamTlsRenderSettings, render_config, render_config_with_tls_and_crowdsec,
    },
};

#[test]
fn default_site_unicode_revision_matches_web() {
    let request: ProxyConfigRequest = serde_json::from_value(json!({
        "version": 7,
        "revision": "sha256:31b57fcab60e4a49757ec9b077b4ee67322a9be03b2fd2eb8ccad4b676a71c25",
        "proxyHosts": [],
        "redirectHosts": [],
        "httpSettings": {},
        "trustedCas": [],
        "defaultSite": {"mode": "custom-html", "html": "<p>Gude äß 👋</p>\n"}
    }))
    .unwrap();
    assert!(validate_proxy_config(request).is_ok());
}

fn with_site(site: DefaultSite) -> ProxyConfigRequest {
    let mut request = request(Vec::new());
    request.default_site = site;
    request.revision = revision_for_full_configuration(
        &request.proxy_hosts,
        &request.redirect_hosts,
        &request.http_settings,
        &request.trusted_cas,
        &request.default_site,
    );
    request
}

fn settings() -> RenderSettings {
    RenderSettings {
        http_port: 8080,
        probe_socket: None,
        admin_socket: None,
        state_dir: std::env::temp_dir().join("default-site-test"),
        controller_port: 8081,
        trusted_proxy_cidrs: Vec::new(),
    }
}

#[test]
fn default_site_preserves_legacy_v7_hash_and_serialization() {
    let legacy =
        r#"{"version":7,"proxyHosts":[],"redirectHosts":[],"httpSettings":{},"trustedCas":[]}"#;
    let expected = format!(
        "sha256:{}",
        Sha256::digest(legacy.as_bytes())
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>()
    );
    let request = with_site(DefaultSite::NotFound);
    assert_eq!(request.revision, expected);
    let mut serialized = serde_json::to_value(&request).unwrap();
    assert!(serialized.get("defaultSite").is_none());
    let decoded: ProxyConfigRequest = serde_json::from_value(serialized.clone()).unwrap();
    assert_eq!(decoded.default_site, DefaultSite::NotFound);
    serialized["defaultSite"] = json!({"mode":"not-found"});
    assert_eq!(
        validate_proxy_config(serde_json::from_value(serialized).unwrap())
            .unwrap()
            .revision,
        expected
    );
    for site in [
        DefaultSite::Welcome,
        DefaultSite::Close,
        DefaultSite::Redirect {
            url: "https://example.com/fixed?q=1".into(),
        },
        DefaultSite::CustomHtml {
            html: "<h1>Hello</h1>".into(),
        },
    ] {
        let request = with_site(site.clone());
        assert_ne!(request.revision, expected);
        assert_eq!(
            validate_proxy_config(request.clone()).unwrap().default_site,
            site
        );
        assert_eq!(
            serde_json::from_value::<ProxyConfigRequest>(serde_json::to_value(request).unwrap())
                .unwrap()
                .default_site,
            site
        );
    }
}

#[test]
fn default_site_revision_shaped_html_cannot_impersonate_the_private_probe() {
    let html = format!("sha256:{}\n", "a".repeat(64));
    let configuration = validate_proxy_config(with_site(DefaultSite::CustomHtml { html })).unwrap();
    let rendered = render_config(Some(&configuration), &settings()).unwrap();
    assert_eq!(
        revision_from_config(&rendered),
        Some(configuration.revision.clone())
    );
    let actual: Value = serde_json::from_str(&rendered).unwrap();
    let mut missing_probe = actual.clone();
    missing_probe["apps"]["http"]["servers"]
        .as_object_mut()
        .unwrap()
        .remove("rentnerproxy-probe");
    assert_eq!(revision_from_config(&missing_probe.to_string()), None);
    for wrong_path in [
        json!(["/wrong"]),
        json!(["/__rentnerproxy_runtime_probe*"]),
        json!(["/__rentnerproxy_runtime_probe", "/other"]),
        json!([]),
    ] {
        let mut wrong = actual.clone();
        wrong["apps"]["http"]["servers"]["rentnerproxy-probe"]["routes"][0]["match"][0]["path"] =
            wrong_path;
        assert_eq!(revision_from_config(&wrong.to_string()), None);
    }
    let mut unmatched = actual.clone();
    unmatched["apps"]["http"]["servers"]["rentnerproxy-probe"]["routes"][0]
        .as_object_mut()
        .unwrap()
        .remove("match");
    assert_eq!(revision_from_config(&unmatched.to_string()), None);
    let mut extra_match = actual.clone();
    extra_match["apps"]["http"]["servers"]["rentnerproxy-probe"]["routes"][0]["match"]
        .as_array_mut()
        .unwrap()
        .push(json!({"path":["/other"]}));
    assert_eq!(revision_from_config(&extra_match.to_string()), None);
    let mut nonterminal = actual;
    nonterminal["apps"]["http"]["servers"]["rentnerproxy-probe"]["routes"][0]["terminal"] =
        json!(false);
    assert_eq!(revision_from_config(&nonterminal.to_string()), None);
}

#[test]
fn private_probe_ignores_invalid_bodies_and_non_probe_handlers() {
    let configuration = validate_proxy_config(with_site(DefaultSite::default())).unwrap();
    let rendered = render_config(Some(&configuration), &settings()).unwrap();
    let actual: Value = serde_json::from_str(&rendered).unwrap();
    for body in [
        Value::Null,
        json!(configuration.revision),
        json!(format!("sha256:{}\n", "g".repeat(64))),
        json!(format!("{}\n\n", configuration.revision)),
    ] {
        let mut invalid = actual.clone();
        invalid["apps"]["http"]["servers"]["rentnerproxy-probe"]["routes"][0]["handle"][0]["body"] =
            body;
        assert_eq!(revision_from_config(&invalid.to_string()), None);
    }

    let mut mixed = actual.clone();
    let valid =
        actual["apps"]["http"]["servers"]["rentnerproxy-probe"]["routes"][0]["handle"][0].clone();
    mixed["apps"]["http"]["servers"]["rentnerproxy-probe"]["routes"][0]["handle"] = json!([
        {"handler": "reverse_proxy", "status_code": 200, "body": valid["body"]},
        {"handler": "static_response", "status_code": 204, "body": valid["body"]},
        {"handler": "static_response", "status_code": 200, "body": configuration.revision},
        valid,
    ]);
    assert_eq!(
        revision_from_config(&mixed.to_string()),
        Some(configuration.revision)
    );
}

#[test]
fn default_site_rejects_wrong_shapes_bounds_urls_and_revision() {
    for value in [
        json!(null),
        json!({}),
        json!({"mode":"unknown"}),
        json!({"mode":"close","html":"x"}),
        json!({"mode":"not-found","url":"https://example.com/"}),
        json!({"mode":"welcome","unexpected":true}),
        json!({"mode":"redirect"}),
        json!({"mode":"redirect","url":"https://example.com/","html":"x"}),
        json!({"mode":"custom-html","html":1}),
        json!({"mode":"custom-html","html":"x","url":"https://example.com/"}),
    ] {
        assert!(
            serde_json::from_value::<DefaultSite>(value.clone()).is_err(),
            "{value}"
        );
    }
    for html in [
        "".to_owned(),
        " \r\n\t".to_owned(),
        "<p>\0</p>".to_owned(),
        "x".repeat(262_145),
        "ä".repeat(131_073),
    ] {
        assert_eq!(
            validate_proxy_config(with_site(DefaultSite::CustomHtml { html })),
            Err(ProxyValidationError::ValidationFailed)
        );
    }
    for html in ["x".repeat(262_144), "ä".repeat(131_072)] {
        assert!(validate_proxy_config(with_site(DefaultSite::CustomHtml { html })).is_ok());
    }
    for url in [
        "javascript:alert(1)",
        "https://user:secret@example.com/",
        "https://example.com/{env.SECRET}",
        "/relative",
        "https://example.com/\r\nInjected: yes",
        "ftp://example.com/",
    ] {
        assert_eq!(
            validate_proxy_config(with_site(DefaultSite::Redirect { url: url.into() })),
            Err(ProxyValidationError::ValidationFailed),
            "{url}"
        );
    }
    let mut changed = with_site(DefaultSite::NotFound);
    changed.default_site = DefaultSite::Welcome;
    assert_eq!(
        validate_proxy_config(changed),
        Err(ProxyValidationError::ValidationFailed)
    );
}

#[test]
fn default_site_renders_modes_and_literal_html_without_exposing_probe() {
    let html = r#"<style>body{color:red}</style>{env.SECRET}|{file./etc/passwd}|{http.request.uri}|\{literal}|\\tail|{}|}"#;
    for site in [
        DefaultSite::NotFound,
        DefaultSite::Close,
        DefaultSite::Welcome,
        DefaultSite::Redirect {
            url: "https://example.com/fixed?q=1#here".into(),
        },
        DefaultSite::CustomHtml { html: html.into() },
    ] {
        let configuration = validate_proxy_config(with_site(site.clone())).unwrap();
        let value: Value =
            serde_json::from_str(&render_config(Some(&configuration), &settings()).unwrap())
                .unwrap();
        let servers = &value["apps"]["http"]["servers"];
        assert!(servers["rentnerproxy-https"].is_null());
        let routes = servers["rentnerproxy-http"]["routes"].as_array().unwrap();
        assert_eq!(
            routes[0]["match"][0]["path"][0],
            "/.well-known/acme-challenge/*"
        );
        let fallback = routes.last().unwrap();
        assert!(fallback["match"].is_null());
        assert_eq!(fallback["terminal"], true);
        let response = &fallback["handle"][0];
        assert_eq!(response["handler"], "static_response");
        match site {
            DefaultSite::NotFound => assert_eq!(response["status_code"], 404),
            DefaultSite::Close => {
                assert_eq!(response, &json!({"handler":"static_response","abort":true}))
            }
            DefaultSite::Redirect { url } => {
                assert_eq!(response["status_code"], 302);
                assert_eq!(response["headers"]["Location"], json!([url]));
                assert_eq!(response["headers"]["Cache-Control"], json!(["no-store"]));
                assert!(response["body"].is_null());
            }
            DefaultSite::CustomHtml { .. } | DefaultSite::Welcome => {
                assert_eq!(response["status_code"], 200);
                assert_eq!(
                    response["headers"]["Content-Type"],
                    json!(["text/html; charset=utf-8"])
                );
                assert_eq!(response["headers"]["Cache-Control"], json!(["no-store"]));
                assert_eq!(
                    response["headers"]["X-Content-Type-Options"],
                    json!(["nosniff"])
                );
                assert_eq!(
                    response["headers"]["Referrer-Policy"],
                    json!(["no-referrer"])
                );
                assert_eq!(
                    response["headers"]["Content-Security-Policy"],
                    json!([
                        if matches!(configuration.default_site, DefaultSite::Welcome) {
                            "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
                        } else {
                            "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src http: https: data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
                        }
                    ])
                );
                let body = response["body"].as_str().unwrap();
                if matches!(configuration.default_site, DefaultSite::CustomHtml { .. }) {
                    assert_eq!(
                        body,
                        r#"<style>body\{color:red\}</style>\{env.SECRET\}|\{file./etc/passwd\}|\{http.request.uri\}|\\{literal\}|\\tail|\{\}|\}"#
                    );
                } else {
                    assert!(body.contains("Welcome to RentnerProxy"));
                    assert!(!body.contains("<script"));
                    assert!(!body.contains("__WELCOME_"));
                    assert!(body.len() < 524_288, "welcome page stays within 512 KiB");
                }
            }
        }
        assert_eq!(
            servers["rentnerproxy-probe"]["routes"][1]["handle"][0]["status_code"],
            404
        );
        assert_eq!(
            servers["rentnerproxy-probe"]["routes"][0]["handle"][0]["body"],
            format!("{}\n", configuration.revision)
        );
    }
}

#[test]
fn default_site_preserves_route_precedence_and_https_security_policy() {
    let mut request = with_site(DefaultSite::Welcome);
    let cert = "018f4b4a-7d1f-7abc-8def-2123456789ab";
    let mut proxy_host = host(
        "018f4b4a-7d1f-7abc-8def-0123456789ab",
        &["a.example"],
        "http",
        "127.0.0.1",
        9000,
    );
    proxy_host.certificate_id = Some(cert.into());
    request.proxy_hosts.push(proxy_host);
    request.redirect_hosts.push(RedirectHost {
        id: "018f4b4a-7d1f-7abc-8def-3123456789ab".into(),
        domains: vec!["redirect.example".into()],
        destination: "https://target.example/".into(),
        status_code: 308,
        preserve_request_uri: false,
        certificate_id: Some(cert.into()),
    });
    request.revision = revision_for_full_configuration(
        &request.proxy_hosts,
        &request.redirect_hosts,
        &request.http_settings,
        &request.trusted_cas,
        &request.default_site,
    );
    let mut config = validate_proxy_config(request).unwrap();
    let materials = BTreeMap::from([(
        cert.to_owned(),
        TlsMaterial {
            fullchain_path: std::env::temp_dir().join("fullchain.pem"),
            private_key_path: std::env::temp_dir().join("key.pem"),
        },
    )]);
    let tls = TlsRenderSettings {
        https_port: 8443,
        public_https_port: 443,
        controller_port: 8081,
    };
    let upstream = UpstreamTlsRenderSettings {
        system_ca_bundle: std::env::temp_dir().join("ca.pem"),
        trusted_ca_paths: BTreeMap::new(),
    };
    let render = |config: &crate::models::ValidatedProxyConfig| -> Value {
        serde_json::from_str(
            &render_config_with_tls_and_crowdsec(
                config,
                &settings(),
                &tls,
                &materials,
                &upstream,
                Some(&CrowdSecRenderSettings {
                    api_url: "http://127.0.0.1:8082/".into(),
                }),
            )
            .unwrap(),
        )
        .unwrap()
    };
    let configured = render(&config);
    config.default_site = DefaultSite::NotFound;
    let legacy = render(&config);
    let servers = &configured["apps"]["http"]["servers"];
    for name in ["rentnerproxy-http", "rentnerproxy-https"] {
        let routes = servers[name]["routes"].as_array().unwrap();
        let previous = legacy["apps"]["http"]["servers"][name]["routes"]
            .as_array()
            .unwrap();
        assert_eq!(&routes[..routes.len() - 1], &previous[..previous.len() - 1]);
        assert_eq!(
            routes[routes.len() - 2]["match"][0]["host"],
            json!(["redirect.example"])
        );
        assert_eq!(routes.last().unwrap()["handle"][0]["status_code"], 200);
    }
    let https = &servers["rentnerproxy-https"];
    assert_eq!(https["strict_sni_host"], true);
    assert_eq!(
        https["tls_connection_policies"],
        legacy["apps"]["http"]["servers"]["rentnerproxy-https"]["tls_connection_policies"]
    );
    assert_eq!(
        https["tls_connection_policies"].as_array().unwrap().len(),
        2
    );
    assert_eq!(configured["apps"]["tls"], legacy["apps"]["tls"]);
    assert_eq!(
        servers["rentnerproxy-probe"],
        legacy["apps"]["http"]["servers"]["rentnerproxy-probe"]
    );
}
