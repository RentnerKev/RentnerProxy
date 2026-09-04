use crate::{
    models::{ProxyConfigRequest, ProxyHttpSettings, RedirectHost, TrustedCa, UpstreamTls},
    proxy::{
        MAX_ADVANCED_CONFIG_BYTES, MAX_PROXY_HOSTS, ProxyValidationError,
        revision_for_configuration, revision_for_configuration_with_redirects,
        revision_for_configuration_with_trusted_cas, revision_for_hosts, validate_proxy_config,
        validate_trusted_ca_pem,
    },
    tests::fixtures::{host, request, request_with_settings},
};

fn redirect_host(id: &str, domains: &[&str], destination: &str) -> RedirectHost {
    RedirectHost {
        id: id.to_owned(),
        domains: domains.iter().map(|domain| (*domain).to_owned()).collect(),
        destination: destination.to_owned(),
        status_code: 308,
        preserve_request_uri: false,
        certificate_id: None,
    }
}

fn v6_request(
    proxy_hosts: Vec<crate::models::ProxyHost>,
    redirect_hosts: Vec<RedirectHost>,
) -> ProxyConfigRequest {
    let http_settings = ProxyHttpSettings::default();
    let trusted_cas = Vec::new();
    ProxyConfigRequest {
        version: 6,
        revision: revision_for_configuration_with_redirects(
            &proxy_hosts,
            &redirect_hosts,
            &http_settings,
            &trusted_cas,
        ),
        proxy_hosts,
        redirect_hosts,
        http_settings,
        trusted_cas,
    }
}

#[test]
fn validates_a_canonical_snapshot_and_sorts_it() {
    let first = host(
        "10000000-0000-0000-0000-000000000000",
        &["z.example.test", "a.example.test"],
        "http",
        "backend.internal",
        4_000,
    );
    let mut second = host(
        "00000000-0000-0000-0000-000000000000",
        &["other.test"],
        "https",
        "2001:db8::1",
        4_443,
    );
    second.upstream_tls = Some(UpstreamTls {
        verify: true,
        server_name: Some("backend.internal".to_owned()),
        trusted_ca_id: None,
    });
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
fn v4_tls_snapshot_matches_the_web_hash_vector() {
    let mut host = host(
        "018f2f52-7c1b-7cc0-9f3c-6a9952c54019",
        &["demo.test", "www.demo.test"],
        "http",
        "backend.internal",
        4_000,
    );
    host.certificate_id = Some("0198d98a-0000-7000-8000-000000000001".to_owned());
    host.force_https = true;
    let request = request(vec![host]);
    assert_eq!(request.version, 4);
    assert_eq!(
        request.revision,
        "sha256:60ef13937bd04f3c5636c01b13c37431192b04fa7c9ba277e2dd4d89afe9c279"
    );
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

fn test_ca_pem() -> String {
    let mut parameters = rcgen::CertificateParams::new(vec!["test-ca.internal".to_owned()])
        .expect("test CA names should be valid");
    parameters.is_ca = rcgen::IsCa::Ca(rcgen::BasicConstraints::Unconstrained);
    parameters.key_usages = vec![rcgen::KeyUsagePurpose::KeyCertSign];
    let key_pair = rcgen::KeyPair::generate().expect("test CA key should generate");
    parameters
        .self_signed(&key_pair)
        .expect("test CA certificate should generate")
        .pem()
}

fn trusted_ca(id: &str) -> TrustedCa {
    let parsed = validate_trusted_ca_pem(&test_ca_pem()).expect("test CA should validate");
    TrustedCa {
        id: id.to_owned(),
        pem: parsed.pem,
        fingerprint_sha256: parsed.fingerprint_sha256,
    }
}

fn v5_request(host: crate::models::ProxyHost, trusted_cas: Vec<TrustedCa>) -> ProxyConfigRequest {
    let hosts = vec![host];
    let http_settings = ProxyHttpSettings::default();
    ProxyConfigRequest {
        version: 5,
        revision: revision_for_configuration_with_trusted_cas(&hosts, &http_settings, &trusted_cas),
        proxy_hosts: hosts,
        redirect_hosts: Vec::new(),
        http_settings,
        trusted_cas,
    }
}

#[test]
fn v5_upstream_tls_snapshot_requires_explicit_valid_settings_and_changes_revision() {
    let mut host = host(
        "018f2f52-7c1b-7cc0-9f3c-6a9952c54019",
        &["demo.test"],
        "https",
        "backend.internal",
        4_443,
    );
    host.upstream_tls = Some(UpstreamTls {
        verify: true,
        server_name: None,
        trusted_ca_id: None,
    });
    let system_trust = v5_request(host.clone(), Vec::new());
    assert!(validate_proxy_config(system_trust.clone()).is_ok());
    assert!(
        serde_json::to_string(&system_trust)
            .expect("snapshot should serialize")
            .contains("\"upstreamTls\":{\"verify\":true,\"serverName\":null,\"trustedCaId\":null}")
    );

    let mut disabled = host.clone();
    disabled
        .upstream_tls
        .as_mut()
        .expect("settings exist")
        .verify = false;
    assert_ne!(
        system_trust.revision,
        v5_request(disabled, Vec::new()).revision,
        "verification changes must cause a reload"
    );

    let mut named = host.clone();
    named
        .upstream_tls
        .as_mut()
        .expect("settings exist")
        .server_name = Some("tls.backend.internal".to_owned());
    assert_ne!(
        system_trust.revision,
        v5_request(named, Vec::new()).revision,
        "TLS identity changes must cause a reload"
    );

    let ca = trusted_ca("0198d98a-0000-7000-8000-000000000001");
    let mut custom_trust = host;
    custom_trust
        .upstream_tls
        .as_mut()
        .expect("settings exist")
        .trusted_ca_id = Some(ca.id.clone());
    let custom_trust = v5_request(custom_trust, vec![ca]);
    assert!(validate_proxy_config(custom_trust.clone()).is_ok());
    assert_ne!(
        system_trust.revision, custom_trust.revision,
        "selected trust material must affect the revision"
    );
}

#[test]
fn v5_upstream_tls_handles_ip_targets_and_custom_ca_references_safely() {
    let mut ip_host = host(
        "018f2f52-7c1b-7cc0-9f3c-6a9952c54019",
        &["demo.test"],
        "https",
        "10.10.0.25",
        4_443,
    );
    ip_host.upstream_tls = Some(UpstreamTls {
        verify: true,
        server_name: None,
        trusted_ca_id: None,
    });
    assert_eq!(
        validate_proxy_config(v5_request(ip_host.clone(), Vec::new())),
        Err(ProxyValidationError::ValidationFailed)
    );

    ip_host
        .upstream_tls
        .as_mut()
        .expect("settings exist")
        .server_name = Some("nas.internal.example".to_owned());
    assert!(validate_proxy_config(v5_request(ip_host.clone(), Vec::new())).is_ok());

    ip_host
        .upstream_tls
        .as_mut()
        .expect("settings exist")
        .verify = false;
    ip_host
        .upstream_tls
        .as_mut()
        .expect("settings exist")
        .server_name = None;
    assert!(validate_proxy_config(v5_request(ip_host.clone(), Vec::new())).is_ok());

    let unknown_ca = "0198d98a-0000-7000-8000-000000000001";
    ip_host
        .upstream_tls
        .as_mut()
        .expect("settings exist")
        .trusted_ca_id = Some(unknown_ca.to_owned());
    assert_eq!(
        validate_proxy_config(v5_request(ip_host, Vec::new())),
        Err(ProxyValidationError::ValidationFailed),
        "custom trust cannot silently coexist with disabled verification"
    );
}

#[test]
fn trusted_ca_validation_rejects_private_key_and_trailing_der_data() {
    let key_pair = rcgen::KeyPair::generate().expect("test key should generate");
    assert!(validate_trusted_ca_pem(&key_pair.serialize_pem()).is_err());

    let mut parameters = rcgen::CertificateParams::new(vec!["test-ca.internal".to_owned()])
        .expect("test CA names should be valid");
    parameters.is_ca = rcgen::IsCa::Ca(rcgen::BasicConstraints::Unconstrained);
    parameters.key_usages = vec![rcgen::KeyUsagePurpose::KeyCertSign];
    let key_pair = rcgen::KeyPair::generate().expect("test CA key should generate");
    let certificate = parameters
        .self_signed(&key_pair)
        .expect("test CA certificate should generate");
    let mut malformed_der = certificate.der().as_ref().to_vec();
    malformed_der.extend_from_slice(&[0, 1, 2]);
    let malformed_pem = format!(
        "-----BEGIN CERTIFICATE-----\n{}\n-----END CERTIFICATE-----\n",
        base64_encode(&malformed_der)
    );
    assert!(validate_trusted_ca_pem(&malformed_pem).is_err());
}

fn base64_encode(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut output = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let first = chunk[0];
        let second = *chunk.get(1).unwrap_or(&0);
        let third = *chunk.get(2).unwrap_or(&0);
        output.push(char::from(TABLE[usize::from(first >> 2)]));
        output.push(char::from(
            TABLE[usize::from(((first & 0b0000_0011) << 4) | (second >> 4))],
        ));
        output.push(if chunk.len() > 1 {
            char::from(TABLE[usize::from(((second & 0b0000_1111) << 2) | (third >> 6))])
        } else {
            '='
        });
        output.push(if chunk.len() > 2 {
            char::from(TABLE[usize::from(third & 0b0011_1111)])
        } else {
            '='
        });
    }
    output
}
#[test]
fn v6_canonicalizes_redirect_hosts_and_keeps_legacy_revisions_compatible() {
    let proxy = host(
        "00000000-0000-0000-0000-000000000000",
        &["proxy.test"],
        "http",
        "backend",
        4_000,
    );
    let mut first = redirect_host(
        "10000000-0000-0000-0000-000000000000",
        &["z.redirect.test", "a.redirect.test"],
        "https://first.target.test",
    );
    first.status_code = 301;
    first.preserve_request_uri = true;
    let mut second = redirect_host(
        "00000000-0000-0000-0000-000000000001",
        &["second.redirect.test"],
        "https://second.target.test/landing?source=redirect",
    );
    second.status_code = 302;

    let validated = validate_proxy_config(v6_request(
        vec![proxy.clone()],
        vec![first.clone(), second.clone()],
    ))
    .expect("v6 redirect snapshot should validate");
    assert_eq!(validated.proxy_hosts, vec![proxy]);
    assert_eq!(validated.redirect_hosts[0].id, second.id);
    assert_eq!(
        validated.redirect_hosts[1].domains,
        ["a.redirect.test", "z.redirect.test"]
    );

    let revision = revision_for_configuration_with_redirects(
        &validated.proxy_hosts,
        &[first, second],
        &validated.http_settings,
        &validated.trusted_cas,
    );
    assert_eq!(revision, validated.revision);

    let legacy = request(vec![host(
        "018f2f52-7c1b-7cc0-9f3c-6a9952c54019",
        &["legacy.test"],
        "http",
        "backend",
        4_000,
    )]);
    assert_eq!(legacy.version, 1);
    assert_eq!(legacy.revision, revision_for_hosts(&legacy.proxy_hosts));
}

#[test]
fn v6_accepts_only_the_supported_redirect_status_codes() {
    for status_code in [301, 302, 307, 308] {
        let mut redirect = redirect_host(
            "00000000-0000-0000-0000-000000000000",
            &["status.test"],
            "https://target.test",
        );
        redirect.status_code = status_code;
        assert!(validate_proxy_config(v6_request(Vec::new(), vec![redirect])).is_ok());
    }

    for status_code in [0, 300, 303, 304, 305, 306, 309, 999] {
        let mut redirect = redirect_host(
            "00000000-0000-0000-0000-000000000000",
            &["status.test"],
            "https://target.test",
        );
        redirect.status_code = status_code;
        assert_eq!(
            validate_proxy_config(v6_request(Vec::new(), vec![redirect])),
            Err(ProxyValidationError::ValidationFailed),
            "unexpectedly accepted redirect status {status_code}"
        );
    }
}

#[test]
fn v6_rejects_unsafe_destinations_and_accepts_valid_encoded_unicode() {
    for (destination, preserve_request_uri) in [
        ("ftp://target.test", false),
        ("https:///missing-authority", false),
        ("https://user@target.test", false),
        ("https://target.test/has space", false),
        ("https://target.test/$variable", false),
        ("https://target.test/\"quote", false),
        ("https://target.test/'quote", false),
        ("https://target.test/\\slash", false),
        ("https://target.test/{block}", false),
        ("https://target.test/%", false),
        ("https://target.test/%0", false),
        ("https://target.test/%0g", false),
        ("https://target.test/%0d%0aheader", false),
        ("https://target.test/%00", false),
        ("https://target.test/%C2%80", false),
        ("https://target.test/%ff", false),
        ("https://target.test:0", false),
        ("https://target.test:65536", false),
        ("https://[2001:db8::1", false),
        ("https://target.test/", true),
        ("https://target.test/path?query", true),
        ("https://target.test/path#fragment", true),
    ] {
        let redirect = redirect_host(
            "00000000-0000-0000-0000-000000000000",
            &["unsafe.test"],
            destination,
        );
        let mut request = v6_request(Vec::new(), vec![redirect]);
        request.redirect_hosts[0].preserve_request_uri = preserve_request_uri;
        request.revision = revision_for_configuration_with_redirects(
            &request.proxy_hosts,
            &request.redirect_hosts,
            &request.http_settings,
            &request.trusted_cas,
        );
        assert_eq!(
            validate_proxy_config(request),
            Err(ProxyValidationError::ValidationFailed),
            "unexpectedly accepted destination {destination:?}"
        );
    }

    for (destination, preserve_request_uri) in [
        ("https://target.test", true),
        ("https://target.test/landing?source=redirect#top", false),
        ("http://[2001:db8::1]:8080", true),
        ("https://target.test/%E2%82%AC", false),
    ] {
        let redirect = redirect_host(
            "00000000-0000-0000-0000-000000000000",
            &["safe.test"],
            destination,
        );
        let mut request = v6_request(Vec::new(), vec![redirect]);
        request.redirect_hosts[0].preserve_request_uri = preserve_request_uri;
        request.revision = revision_for_configuration_with_redirects(
            &request.proxy_hosts,
            &request.redirect_hosts,
            &request.http_settings,
            &request.trusted_cas,
        );
        assert!(
            validate_proxy_config(request).is_ok(),
            "unexpectedly rejected destination {destination:?}"
        );
    }

    let too_long = format!("https://target.test/{}", "a".repeat(2_048));
    let redirect = redirect_host(
        "00000000-0000-0000-0000-000000000000",
        &["long.test"],
        &too_long,
    );
    assert_eq!(
        validate_proxy_config(v6_request(Vec::new(), vec![redirect])),
        Err(ProxyValidationError::ValidationFailed)
    );
}

#[test]
fn v1_through_v5_reject_redirects_and_v6_requires_them() {
    for version in 1..=5 {
        let mut request = v6_request(
            Vec::new(),
            vec![redirect_host(
                "00000000-0000-0000-0000-000000000000",
                &["legacy-version.test"],
                "https://target.test",
            )],
        );
        request.version = version;
        assert_eq!(
            validate_proxy_config(request),
            Err(ProxyValidationError::InvalidConfiguration),
            "v{version} must not accept redirect hosts"
        );
    }

    let mut missing_redirects = request(Vec::new());
    missing_redirects.version = 6;
    assert_eq!(
        validate_proxy_config(missing_redirects),
        Err(ProxyValidationError::InvalidConfiguration)
    );
}

#[test]
fn v6_enforces_cross_type_identity_domain_and_host_limits() {
    let proxy = host(
        "00000000-0000-0000-0000-000000000000",
        &["shared.test"],
        "http",
        "backend",
        4_000,
    );
    let duplicate_id = redirect_host(
        "00000000-0000-0000-0000-000000000000",
        &["redirect.test"],
        "https://target.test",
    );
    assert_eq!(
        validate_proxy_config(v6_request(vec![proxy.clone()], vec![duplicate_id])),
        Err(ProxyValidationError::ValidationFailed)
    );

    let duplicate_domain = redirect_host(
        "10000000-0000-0000-0000-000000000000",
        &["shared.test"],
        "https://target.test",
    );
    assert_eq!(
        validate_proxy_config(v6_request(vec![proxy.clone()], vec![duplicate_domain])),
        Err(ProxyValidationError::ValidationFailed)
    );

    let redirect_hosts = (0..MAX_PROXY_HOSTS)
        .map(|index| {
            redirect_host(
                &format!("10000000-0000-0000-0000-{index:012x}"),
                &[&format!("redirect-{index}.test")],
                "https://target.test",
            )
        })
        .collect();
    let oversized = ProxyConfigRequest {
        version: 6,
        revision: format!("sha256:{}", "0".repeat(64)),
        proxy_hosts: vec![proxy],
        redirect_hosts,
        http_settings: ProxyHttpSettings::default(),
        trusted_cas: Vec::new(),
    };
    assert_eq!(
        validate_proxy_config(oversized),
        Err(ProxyValidationError::ValidationFailed)
    );
}
#[test]
fn v6_snapshot_matches_the_typescript_known_vector() {
    let proxy = host(
        "018f2f52-7c1b-7cc0-9f3c-6a9952c54019",
        &["proxy.test"],
        "http",
        "backend.internal",
        4_000,
    );
    let mut first = redirect_host(
        "018f2f52-7c1b-7cc0-9f3c-6a9952c54020",
        &["redirect.test"],
        "https://destination.test/base",
    );
    first.preserve_request_uri = true;
    let mut second = redirect_host(
        "018f2f52-7c1b-7cc0-9f3c-6a9952c54021",
        &["z.redirect.test", "a.redirect.test"],
        "http://other.test/",
    );
    second.status_code = 301;

    assert_eq!(
        revision_for_configuration_with_redirects(
            &[proxy],
            &[second, first],
            &ProxyHttpSettings::default(),
            &[],
        ),
        "sha256:bc76b6a3a15ec41a362ad7c220fb11e168d21e0cb81dc1f23688ef2ee40083b7"
    );
}

#[test]
fn legacy_https_snapshot_without_explicit_tls_policy_is_rejected() {
    let request = request(vec![host(
        "00000000-0000-0000-0000-000000000000",
        &["demo.test"],
        "https",
        "backend.internal",
        443,
    )]);
    assert_eq!(request.version, 1);
    assert_eq!(
        validate_proxy_config(request),
        Err(ProxyValidationError::ValidationFailed)
    );
}
