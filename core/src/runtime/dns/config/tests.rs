use super::*;
use serde_json::json;

#[test]
fn hetzner_references_validate_int64_ids_and_keep_credentials_internal() {
    for zone in ["1", "42", "9223372036854775807"] {
        let value = json!({"type":"connection","provider":"hetzner",
            "connectionId":"019a0000-0000-7000-8000-000000000001","zoneId":zone});
        let config: DnsProviderConfig = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(config.provider_id(), ProviderId::Hetzner);
        assert_eq!(serde_json::to_value(config).unwrap(), value);
    }
    for zone in [
        "",
        "0",
        "01",
        "+1",
        "1\n",
        "9223372036854775808",
        "example.com",
        "42/../43",
    ] {
        assert!(!ProviderId::Hetzner.valid_zone_id(zone), "{zone}");
    }
    assert!(
        serde_json::from_value::<DnsProviderConfig>(
            json!({"type":"hetzner","zoneId":"42","apiToken":"fixture-token"})
        )
        .is_err()
    );
    let internal = DnsProviderConfig::Hetzner {
        zone_id: "42".into(),
        api_token: "fixture-token".into(),
    };
    assert!(internal.validate().is_ok());
    assert!(!format!("{internal:?}").contains("fixture-token"));
    assert!(serde_json::to_value(internal).is_err());
    assert_eq!(
        parse_provider_api_endpoint(ProviderId::Hetzner, "https://api.hetzner.cloud", false)
            .unwrap()
            .as_str(),
        HETZNER_API_BASE
    );
    assert_eq!(
        parse_provider_api_endpoint(ProviderId::Hetzner, "http://127.0.0.1:1234", true)
            .unwrap()
            .path(),
        "/v1/"
    );
    for endpoint in [
        "http://api.hetzner.cloud",
        "https://token@api.hetzner.cloud",
        "https://api.hetzner.cloud?token=fixture",
    ] {
        assert!(parse_provider_api_endpoint(ProviderId::Hetzner, endpoint, false).is_err());
    }
}

#[test]
fn desec_credentials_are_internal_and_reference_roundtrips_without_secrets() {
    let value = json!({"type":"connection","provider":"desec", "connectionId":"019a0000-0000-7000-8000-000000000001", "zoneId":"example.com"});
    let config: DnsProviderConfig = serde_json::from_value(value.clone()).unwrap();
    assert_eq!(config.provider_id(), ProviderId::Desec);
    assert_eq!(serde_json::to_value(config).unwrap(), value);
    assert!(
        serde_json::from_value::<DnsProviderConfig>(
            json!({"type":"desec", "zoneId":"example.com", "apiToken":"fixture-only-token"})
        )
        .is_err()
    );
    let internal = DnsProviderConfig::Desec {
        zone_id: "example.com".into(),
        api_token: "fixture-only-token".into(),
    };
    assert!(internal.validate().is_ok());
    assert!(!format!("{internal:?}").contains("fixture-only-token"));
    assert!(serde_json::to_value(internal).is_err());
}

#[test]
fn desec_zone_and_record_identifiers_have_distinct_provider_contracts() {
    assert!(ProviderId::Desec.valid_zone_id("xn--bcher-kva.example"));
    for zone in [
        "example.com.",
        "Example.com",
        "127.0.0.1",
        "example",
        "example.com/../other",
        "example..com",
        "_acme.example.com",
    ] {
        assert!(!ProviderId::Desec.valid_zone_id(zone), "{zone}");
    }
    let max = format!("{}.{}.{}", "a".repeat(63), "b".repeat(63), "c".repeat(63));
    assert!(ProviderId::Desec.valid_zone_id(&max));
    assert!(!ProviderId::Desec.valid_zone_id(&format!("a.{max}")));
    assert!(ProviderId::Desec.valid_address_record_id(&"a".repeat(32)));
    assert!(!ProviderId::Desec.valid_address_record_id("example.com"));
    assert!(!ProviderId::Cloudflare.valid_zone_id("example.com"));
}

#[test]
fn desec_endpoint_is_fixed_and_test_override_cannot_carry_credentials_or_queries() {
    assert_eq!(
        parse_provider_api_endpoint(ProviderId::Desec, "https://desec.io", false)
            .unwrap()
            .as_str(),
        DESEC_API_BASE
    );
    assert_eq!(
        parse_provider_api_endpoint(ProviderId::Desec, "http://127.0.0.1:1234", true)
            .unwrap()
            .path(),
        "/api/v1/"
    );
    for endpoint in [
        "http://desec.io",
        "https://token@desec.io",
        "https://desec.io?token=fixture",
        "https://desec.io/#fragment",
    ] {
        assert!(parse_provider_api_endpoint(ProviderId::Desec, endpoint, false).is_err());
    }
}
