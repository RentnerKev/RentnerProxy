use std::{collections::BTreeMap, net::IpAddr};

use ipnet::IpNet;
use serde_json::Value;

use super::fixtures::{host, request};
use crate::{
    models::{
        AccessPolicy, AccessPolicyMode, BasicAuth, BasicAuthAccount, IpDefaultAction, IpRules,
        ProxyHttpSettings, ValidatedProxyConfig,
    },
    proxy::revision_from_config,
    runtime::renderer::{
        RenderSettings, TlsMaterial, TlsRenderSettings, UpstreamTlsRenderSettings, render_config,
        render_config_with_tls,
    },
};

fn settings() -> RenderSettings {
    let base = std::env::temp_dir().join("rentnerproxy-renderer-test");
    RenderSettings {
        http_port: 8080,
        probe_socket: cfg!(unix).then(|| base.join("runtime-probe.sock")),
        admin_socket: cfg!(unix).then(|| base.join("caddy-admin.sock")),
        state_dir: base,
        controller_port: 8081,
    }
}

fn config() -> ValidatedProxyConfig {
    let request = request(vec![host(
        "018f4b4a-7d1f-7abc-8def-0123456789ab",
        &["a.example"],
        "http",
        "127.0.0.1",
        9000,
    )]);
    crate::proxy::validate_proxy_config(request).expect("fixture validates")
}

#[test]
fn renders_typed_caddy_servers_and_probe() {
    let configuration = config();
    let rendered = render_config(Some(&configuration), &settings()).unwrap();
    let json: Value = serde_json::from_str(&rendered).unwrap();
    assert_eq!(json["admin"]["config"]["persist"], true);
    assert_eq!(json["storage"]["module"], "file_system");
    assert_eq!(
        json["apps"]["http"]["servers"]["rentnerproxy-http"]["protocols"],
        serde_json::json!(["h1", "h2"])
    );
    assert_eq!(
        json["apps"]["http"]["servers"]["rentnerproxy-probe"]["protocols"],
        serde_json::json!(["h1"])
    );
    assert!(rendered.contains("/__rentnerproxy_runtime_probe"));
    assert_eq!(
        revision_from_config(&rendered),
        Some(configuration.revision)
    );
}

#[test]
fn challenge_route_precedes_host_routes_and_public_unknowns_are_404() {
    let json: Value =
        serde_json::from_str(&render_config(Some(&config()), &settings()).unwrap()).unwrap();
    let routes = json["apps"]["http"]["servers"]["rentnerproxy-http"]["routes"]
        .as_array()
        .unwrap();
    assert!(
        routes[0]["match"][0]["path"][0]
            .as_str()
            .unwrap()
            .starts_with("/.well-known")
    );
    assert_eq!(
        routes.last().unwrap()["handle"][0]["handler"],
        "static_response"
    );
    assert_eq!(routes.last().unwrap()["handle"][0]["status_code"], 404);
}

#[test]
fn protected_host_routes_are_terminal_403s_on_http_and_https() {
    let mut configuration = config();
    configuration.proxy_hosts[0].access_policy = Some(AccessPolicy {
        id: "0198d98a-0000-7000-8000-000000000001".into(),
        mode: AccessPolicyMode::Authenticated,
        combination: None,
        basic_auth: None,
        ip_rules: None,
    });
    let http: Value =
        serde_json::from_str(&render_config(Some(&configuration), &settings()).unwrap()).unwrap();
    let http_route = &http["apps"]["http"]["servers"]["rentnerproxy-http"]["routes"][1];
    assert_eq!(http_route["handle"][0]["handler"], "static_response");
    assert_eq!(http_route["handle"][0]["status_code"], 403);
    assert!(http_route["handle"][1].is_null());

    configuration.proxy_hosts[0].certificate_id =
        Some("018f4b4a-7d1f-7abc-8def-2123456789ab".into());
    let mut materials = BTreeMap::new();
    materials.insert(
        configuration.proxy_hosts[0].certificate_id.clone().unwrap(),
        TlsMaterial {
            fullchain_path: std::env::temp_dir().join("fullchain.pem"),
            private_key_path: std::env::temp_dir().join("private-key.pem"),
        },
    );
    let upstream = UpstreamTlsRenderSettings {
        system_ca_bundle: std::env::temp_dir().join("ca-certificates.crt"),
        trusted_ca_paths: BTreeMap::new(),
    };
    let https: Value = serde_json::from_str(
        &render_config_with_tls(
            &configuration,
            &settings(),
            &TlsRenderSettings {
                https_port: 8443,
                public_https_port: 443,
                controller_port: 8081,
            },
            &materials,
            &upstream,
        )
        .unwrap(),
    )
    .unwrap();
    let https_route = &https["apps"]["http"]["servers"]["rentnerproxy-https"]["routes"][1];
    assert_eq!(https_route["handle"][0]["handler"], "static_response");
    assert_eq!(https_route["handle"][0]["status_code"], 403);
    assert!(https_route["handle"][1].is_null());
}

#[test]
fn basic_auth_is_before_body_and_proxy_and_uses_fixed_caddy_settings() {
    let mut configuration = config();
    configuration.proxy_hosts[0].access_policy = Some(AccessPolicy {
        id: "0198d98a-0000-7000-8000-000000000001".into(),
        mode: AccessPolicyMode::Authenticated,
        combination: None,
        basic_auth: Some(BasicAuth {
            accounts: vec![BasicAuthAccount {
                username: "admin".into(),
                password_hash: "$argon2id$v=19$m=47104,t=1,p=1$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA$MrQeoLQVkaRjr94luEbHZECFRREjHzNciGTu9rBCN+Y".into(),
            }],
        }),
        ip_rules: None,
    });
    configuration.proxy_hosts[0]
        .http_settings
        .client_max_body_size_bytes = Some(4096);
    let json: Value =
        serde_json::from_str(&render_config(Some(&configuration), &settings()).unwrap()).unwrap();
    let handle = &json["apps"]["http"]["servers"]["rentnerproxy-http"]["routes"][1]["handle"];
    assert_eq!(handle[0]["handler"], "authentication");
    assert_eq!(
        handle[0]["providers"]["http_basic"]["hash"]["algorithm"],
        "argon2id"
    );
    assert_eq!(
        handle[0]["providers"]["http_basic"]["realm"],
        "RentnerProxy"
    );
    assert_eq!(
        handle[0]["providers"]["http_basic"]["hash_cache"],
        serde_json::json!({})
    );
    assert_eq!(
        handle[0]["providers"]["http_basic"]["accounts"][0]["password"],
        "$argon2id$v=19$m=47104,t=1,p=1$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA$MrQeoLQVkaRjr94luEbHZECFRREjHzNciGTu9rBCN+Y"
    );
    assert_eq!(handle[1]["handler"], "request_body");
    assert_eq!(handle[2]["handler"], "reverse_proxy");
    assert!(
        handle[2]["headers"]["request"]["delete"]
            .as_array()
            .unwrap()
            .contains(&serde_json::json!("Authorization"))
    );
}

#[test]
fn ip_restricted_routes_deny_before_allow_and_expand_ipv4_mapped_peers() {
    let mut configuration = config();
    configuration.proxy_hosts[0].access_policy = Some(AccessPolicy {
        id: "0198d98a-0000-7000-8000-000000000001".into(),
        mode: AccessPolicyMode::IpRestricted,
        combination: None,
        basic_auth: None,
        ip_rules: Some(IpRules {
            default_action: IpDefaultAction::Deny,
            allow: vec!["192.0.2.0/24".into()],
            deny: vec!["192.0.2.128/25".into()],
        }),
    });
    configuration.revision = crate::proxy::revision_for_configuration(
        &configuration.proxy_hosts,
        &configuration.http_settings,
    );
    let json: Value =
        serde_json::from_str(&render_config(Some(&configuration), &settings()).unwrap()).unwrap();
    let routes = json["apps"]["http"]["servers"]["rentnerproxy-http"]["routes"]
        .as_array()
        .unwrap();
    assert_eq!(routes[1]["handle"][0]["status_code"], 403);
    assert_eq!(
        routes[1]["match"][0]["remote_ip"]["ranges"],
        serde_json::json!(["192.0.2.128/25", "::ffff:192.0.2.128/121"])
    );
    assert_eq!(routes[2]["handle"][0]["handler"], "reverse_proxy");
    assert_eq!(
        routes[2]["match"][0]["remote_ip"]["ranges"],
        serde_json::json!(["192.0.2.0/24", "::ffff:192.0.2.0/120"])
    );
    assert_eq!(
        routes[2]["match"][0]["not"][0]["remote_ip"]["ranges"],
        serde_json::json!(["192.0.2.128/25", "::ffff:192.0.2.128/121"])
    );
    assert_eq!(routes[3]["handle"][0]["status_code"], 403);
}

fn matcher_matches_remote_ip(matcher: &Value, address: IpAddr) -> bool {
    let remote_matches = matcher
        .get("remote_ip")
        .and_then(|remote| remote.get("ranges"))
        .is_none_or(|ranges| {
            ranges.as_array().unwrap().iter().any(|range| {
                range
                    .as_str()
                    .unwrap()
                    .parse::<IpNet>()
                    .unwrap()
                    .contains(&address)
            })
        });
    let not_matches = matcher
        .get("not")
        .and_then(Value::as_array)
        .is_none_or(|excluded| {
            !excluded
                .iter()
                .any(|nested| matcher_matches_remote_ip(nested, address))
        });
    remote_matches && not_matches
}

#[test]
fn ipv6_matchers_exclude_unlisted_mapped_peers_and_append_deny() {
    let mut configuration = config();
    configuration.proxy_hosts[0].access_policy = Some(AccessPolicy {
        id: "0198d98a-0000-7000-8000-000000000001".into(),
        mode: AccessPolicyMode::IpRestricted,
        combination: None,
        basic_auth: None,
        ip_rules: Some(IpRules {
            default_action: IpDefaultAction::Deny,
            allow: vec!["192.0.2.0/24".into(), "2001:db8::/32".into()],
            deny: vec!["2001:db8:bad::/48".into()],
        }),
    });
    configuration.revision = crate::proxy::revision_for_configuration(
        &configuration.proxy_hosts,
        &configuration.http_settings,
    );
    let json: Value =
        serde_json::from_str(&render_config(Some(&configuration), &settings()).unwrap()).unwrap();
    let routes = json["apps"]["http"]["servers"]["rentnerproxy-http"]["routes"]
        .as_array()
        .unwrap();
    let deny_matcher = &routes[1]["match"][0];
    let allow_matcher = &routes[2]["match"][0];
    let mapped_allowed: IpAddr = "::ffff:192.0.2.1".parse().unwrap();
    let mapped_unlisted: IpAddr = "::ffff:198.51.100.1".parse().unwrap();
    let allowed_ipv6: IpAddr = "2001:db8::1".parse().unwrap();
    let denied_ipv6: IpAddr = "2001:db8:bad::1".parse().unwrap();

    assert_eq!(allow_matcher["not"].as_array().unwrap().len(), 2);
    assert_eq!(
        allow_matcher["not"][0]["remote_ip"]["ranges"],
        serde_json::json!(["::ffff:0:0/96"])
    );
    assert_eq!(
        allow_matcher["not"][0]["not"],
        serde_json::json!([{
            "remote_ip": { "ranges": ["::ffff:192.0.2.0/120"] }
        }])
    );
    assert!(matcher_matches_remote_ip(allow_matcher, mapped_allowed));
    assert!(!matcher_matches_remote_ip(allow_matcher, mapped_unlisted));
    assert!(matcher_matches_remote_ip(allow_matcher, allowed_ipv6));
    assert!(!matcher_matches_remote_ip(allow_matcher, denied_ipv6));
    assert!(matcher_matches_remote_ip(deny_matcher, denied_ipv6));
    assert!(!matcher_matches_remote_ip(deny_matcher, mapped_unlisted));
}

#[test]
fn combined_any_uses_ip_without_auth_then_basic_auth_as_fallback() {
    let mut configuration = config();
    configuration.proxy_hosts[0].access_policy = Some(AccessPolicy {
        id: "0198d98a-0000-7000-8000-000000000001".into(),
        mode: AccessPolicyMode::Combined,
        combination: Some(crate::models::AccessPolicyCombination::Any),
        basic_auth: Some(BasicAuth {
            accounts: vec![BasicAuthAccount {
                username: "admin".into(),
                password_hash: "$argon2id$v=19$m=47104,t=1,p=1$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA$MrQeoLQVkaRjr94luEbHZECFRREjHzNciGTu9rBCN+Y".into(),
            }],
        }),
        ip_rules: Some(IpRules {
            default_action: IpDefaultAction::Deny,
            allow: vec!["192.0.2.0/24".into()],
            deny: vec![],
        }),
    });
    configuration.revision = crate::proxy::revision_for_configuration(
        &configuration.proxy_hosts,
        &configuration.http_settings,
    );
    let json: Value =
        serde_json::from_str(&render_config(Some(&configuration), &settings()).unwrap()).unwrap();
    let routes = json["apps"]["http"]["servers"]["rentnerproxy-http"]["routes"]
        .as_array()
        .unwrap();
    assert_eq!(routes[1]["handle"][0]["handler"], "reverse_proxy");
    assert_eq!(routes[2]["handle"][0]["handler"], "authentication");
    assert!(
        routes[1]["handle"][0]["headers"]["request"]["delete"]
            .as_array()
            .unwrap()
            .contains(&serde_json::json!("Authorization"))
    );
    assert!(routes[2]["match"][0]["remote_ip"].is_null());
}

#[test]
fn tls_rendering_uses_file_loaders_and_explicit_sni_selection() {
    let mut configuration = config();
    configuration.proxy_hosts[0].certificate_id =
        Some("018f4b4a-7d1f-7abc-8def-2123456789ab".into());
    let mut materials = BTreeMap::new();
    materials.insert(
        configuration.proxy_hosts[0].certificate_id.clone().unwrap(),
        TlsMaterial {
            fullchain_path: std::env::temp_dir().join("fullchain.pem"),
            private_key_path: std::env::temp_dir().join("private-key.pem"),
        },
    );
    let upstream = UpstreamTlsRenderSettings {
        system_ca_bundle: std::env::temp_dir().join("ca-certificates.crt"),
        trusted_ca_paths: BTreeMap::new(),
    };
    let rendered = render_config_with_tls(
        &configuration,
        &settings(),
        &TlsRenderSettings {
            https_port: 8443,
            public_https_port: 8443,
            controller_port: 8081,
        },
        &materials,
        &upstream,
    )
    .unwrap();
    let json: Value = serde_json::from_str(&rendered).unwrap();
    let https = &json["apps"]["http"]["servers"]["rentnerproxy-https"];
    assert_eq!(https["automatic_https"]["disable"], true);
    assert_eq!(https["strict_sni_host"], true);
    assert_eq!(
        https["tls_connection_policies"][0]["certificate_selection"]["any_tag"][0].as_str(),
        configuration.proxy_hosts[0].certificate_id.as_deref()
    );
    assert_eq!(
        json["apps"]["tls"]["certificates"]["load_files"][0]["certificate"],
        std::env::temp_dir()
            .join("fullchain.pem")
            .to_str()
            .unwrap()
            .replace('\\', "/")
    );
}

#[test]
fn global_timeouts_are_server_timeouts_and_host_body_limit_is_typed() {
    let mut configuration = config();
    configuration.http_settings = ProxyHttpSettings {
        send_timeout_seconds: Some(12),
        keepalive_timeout_seconds: Some(20),
        ..Default::default()
    };
    configuration.proxy_hosts[0]
        .http_settings
        .client_max_body_size_bytes = Some(4096);
    let json: Value =
        serde_json::from_str(&render_config(Some(&configuration), &settings()).unwrap()).unwrap();
    let server = &json["apps"]["http"]["servers"]["rentnerproxy-http"];
    assert_eq!(server["write_timeout"], "12s");
    assert_eq!(server["idle_timeout"], "20s");
    assert_eq!(server["routes"][1]["handle"][0]["handler"], "request_body");
    assert_eq!(server["routes"][1]["handle"][0]["max_size"], 4096);
}

#[test]
fn upstream_tls_uses_explicit_trust_sni_and_native_forwarding_defaults() {
    use crate::models::UpstreamTls;
    use crate::runtime::renderer::RenderError;
    let mut configuration = config();
    let host = &mut configuration.proxy_hosts[0];
    host.forward_scheme = "https".into();
    host.forward_host = "2001:db8::2".into();
    host.forward_port = 9443;
    host.upstream_tls = Some(UpstreamTls {
        verify: true,
        server_name: Some("upstream.example".into()),
        trusted_ca_id: Some("ca-id".into()),
    });
    let ca_path = std::env::temp_dir().join("caddy custom ca.pem");
    let mut trust = UpstreamTlsRenderSettings {
        system_ca_bundle: std::env::temp_dir().join("system-ca.pem"),
        trusted_ca_paths: BTreeMap::from([("ca-id".into(), ca_path.clone())]),
    };
    let tls = TlsRenderSettings {
        https_port: 8443,
        public_https_port: 443,
        controller_port: 8081,
    };
    let render = |config: &ValidatedProxyConfig, trust: &UpstreamTlsRenderSettings| {
        render_config_with_tls(config, &settings(), &tls, &BTreeMap::new(), trust)
    };
    let json: Value = serde_json::from_str(&render(&configuration, &trust).unwrap()).unwrap();
    let proxy = &json["apps"]["http"]["servers"]["rentnerproxy-http"]["routes"][1]["handle"][0];
    assert_eq!(proxy["upstreams"][0]["dial"], "[2001:db8::2]:9443");
    assert_eq!(proxy["transport"]["tls"]["server_name"], "upstream.example");
    assert_eq!(proxy["transport"]["tls"]["ca"]["provider"], "file");
    assert_eq!(
        proxy["transport"]["tls"]["ca"]["pem_files"][0],
        ca_path.to_str().unwrap().replace('\\', "/")
    );
    assert!(proxy["transport"]["tls"]["insecure_skip_verify"].is_null());
    assert_eq!(
        proxy["headers"]["request"]["set"]["Host"][0],
        "{http.request.host}"
    );
    assert_eq!(
        proxy["headers"]["request"]["set"]["X-Real-IP"][0],
        "{http.request.remote.host}"
    );
    assert_eq!(
        proxy["headers"]["request"]["delete"],
        serde_json::json!([
            "Forwarded",
            "X-Forwarded-Port",
            "X-Forwarded-Prefix",
            "Proxy"
        ])
    );
    assert!(proxy["headers"]["request"]["set"]["Connection"].is_null());
    trust.trusted_ca_paths.clear();
    assert_eq!(
        render(&configuration, &trust),
        Err(RenderError::MissingTrustedCa)
    );
    configuration.proxy_hosts[0].upstream_tls = None;
    assert_eq!(
        render(&configuration, &trust),
        Err(RenderError::MissingUpstreamTlsPolicy)
    );
    configuration.proxy_hosts[0].upstream_tls = Some(UpstreamTls {
        verify: false,
        server_name: None,
        trusted_ca_id: None,
    });
    let json: Value = serde_json::from_str(&render(&configuration, &trust).unwrap()).unwrap();
    let tls = &json["apps"]["http"]["servers"]["rentnerproxy-http"]["routes"][1]["handle"][0]["transport"]
        ["tls"];
    assert_eq!(tls["insecure_skip_verify"], true);
    assert!(tls["ca"].is_null());
}

#[test]
fn host_sources_include_effective_http_and_https_routes() {
    use crate::runtime::renderer::render_host_config_for_runtime;
    let mut host = config()
        .proxy_hosts
        .into_iter()
        .next()
        .expect("fixture contains a proxy host");
    host.force_https = true;
    host.certificate_id = Some("certificate".into());
    host.http_settings.proxy_read_timeout_seconds = Some(17);
    let defaults = ProxyHttpSettings {
        client_max_body_size_bytes: Some(1024),
        proxy_connect_timeout_seconds: Some(4),
        proxy_read_timeout_seconds: Some(11),
        proxy_send_timeout_seconds: Some(12),
        ..Default::default()
    };
    let json: Value = serde_json::from_str(
        &render_host_config_for_runtime(&host, &defaults, 9443, None).unwrap(),
    )
    .unwrap();
    assert_eq!(json["http"]["handle"].as_array().unwrap().len(), 1);
    assert_eq!(json["http"]["handle"][0]["status_code"], 308);
    assert_eq!(
        json["http"]["handle"][0]["headers"]["Location"][0],
        "https://{http.request.host}:9443{http.request.uri}"
    );
    assert_eq!(json["https"]["handle"][0]["max_size"], 1024);
    let transport = &json["https"]["handle"][1]["transport"];
    assert_eq!(transport["dial_timeout"], "4s");
    assert_eq!(transport["read_timeout"], "17s");
    assert_eq!(transport["response_header_timeout"], "17s");
    assert_eq!(transport["write_timeout"], "12s");
}

#[test]
fn redirect_handlers_keep_exact_destination_and_encoded_request_uri_semantics() {
    let mut configuration = config();
    configuration.proxy_hosts.clear();
    for status in [301, 302, 307, 308] {
        for preserve in [false, true] {
            configuration.redirect_hosts = vec![crate::models::RedirectHost {
                id: "018f4b4a-7d1f-7abc-8def-0123456789ab".into(),
                domains: vec!["redirect.example".into()],
                destination: if preserve {
                    "https://target.example/prefix"
                } else {
                    "https://target.example/%E2%82%AC?x=%2F#part"
                }
                .into(),
                status_code: status,
                preserve_request_uri: preserve,
                certificate_id: None,
            }];
            let json: Value =
                serde_json::from_str(&render_config(Some(&configuration), &settings()).unwrap())
                    .unwrap();
            let routes = &json["apps"]["http"]["servers"]["rentnerproxy-http"]["routes"];
            assert_eq!(
                routes[0]["match"][0]["path"][0],
                "/.well-known/acme-challenge/*"
            );
            assert_eq!(routes[1]["handle"][0]["status_code"], status);
            let expected = if preserve {
                "https://target.example/prefix{http.request.uri}"
            } else {
                "https://target.example/%E2%82%AC?x=%2F#part"
            };
            assert_eq!(routes[1]["handle"][0]["headers"]["Location"][0], expected);
        }
    }
}
