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
        failover: None,
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

/// Finds pool handlers throughout nested rendered routes, including the observer
/// wrapper, so security and retry assertions cannot silently skip the new handler.
fn pool_proxies(json: &Value) -> Vec<&Value> {
    let mut proxies = Vec::new();
    match json {
        Value::Object(object) => {
            if matches!(
                object.get("handler").and_then(Value::as_str),
                Some("reverse_proxy" | "rentnerproxy_upstream")
            ) && object.contains_key("load_balancing")
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

/// Rejects malformed pools before activation, including duplicate canonical IP spellings.
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

/// Protects target priority, IPv6 dialing and the existing header/draining contract for both policies.
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

/// Verifies automatic per-DNS TLS identity and the stricter explicit-name rule for any IP member.
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

/// Constructs the shared TypeScript/Rust v9 revision vector with explicit health
/// and retry options; its fixed values make serialization drift observable.
fn with_failover() -> ProxyHost {
    use crate::models::{
        ActiveUpstreamHealth, PassiveUpstreamHealth, UpstreamFailover, UpstreamRetries,
    };
    let mut target = pooled_host();
    target.upstream_pool.as_mut().unwrap().failover = Some(UpstreamFailover {
        active: Some(ActiveUpstreamHealth {
            path: "/health".into(),
            interval_seconds: 10,
            timeout_seconds: 2,
            fails: 2,
            passes: 2,
            expected_status: 200,
        }),
        passive: Some(PassiveUpstreamHealth {
            fail_duration_seconds: 30,
            max_fails: 1,
        }),
        retries: Some(UpstreamRetries {
            max_retries: 2,
            try_duration_seconds: 5,
            try_interval_milliseconds: 250,
        }),
    });
    target
}

/// Pins the cross-language v9 hash and native Caddy health/retry representation.
/// Observer identity, fixed passive statuses and the always-false retry matcher must
/// survive rendering without buffering or enabling post-connect request replays.
#[test]
fn failover_revision_matches_web_and_runtime_uses_actual_health_without_replays() {
    let target = with_failover();
    let request = request(vec![target]);
    assert_eq!(request.version, 9);
    assert_eq!(
        request.revision,
        "sha256:f3228530e6b0bc0b0c2aa22c401dc2b5358e809fbb2eb03fbc47abf2111aa22b"
    );
    let configuration = validate_proxy_config(request).unwrap();
    let value: Value =
        serde_json::from_str(&render_config(Some(&configuration), &settings()).unwrap()).unwrap();
    let proxies = pool_proxies(&value);
    assert!(!proxies.is_empty());
    for proxy in proxies {
        assert_eq!(proxy["handler"], "rentnerproxy_upstream");
        assert_eq!(proxy["host_id"], configuration.proxy_hosts[0].id);
        assert_eq!(proxy["revision"], configuration.revision);
        assert_eq!(
            proxy["health_checks"]["active"],
            json!({"uri":"/health","interval":"10s","timeout":"2s","fails":2,"passes":2,"expect_status":200,"max_size":4096})
        );
        assert_eq!(
            proxy["health_checks"]["passive"],
            json!({"fail_duration":"30s","max_fails":1,"unhealthy_status":[502,503,504]})
        );
        assert_eq!(proxy["load_balancing"]["retries"], 2);
        assert_eq!(proxy["load_balancing"]["try_duration"], "5s");
        assert_eq!(proxy["load_balancing"]["try_interval"], "250ms");
        assert_eq!(
            proxy["load_balancing"]["retry_match"],
            json!([{"not":[{}]}])
        );
        assert_eq!(proxy["transport"]["keep_alive"], json!({"enabled":false}));
        assert!(proxy.get("request_buffers").is_none());
    }
}

/// Rejects unsafe probe targets, excessive budgets and contradictory retry settings
/// at the Rust boundary, including attempts to carry failover inside a v8 envelope.
#[test]
fn failover_validation_rejects_unbounded_unsafe_or_inconsistent_controls() {
    let valid = serde_json::to_value(with_failover()).unwrap();
    for path in [
        "https://elsewhere/health",
        "//elsewhere/health",
        "/path#fragment",
        "/path with spaces",
        "/%GG",
        "/bad\\path",
        "/{env.SECRET}",
        "",
    ] {
        let mut value = valid.clone();
        value["upstreamPool"]["failover"]["active"]["path"] = json!(path);
        let target = serde_json::from_value(value).unwrap();
        assert!(
            validate_proxy_config(request(vec![target])).is_err(),
            "{path:?}"
        );
    }
    for (block, field, value) in [
        ("active", "intervalSeconds", 4),
        ("active", "intervalSeconds", 301),
        ("active", "timeoutSeconds", 11),
        ("active", "fails", 0),
        ("active", "passes", 11),
        ("active", "expectedStatus", 500),
        ("passive", "maxFails", 0),
        ("passive", "failDurationSeconds", 301),
        ("retries", "maxRetries", 16),
        ("retries", "tryDurationSeconds", 31),
        ("retries", "tryIntervalMilliseconds", 99),
    ] {
        let mut invalid = valid.clone();
        invalid["upstreamPool"]["failover"][block][field] = json!(value);
        assert!(
            validate_proxy_config(request(vec![serde_json::from_value(invalid).unwrap()])).is_err(),
            "{block}.{field}"
        );
    }
    let mut target = with_failover();
    let pool = target.upstream_pool.as_mut().unwrap();
    pool.policy = UpstreamSelectionPolicy::First;
    pool.failover
        .as_mut()
        .unwrap()
        .passive
        .as_mut()
        .unwrap()
        .max_fails = 3;
    assert!(validate_proxy_config(request(vec![target.clone()])).is_err());
    target
        .upstream_pool
        .as_mut()
        .unwrap()
        .failover
        .as_mut()
        .unwrap()
        .passive = None;
    assert!(validate_proxy_config(request(vec![target.clone()])).is_err());
    target.upstream_pool.as_mut().unwrap().failover = Some(crate::models::UpstreamFailover {
        active: None,
        passive: None,
        retries: None,
    });
    assert!(validate_proxy_config(request(vec![target])).is_err());
    let mut wrong_version = request(vec![with_failover()]);
    wrong_version.version = 8;
    assert_eq!(
        validate_proxy_config(wrong_version),
        Err(ProxyValidationError::InvalidConfiguration)
    );
}
