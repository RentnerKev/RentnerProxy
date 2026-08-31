use crate::{
    proxy::{MAX_PROXY_HOSTS, ProxyValidationError, validate_proxy_config},
    tests::fixtures::{host, request},
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
