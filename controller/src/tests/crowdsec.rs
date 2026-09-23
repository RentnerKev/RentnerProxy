use super::*;

#[test]
fn external_endpoint_is_canonicalized_without_weakening_its_origin() {
    assert_eq!(
        normalize_api_url("https://crowdsec.example.test/lapi").unwrap(),
        "https://crowdsec.example.test/lapi/"
    );
    assert_eq!(
        normalize_api_url("http://192.0.2.10:8080/").unwrap(),
        "http://192.0.2.10:8080/"
    );
    for invalid in [
        "ftp://crowdsec.example.test/",
        "https://user:password@crowdsec.example.test/",
        "https://crowdsec.example.test/?token=secret",
        "https://crowdsec.example.test/#fragment",
        " https://crowdsec.example.test/",
    ] {
        assert_eq!(
            normalize_api_url(invalid),
            Err(CrowdSecError::InvalidConfiguration)
        );
    }
}

#[test]
fn bouncer_keys_are_bounded_ascii_tokens_and_redacted_in_debug_output() {
    let valid = SecretString::new("0123456789abcdef".to_owned());
    assert_eq!(validate_api_key(&valid), Ok(()));
    assert_eq!(format!("{valid:?}"), "SecretString(REDACTED)");

    for invalid in [
        "short",
        "0123456789abcde ",
        "0123456789abcde\n",
        "0123456789abcdeä",
    ] {
        assert_eq!(
            validate_api_key(&SecretString::new(invalid.to_owned())),
            Err(CrowdSecError::InvalidConfiguration)
        );
    }
}

#[test]
fn persisted_provider_metadata_cannot_contain_a_bouncer_key() {
    let persisted = PersistedConfiguration {
        version: 1,
        mode: CrowdSecMode::External,
        api_url: Some("https://crowdsec.example.test/".to_owned()),
    };
    let json = serde_json::to_string(&persisted).unwrap();
    assert_eq!(
        json,
        r#"{"version":1,"mode":"external","apiUrl":"https://crowdsec.example.test/"}"#
    );
    assert!(!json.contains("key"));
}
