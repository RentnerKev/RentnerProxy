use super::fixtures::{host, request};
use crate::{
    models::{
        AccessPolicy, AccessPolicyMode, IpDefaultAction, IpRules, ProxyConfigRequest,
        ProxyHttpSettings, RedirectHost,
    },
    proxy::{
        MAX_PROXY_HOSTS, ProxyValidationError, revision_for_configuration,
        revision_for_configuration_with_redirects, validate_proxy_config, validate_trusted_ca_pem,
    },
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

fn v7_request(
    proxy_hosts: Vec<crate::models::ProxyHost>,
    redirect_hosts: Vec<RedirectHost>,
) -> ProxyConfigRequest {
    let http_settings = ProxyHttpSettings::default();
    let trusted_cas = Vec::new();
    ProxyConfigRequest {
        version: 7,
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

fn request_with_ip_rules(rules: IpRules) -> ProxyConfigRequest {
    let mut request = request(vec![host(
        "00000000-0000-0000-0000-000000000000",
        &["demo.test"],
        "http",
        "backend",
        4_000,
    )]);
    request.proxy_hosts[0].access_policy = Some(AccessPolicy {
        id: "0198d98a-0000-7000-8000-000000000001".to_owned(),
        mode: AccessPolicyMode::IpRestricted,
        combination: None,
        basic_auth: None,
        ip_rules: Some(rules),
    });
    request.revision = revision_for_configuration(&request.proxy_hosts, &request.http_settings);
    request
}

#[test]
fn ip_rules_require_canonical_sorted_non_mapped_cidrs_with_bounded_lists() {
    let valid = request_with_ip_rules(IpRules {
        default_action: IpDefaultAction::Deny,
        allow: vec!["192.0.2.0/24".into(), "2001:db8::/32".into()],
        deny: vec!["192.0.2.128/25".into()],
    });
    assert!(validate_proxy_config(valid).is_ok());
    assert!(
        validate_proxy_config(request_with_ip_rules(IpRules {
            default_action: IpDefaultAction::Allow,
            allow: vec!["::/0".into()],
            deny: vec![],
        }))
        .is_ok()
    );

    for rules in [
        IpRules {
            default_action: IpDefaultAction::Deny,
            allow: vec!["192.0.2.1/24".into()],
            deny: vec![],
        },
        IpRules {
            default_action: IpDefaultAction::Deny,
            allow: vec!["::ffff:192.0.2.0/120".into()],
            deny: vec![],
        },
        IpRules {
            default_action: IpDefaultAction::Deny,
            allow: vec!["2001:db8::/32".into(), "192.0.2.0/24".into()],
            deny: vec![],
        },
        IpRules {
            default_action: IpDefaultAction::Deny,
            allow: (0..=128)
                .map(|value| format!("192.0.2.{value}/32"))
                .collect(),
            deny: vec![],
        },
    ] {
        assert_eq!(
            validate_proxy_config(request_with_ip_rules(rules)),
            Err(ProxyValidationError::ValidationFailed)
        );
    }
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
fn v7_accepts_only_the_supported_redirect_status_codes() {
    for status_code in [301, 302, 307, 308] {
        let mut redirect = redirect_host(
            "00000000-0000-0000-0000-000000000000",
            &["status.test"],
            "https://target.test",
        );
        redirect.status_code = status_code;
        assert!(validate_proxy_config(v7_request(Vec::new(), vec![redirect])).is_ok());
    }

    for status_code in [0, 300, 303, 304, 305, 306, 309, 999] {
        let mut redirect = redirect_host(
            "00000000-0000-0000-0000-000000000000",
            &["status.test"],
            "https://target.test",
        );
        redirect.status_code = status_code;
        assert_eq!(
            validate_proxy_config(v7_request(Vec::new(), vec![redirect])),
            Err(ProxyValidationError::ValidationFailed),
            "unexpectedly accepted redirect status {status_code}"
        );
    }
}

#[test]
fn v7_rejects_unsafe_destinations_and_accepts_valid_encoded_unicode() {
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
        let mut request = v7_request(Vec::new(), vec![redirect]);
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
        let mut request = v7_request(Vec::new(), vec![redirect]);
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
        validate_proxy_config(v7_request(Vec::new(), vec![redirect])),
        Err(ProxyValidationError::ValidationFailed)
    );
}

#[test]
fn v7_enforces_cross_type_identity_domain_and_host_limits() {
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
        validate_proxy_config(v7_request(vec![proxy.clone()], vec![duplicate_id])),
        Err(ProxyValidationError::ValidationFailed)
    );

    let duplicate_domain = redirect_host(
        "10000000-0000-0000-0000-000000000000",
        &["shared.test"],
        "https://target.test",
    );
    assert_eq!(
        validate_proxy_config(v7_request(vec![proxy.clone()], vec![duplicate_domain])),
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
        version: 7,
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
