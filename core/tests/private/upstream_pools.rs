use std::collections::BTreeMap;

use serde_json::{Value, json};

use super::fixtures::{host, request};
use crate::{
    models::{ProxyHost, UpstreamMember, UpstreamPool, UpstreamSelectionPolicy, UpstreamTls},
    proxy::{ProxyValidationError, revision_for_hosts, validate_proxy_config},
    runtime::renderer::{
        RenderSettings, TlsRenderSettings, UpstreamTlsRenderSettings, render_config,
        render_config_with_tls,
    },
};

fn pooled_host() -> ProxyHost {
    let mut target = host(
        "018f2f52-7c1b-7cc0-9f3c-6a9952c54019",
        &["www.demo.test", "demo.test"],
        "http",
        "backend.internal",
        4000,
    );
    target.upstream_pool = Some(UpstreamPool {
        policy: UpstreamSelectionPolicy::RoundRobin,
        members: vec![
            UpstreamMember {
                host: "backend.internal".into(),
                port: 4000,
            },
            UpstreamMember {
                host: "secondary.internal".into(),
                port: 4001,
            },
        ],
    });
    target
}

fn settings() -> RenderSettings {
    let base = std::env::temp_dir().join("rentnerproxy-pool-renderer-test");
    RenderSettings {
        http_port: 8080,
        probe_socket: Some(base.join("runtime-probe.sock")),
        admin_socket: Some(base.join("caddy-admin.sock")),
        state_dir: base,
        controller_addr: "127.0.0.1:8081".parse().unwrap(),
        trusted_proxy_cidrs: Vec::new(),
    }
}

fn pool_proxies(json: &Value) -> Vec<&Value> {
    let mut proxies = Vec::new();
    match json {
        Value::Object(object) => {
            if object.get("handler") == Some(&json!("reverse_proxy"))
                && object.contains_key("load_balancing")
            {
                proxies.push(json);
            }
            for value in object.values() {
                proxies.extend(pool_proxies(value));
            }
        }
        Value::Array(values) => {
            for value in values {
                proxies.extend(pool_proxies(value));
            }
        }
        _ => {}
    }
    proxies
}

#[test]
fn pool_revision_matches_web_and_preserves_order() {
    let target = pooled_host();
    let revision = revision_for_hosts(std::slice::from_ref(&target));
    assert_eq!(
        revision,
        "sha256:ab553eed513e20dae33d9e0e41c2d2bf73505b6da121bc2a99ed0ee96a7b6841"
    );
    let accepted = validate_proxy_config(request(vec![target.clone()])).unwrap();
    assert_eq!(accepted.proxy_hosts[0].upstream_pool, target.upstream_pool);
    let mut reordered = target;
    reordered.upstream_pool.as_mut().unwrap().members.swap(0, 1);
    reordered.forward_host = "secondary.internal".into();
    reordered.forward_port = 4001;
    assert_ne!(revision_for_hosts(&[reordered]), revision);
}

#[test]
fn pool_contract_rejects_wrong_version_unknown_fields_and_invalid_members() {
    let target = pooled_host();
    let mut wrong_version = request(vec![target.clone()]);
    wrong_version.version = 7;
    assert_eq!(
        validate_proxy_config(wrong_version),
        Err(ProxyValidationError::InvalidConfiguration)
    );
    let mut unknown = serde_json::to_value(request(vec![target.clone()])).unwrap();
    unknown["proxyHosts"][0]["upstreamPool"]["members"][0]["scheme"] = json!("https");
    assert!(serde_json::from_value::<crate::models::ProxyConfigRequest>(unknown).is_err());
    for members in [
        vec![],
        vec![UpstreamMember {
            host: "wrong.internal".into(),
            port: 4000,
        }],
        vec![
            UpstreamMember {
                host: "backend.internal".into(),
                port: 4000
            };
            2
        ],
        vec![
            UpstreamMember {
                host: "backend.internal".into(),
                port: 4000,
            },
            UpstreamMember {
                host: "https://bad.internal".into(),
                port: 443,
            },
        ],
        vec![
            UpstreamMember {
                host: "backend.internal".into(),
                port: 4000,
            },
            UpstreamMember {
                host: "valid.internal".into(),
                port: 0,
            },
        ],
        (0..17)
            .map(|index| UpstreamMember {
                host: "backend.internal".into(),
                port: 4000 + index,
            })
            .collect(),
    ] {
        let mut invalid = target.clone();
        invalid.upstream_pool.as_mut().unwrap().members = members;
        assert_eq!(
            validate_proxy_config(request(vec![invalid])),
            Err(ProxyValidationError::ValidationFailed)
        );
    }
    let mut duplicate_ipv6 = target;
    duplicate_ipv6
        .upstream_pool
        .as_mut()
        .unwrap()
        .members
        .extend([
            UpstreamMember {
                host: "2001:db8::1".into(),
                port: 9000,
            },
            UpstreamMember {
                host: "2001:0db8:0:0:0:0:0:1".into(),
                port: 9000,
            },
        ]);
    assert_eq!(
        validate_proxy_config(request(vec![duplicate_ipv6])),
        Err(ProxyValidationError::ValidationFailed)
    );
}

#[test]
fn pool_renders_ordered_dials_and_native_selection_without_changing_headers_or_streams() {
    for policy in [
        UpstreamSelectionPolicy::RoundRobin,
        UpstreamSelectionPolicy::First,
    ] {
        let mut target = pooled_host();
        let pool = target.upstream_pool.as_mut().unwrap();
        pool.policy = policy;
        pool.members[1].host = "2001:db8::2".into();
        let configuration = validate_proxy_config(request(vec![target])).unwrap();
        let value: Value =
            serde_json::from_str(&render_config(Some(&configuration), &settings()).unwrap())
                .unwrap();
        let proxies = pool_proxies(&value);
        assert!(!proxies.is_empty());
        for proxy in proxies {
            assert_eq!(
                proxy["upstreams"],
                json!([{"dial":"backend.internal:4000"}, {"dial":"[2001:db8::2]:4001"}])
            );
            assert_eq!(
                proxy["load_balancing"]["selection_policy"]["policy"],
                json!(policy)
            );
            assert!(proxy["load_balancing"].get("retries").is_none());
            assert_eq!(
                proxy["headers"]["request"]["set"]["Host"],
                json!(["{http.request.host}"])
            );
            assert_eq!(proxy["stream_close_delay"], "5m");
            assert!(proxy.get("request_buffers").is_none());
        }
    }
}

#[test]
fn verified_pool_uses_each_dns_identity_and_requires_explicit_name_for_any_ip() {
    let mut target = pooled_host();
    target.forward_scheme = "https".into();
    target.upstream_tls = Some(UpstreamTls {
        verify: true,
        server_name: None,
        trusted_ca_id: None,
    });
    let configuration = validate_proxy_config(request(vec![target.clone()])).unwrap();
    let tls = TlsRenderSettings {
        https_port: 8443,
        public_https_port: 443,
        controller_port: 8081,
    };
    let trust = UpstreamTlsRenderSettings {
        system_ca_bundle: std::env::temp_dir().join("system-ca.pem"),
        trusted_ca_paths: BTreeMap::new(),
    };
    let value: Value = serde_json::from_str(
        &render_config_with_tls(&configuration, &settings(), &tls, &BTreeMap::new(), &trust)
            .unwrap(),
    )
    .unwrap();
    for proxy in pool_proxies(&value) {
        assert!(proxy["transport"]["tls"].get("server_name").is_none());
        assert!(
            proxy["transport"]["tls"]
                .get("insecure_skip_verify")
                .is_none()
        );
        assert_eq!(proxy["transport"]["tls"]["ca"]["provider"], "file");
    }
    target.upstream_pool.as_mut().unwrap().members[1].host = "192.0.2.12".into();
    assert_eq!(
        validate_proxy_config(request(vec![target.clone()])),
        Err(ProxyValidationError::ValidationFailed)
    );
    target.upstream_tls.as_mut().unwrap().server_name = Some("backend.internal".into());
    assert!(validate_proxy_config(request(vec![target])).is_ok());
}
