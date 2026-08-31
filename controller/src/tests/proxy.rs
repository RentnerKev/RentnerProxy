use crate::{
    models::{ProxyConfigRequest, ProxyHttpSettings},
    proxy::{
        MAX_ADVANCED_CONFIG_BYTES, MAX_PROXY_HOSTS, ProxyValidationError,
        revision_for_configuration, revision_for_hosts, validate_proxy_config,
    },
    tests::fixtures::{host, request, request_with_settings},
};

#[test]
fn validates_a_canonical_snapshot_and_sorts_it() {
    let first = host(
        "10000000-0000-0000-0000-000000000000",
        &["z.example.test", "a.example.test"],
        "http",
        "backend.internal",
        4_000,
    );
    let second = host(
        "00000000-0000-0000-0000-000000000000",
        &["other.test"],
        "https",
        "2001:db8::1",
        4_443,
    );
    let validated = validate_proxy_config(request(vec![first, second]));
    let validated = validated.unwrap_or_else(|error| panic!("snapshot should validate: {error:?}"));

    assert_eq!(
        validated.proxy_hosts[0].id,
        "00000000-0000-0000-0000-000000000000"
    );
    assert_eq!(
        validated.proxy_hosts[1].domains,
        ["a.example.test", "z.example.test"]
    );
}

#[test]
fn versioned_revisions_are_stable_and_cross_language_compatible() {
    let legacy_hosts = vec![host(
        "018f2f52-7c1b-7cc0-9f3c-6a9952c54019",
        &["www.demo.test", "demo.test"],
        "http",
        "backend.internal",
        4_000,
    )];
    let legacy = request(legacy_hosts.clone());
    assert_eq!(legacy.version, 1);
    assert_eq!(legacy.revision, revision_for_hosts(&legacy_hosts));
    assert_eq!(
        legacy.revision,
        "sha256:94a8eb29658512ed7439838b334ef5ce7e5e2e43f50b46d3e85579e49bd554b4"
    );
    assert!(
        !serde_json::to_string(&legacy)
            .unwrap_or_default()
            .contains("httpSettings")
    );

    let hosts = vec![host(
        "00000000-0000-0000-0000-000000000000",
        &["demo.test"],
        "http",
        "backend",
        4_000,
    )];
    let http_settings = ProxyHttpSettings {
        client_max_body_size_bytes: Some(10_485_760),
        proxy_connect_timeout_seconds: Some(15),
        proxy_read_timeout_seconds: Some(300),
        proxy_send_timeout_seconds: Some(300),
        send_timeout_seconds: Some(30),
        keepalive_timeout_seconds: Some(75),
    };
    let revision = revision_for_configuration(&hosts, &http_settings);
    assert_eq!(
        revision,
        "sha256:40649ed0f53ecbceb0c0c651df025f3400662c9a492e0d7baf41fe48705e47cc"
    );
    let request = request_with_settings(hosts, http_settings);
    assert_eq!(request.version, 2);
    assert_eq!(request.revision, revision);
    assert!(validate_proxy_config(request).is_ok());
}

#[test]
fn rejects_invalid_http_settings_versions_bounds_and_fields() {
    let hosts = vec![host(
        "00000000-0000-0000-0000-000000000000",
        &["demo.test"],
        "http",
        "backend",
        4_000,
    )];
    let mut version_one_with_settings = request_with_settings(
        hosts.clone(),
        ProxyHttpSettings {
            send_timeout_seconds: Some(30),
            ..ProxyHttpSettings::default()
        },
    );
    version_one_with_settings.version = 1;
    assert_eq!(
        validate_proxy_config(version_one_with_settings),
        Err(ProxyValidationError::InvalidConfiguration)
    );

    let mut empty_version_two = request(hosts.clone());
    empty_version_two.version = 2;
    assert_eq!(
        validate_proxy_config(empty_version_two),
        Err(ProxyValidationError::InvalidConfiguration)
    );

    let out_of_range = request_with_settings(
        hosts.clone(),
        ProxyHttpSettings {
            client_max_body_size_bytes: Some(1_023),
            ..ProxyHttpSettings::default()
        },
    );
    assert_eq!(
        validate_proxy_config(out_of_range),
        Err(ProxyValidationError::ValidationFailed)
    );

    let unknown = r#"{"version":2,"revision":"sha256:0000000000000000000000000000000000000000000000000000000000000000","proxyHosts":[],"httpSettings":{"resolver":"127.0.0.1"}}"#;
    assert!(serde_json::from_str::<ProxyConfigRequest>(unknown).is_err());
    let duplicate = r#"{"version":2,"revision":"sha256:0000000000000000000000000000000000000000000000000000000000000000","proxyHosts":[],"httpSettings":{"sendTimeoutSeconds":10,"sendTimeoutSeconds":20}}"#;
    assert!(serde_json::from_str::<ProxyConfigRequest>(duplicate).is_err());
}

#[test]
fn detects_hash_spoofing() {
    let mut request = request(vec![host(
        "00000000-0000-0000-0000-000000000000",
        &["demo.test"],
        "http",
        "backend",
        4_000,
    )]);
    request.proxy_hosts[0].forward_port = 4_001;

    assert_eq!(
        validate_proxy_config(request),
        Err(ProxyValidationError::ValidationFailed)
    );
}

#[test]
fn rejects_duplicates_and_injection() {
    let shared = "demo.test";
    let duplicate = request(vec![
        host(
            "00000000-0000-0000-0000-000000000000",
            &[shared],
            "http",
            "backend",
            4_000,
        ),
        host(
            "10000000-0000-0000-0000-000000000000",
            &[shared],
            "http",
            "backend",
            4_000,
        ),
    ]);
    assert_eq!(
        validate_proxy_config(duplicate),
        Err(ProxyValidationError::ValidationFailed)
    );

    let injected = request(vec![host(
        "00000000-0000-0000-0000-000000000000",
        &["demo.test"],
        "http",
        "backend; return 200",
        4_000,
    )]);
    assert_eq!(
        validate_proxy_config(injected),
        Err(ProxyValidationError::ValidationFailed)
    );
}

#[test]
fn rejects_invalid_limits_scheme_ports_and_noncanonical_values() {
    let mut invalid = request(vec![host(
        "00000000-0000-0000-0000-000000000000",
        &["Demo.test"],
        "ftp",
        "[2001:db8::1]",
        0,
    )]);
    invalid.revision = "sha256:not-a-hash".to_owned();
    assert_eq!(
        validate_proxy_config(invalid),
        Err(ProxyValidationError::InvalidConfiguration)
    );

    let hosts = (0..=MAX_PROXY_HOSTS)
        .map(|index| {
            host(
                &format!("00000000-0000-0000-0000-{index:012x}"),
                &["demo.test"],
                "http",
                "backend",
                80,
            )
        })
        .collect();
    assert_eq!(
        validate_proxy_config(request(hosts)),
        Err(ProxyValidationError::ValidationFailed)
    );
}

#[test]
fn v3_host_settings_and_advanced_config_hashes_match_the_web_snapshot() {
    let mut settings_only_host = host(
        "00000000-0000-0000-0000-000000000000",
        &["demo.test"],
        "http",
        "backend",
        4_000,
    );
    settings_only_host.http_settings = ProxyHttpSettings {
        proxy_read_timeout_seconds: Some(300),
        send_timeout_seconds: Some(30),
        ..ProxyHttpSettings::default()
    };
    let global_settings = ProxyHttpSettings {
        client_max_body_size_bytes: Some(10_485_760),
        proxy_connect_timeout_seconds: Some(15),
        ..ProxyHttpSettings::default()
    };
    let settings_only =
        request_with_settings(vec![settings_only_host.clone()], global_settings.clone());
    assert_eq!(settings_only.version, 3);
    assert_eq!(
        settings_only.revision,
        "sha256:781f8c0b122b57b9cc2d758666ca28d30c92b2bbbfe6414f980b92aaecdb430c"
    );
    assert!(validate_proxy_config(settings_only).is_ok());

    settings_only_host.advanced_config = "# expert config\nadd_header X-Test \"hello\" always;\nlocation = /advanced-test {\n    return 200 \"advanced-ok\";\n}\n".to_owned();
    let request = request_with_settings(vec![settings_only_host], global_settings);
    assert_eq!(request.version, 3);
    assert_eq!(
        request.revision,
        "sha256:07a13b9537067ccfc5d31342cb5e58f05defad63948733269767ee02bd062199"
    );
    assert!(validate_proxy_config(request).is_ok());
}

#[test]
fn advanced_config_normalizes_only_crlf_and_enforces_its_bound() {
    let mut crlf_host = host(
        "00000000-0000-0000-0000-000000000000",
        &["demo.test"],
        "http",
        "backend",
        4_000,
    );
    crlf_host.advanced_config = "  # preserve surrounding whitespace  \r\n".to_owned();
    let crlf_request = request(vec![crlf_host.clone()]);
    let validated = validate_proxy_config(crlf_request).unwrap();
    assert_eq!(
        validated.proxy_hosts[0].advanced_config,
        "  # preserve surrounding whitespace  \n"
    );

    let mut lf_host = crlf_host.clone();
    lf_host.advanced_config = "  # preserve surrounding whitespace  \n".to_owned();
    assert_eq!(
        revision_for_configuration(&[crlf_host], &ProxyHttpSettings::default()),
        revision_for_configuration(&[lf_host], &ProxyHttpSettings::default())
    );

    let mut nul_host = host(
        "00000000-0000-0000-0000-000000000000",
        &["demo.test"],
        "http",
        "backend",
        4_000,
    );
    nul_host.advanced_config = "return 200;\0".to_owned();
    assert_eq!(
        validate_proxy_config(request(vec![nul_host])),
        Err(ProxyValidationError::ValidationFailed)
    );

    let mut too_large_host = host(
        "00000000-0000-0000-0000-000000000000",
        &["demo.test"],
        "http",
        "backend",
        4_000,
    );
    too_large_host.advanced_config = "x".repeat(MAX_ADVANCED_CONFIG_BYTES + 1);
    assert_eq!(
        validate_proxy_config(request(vec![too_large_host])),
        Err(ProxyValidationError::ValidationFailed)
    );

    let mut no_host_configuration = request(vec![host(
        "00000000-0000-0000-0000-000000000000",
        &["demo.test"],
        "http",
        "backend",
        4_000,
    )]);
    no_host_configuration.version = 3;
    assert_eq!(
        validate_proxy_config(no_host_configuration),
        Err(ProxyValidationError::InvalidConfiguration)
    );

    let mut host_configuration_in_v2 = request_with_settings(
        vec![{
            let mut host = host(
                "00000000-0000-0000-0000-000000000000",
                &["demo.test"],
                "http",
                "backend",
                4_000,
            );
            host.advanced_config = "return 204;".to_owned();
            host
        }],
        ProxyHttpSettings::default(),
    );
    host_configuration_in_v2.version = 2;
    assert_eq!(
        validate_proxy_config(host_configuration_in_v2),
        Err(ProxyValidationError::InvalidConfiguration)
    );
}
