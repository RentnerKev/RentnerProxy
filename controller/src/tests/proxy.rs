use super::fixtures::{host, request, request_with_settings};
use crate::{
    models::{ProxyHttpSettings, UpstreamTls},
    proxy::{
        ProxyValidationError, revision_for_configuration,
        revision_for_configuration_with_redirects, validate_proxy_config,
    },
};

#[test]
fn accepts_only_v7_and_returns_canonical_hosts() {
    let mut first = host(
        "018f4b4a-7d1f-7abc-8def-0123456789ab",
        &["b.example", "a.example"],
        "http",
        "127.0.0.1",
        8080,
    );
    let second = host(
        "018f4b4a-7d1f-7abc-8def-1123456789ab",
        &["c.example"],
        "http",
        "127.0.0.1",
        8081,
    );
    let request = request(vec![second, first.clone()]);
    let validated = validate_proxy_config(request).expect("v7 request should validate");
    assert_eq!(validated.proxy_hosts[0].id, first.id);
    first.domains.sort_unstable();
    assert_eq!(validated.proxy_hosts[0].domains, first.domains);
}

#[test]
fn v7_revision_matches_the_typescript_proxy_known_vector() {
    // Same fixture and digest as web/src/tests/proxy-runtime.test.ts.
    let hosts = vec![host(
        "018f2f52-7c1b-7cc0-9f3c-6a9952c54019",
        &["www.demo.test", "demo.test"],
        "http",
        "backend.internal",
        4_000,
    )];
    assert_eq!(
        revision_for_configuration(&hosts, &ProxyHttpSettings::default()),
        "sha256:7b3e586f596ea7a1ffacad33824b96234e23802d12f3741e73025bf8a23a4a06"
    );
}

#[test]
fn v7_revision_matches_the_typescript_redirect_known_vector() {
    // Same deliberately unsorted fixture as web/src/tests/redirect-hosts-runtime.test.ts.
    let hosts = vec![host(
        "018f2f52-7c1b-7cc0-9f3c-6a9952c54019",
        &["proxy.test"],
        "http",
        "backend.internal",
        4_000,
    )];
    let redirects = vec![
        crate::models::RedirectHost {
            id: "018f2f52-7c1b-7cc0-9f3c-6a9952c54021".into(),
            domains: vec!["z.redirect.test".into(), "a.redirect.test".into()],
            destination: "http://other.test/".into(),
            status_code: 301,
            preserve_request_uri: false,
            certificate_id: None,
        },
        crate::models::RedirectHost {
            id: "018f2f52-7c1b-7cc0-9f3c-6a9952c54020".into(),
            domains: vec!["redirect.test".into()],
            destination: "https://destination.test/base".into(),
            status_code: 308,
            preserve_request_uri: true,
            certificate_id: None,
        },
    ];
    assert_eq!(
        revision_for_configuration_with_redirects(
            &hosts,
            &redirects,
            &ProxyHttpSettings::default(),
            &[],
        ),
        "sha256:decf69ae5305d1e5f590d0b48510cc06154864d9f94c2549060e030add5dee93"
    );
}

#[test]
fn rejects_legacy_and_unknown_snapshot_versions() {
    let hosts = vec![host(
        "018f4b4a-7d1f-7abc-8def-0123456789ab",
        &["a.example"],
        "http",
        "127.0.0.1",
        8080,
    )];
    for version in [0, 1, 2, 3, 4, 5, 6, 8, 255] {
        let mut request = request(hosts.clone());
        request.version = version;
        assert_eq!(
            validate_proxy_config(request),
            Err(ProxyValidationError::InvalidConfiguration)
        );
    }
}

#[test]
fn advanced_config_is_rejected_by_the_snapshot_schema() {
    let value = serde_json::json!({
        "version": 7,
        "revision": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
        "proxyHosts": [{
            "id": "018f4b4a-7d1f-7abc-8def-0123456789ab",
            "domains": ["a.example"],
            "forwardScheme": "http",
            "forwardHost": "127.0.0.1",
            "forwardPort": 8080,
            "advancedConfig": "return 200;"
        }],
        "redirectHosts": [], "httpSettings": {}, "trustedCas": []
    });
    assert!(serde_json::from_value::<crate::models::ProxyConfigRequest>(value).is_err());
}

#[test]
fn revision_is_v7_and_changes_for_every_snapshot_field() {
    let hosts = vec![host(
        "018f4b4a-7d1f-7abc-8def-0123456789ab",
        &["a.example"],
        "http",
        "127.0.0.1",
        8080,
    )];
    let base = revision_for_configuration(&hosts, &ProxyHttpSettings::default());
    assert!(base.starts_with("sha256:"));
    let settings = ProxyHttpSettings {
        client_max_body_size_bytes: Some(1_024),
        ..Default::default()
    };
    assert_ne!(base, revision_for_configuration(&hosts, &settings));
}

#[test]
fn rejects_per_host_send_and_keepalive_overrides() {
    for (send, keepalive) in [(Some(1), None), (None, Some(1))] {
        let mut h = host(
            "018f4b4a-7d1f-7abc-8def-0123456789ab",
            &["a.example"],
            "http",
            "127.0.0.1",
            8080,
        );
        h.http_settings.send_timeout_seconds = send;
        h.http_settings.keepalive_timeout_seconds = keepalive;
        assert_eq!(
            validate_proxy_config(request(vec![h])),
            Err(ProxyValidationError::ValidationFailed)
        );
    }
}

#[test]
fn https_upstreams_require_explicit_tls_policy_and_matching_ca() {
    let mut h = host(
        "018f4b4a-7d1f-7abc-8def-0123456789ab",
        &["a.example"],
        "https",
        "backend.example",
        443,
    );
    assert_eq!(
        validate_proxy_config(request(vec![h.clone()])),
        Err(ProxyValidationError::ValidationFailed)
    );
    h.upstream_tls = Some(UpstreamTls {
        verify: false,
        server_name: None,
        trusted_ca_id: None,
    });
    assert!(validate_proxy_config(request(vec![h])).is_ok());
}

#[test]
fn revision_includes_redirects_and_global_settings() {
    let hosts = vec![host(
        "018f4b4a-7d1f-7abc-8def-0123456789ab",
        &["a.example"],
        "http",
        "127.0.0.1",
        8080,
    )];
    let redirects = vec![crate::models::RedirectHost {
        id: "018f4b4a-7d1f-7abc-8def-1123456789ab".into(),
        domains: vec!["b.example".into()],
        destination: "https://target.example".into(),
        status_code: 301,
        preserve_request_uri: false,
        certificate_id: None,
    }];
    let a = revision_for_configuration_with_redirects(
        &hosts,
        &redirects,
        &ProxyHttpSettings::default(),
        &[],
    );
    let b =
        revision_for_configuration_with_redirects(&hosts, &[], &ProxyHttpSettings::default(), &[]);
    assert_ne!(a, b);
    let request = request_with_settings(
        hosts,
        ProxyHttpSettings {
            send_timeout_seconds: Some(3),
            ..Default::default()
        },
    );
    assert!(validate_proxy_config(request).is_ok());
}
