use std::collections::BTreeMap;

use reqwest::{Method, StatusCode};
use serde_json::json;

use super::{
    super::{DnsProvider, DnsRecordIntent},
    protocol::{quote_txt, unquote_txt},
};
use crate::runtime::certificates::CertificateError;

#[path = "fixtures.rs"]
mod fixtures;
use fixtures::{MockState, config, fixture, rrset};

fn intent(value: &str) -> DnsRecordIntent {
    DnsRecordIntent::new("certificate-operation", "example.com", value).unwrap()
}

#[tokio::test]
async fn append_preserves_foreign_records_and_ttl_and_cleanup_only_removes_intended_value() {
    let original = [
        "\"foreign\" \"value\"",
        "\"literal\\034quote\"",
        "\"another-operation\"",
    ];
    let fixture = fixture(MockState {
        rrsets: BTreeMap::from([(
            "_acme-challenge".to_owned(),
            rrset("_acme-challenge", 7200, &original),
        )]),
        ..Default::default()
    })
    .await;
    let expected = intent("operation-value");
    let handle = fixture.provider.present(&expected).await.unwrap();
    assert_eq!(handle.id.len(), 32);
    assert!(
        handle
            .id
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    );
    assert_eq!(
        fixture.provider.present(&expected).await.unwrap().id,
        handle.id
    );
    assert_eq!(
        fixture
            .provider
            .find_owned_records(&expected)
            .await
            .unwrap(),
        vec![handle]
    );
    let state = fixture.state.lock().await;
    let actual = &state.rrsets["_acme-challenge"];
    assert_eq!(actual["ttl"], 7200);
    assert_eq!(actual["records"].as_array().unwrap().len(), 4);
    assert_eq!(
        state
            .requests
            .iter()
            .filter(|(method, _, _)| method == Method::PATCH)
            .count(),
        1
    );
    drop(state);
    fixture
        .provider
        .cleanup_intents(std::slice::from_ref(&expected))
        .await
        .unwrap();
    assert_eq!(
        fixture.state.lock().await.rrsets["_acme-challenge"],
        rrset("_acme-challenge", 7200, &original)
    );
    fixture.provider.cleanup_intents(&[expected]).await.unwrap();
}

#[tokio::test]
async fn creates_with_domain_minimum_ttl_and_cleans_missing_rrsets_idempotently() {
    let fixture = fixture(MockState {
        minimum_ttl: Some(60),
        ..Default::default()
    })
    .await;
    let expected = intent("new-value");
    fixture
        .provider
        .cleanup_intents(std::slice::from_ref(&expected))
        .await
        .unwrap();
    fixture.provider.present(&expected).await.unwrap();
    let state = fixture.state.lock().await;
    assert_eq!(state.rrsets["_acme-challenge"]["ttl"], 60);
    let (_, path, body) = state
        .requests
        .iter()
        .find(|(method, _, _)| method == Method::POST)
        .unwrap();
    assert_eq!(path, "/api/v1/domains/example.com/rrsets/");
    assert_eq!(body["records"], json!(["\"new-value\""]));
    drop(state);
    fixture
        .provider
        .cleanup_intents(std::slice::from_ref(&expected))
        .await
        .unwrap();
    fixture.provider.cleanup_intents(&[expected]).await.unwrap();
    assert!(fixture.state.lock().await.rrsets.is_empty());
}

#[tokio::test]
async fn apex_and_wildcard_authorizations_share_owner_and_cleanup_independently() {
    let fixture = fixture(MockState::default()).await;
    let apex = intent("apex-operation");
    let wildcard =
        DnsRecordIntent::new("wildcard-operation", "*.example.com", "wildcard-operation").unwrap();
    let (left, right) = tokio::join!(
        fixture.provider.present(&apex),
        fixture.provider.present(&wildcard)
    );
    assert_ne!(left.unwrap().id, right.unwrap().id);
    assert_eq!(
        fixture.state.lock().await.rrsets["_acme-challenge"]["records"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    fixture.provider.cleanup_intents(&[apex]).await.unwrap();
    assert_eq!(
        fixture.state.lock().await.rrsets["_acme-challenge"]["records"],
        json!(["\"wildcard-operation\""])
    );
    fixture.provider.cleanup_intents(&[wildcard]).await.unwrap();
    assert!(fixture.state.lock().await.rrsets.is_empty());
}

#[tokio::test]
async fn separate_provider_instances_serialize_many_concurrent_operations() {
    let fixture = fixture(MockState::default()).await;
    let mut tasks = Vec::new();
    for index in 0..24 {
        let provider = DnsProvider::with_endpoint_for_test(config(), &fixture.endpoint).unwrap();
        tasks.push(tokio::spawn(async move {
            let intent = intent(&format!("operation-{index}"));
            provider.present(&intent).await.unwrap();
            (provider, intent)
        }));
    }
    let mut operations = Vec::new();
    for task in tasks {
        operations.push(task.await.unwrap());
    }
    assert_eq!(
        fixture.state.lock().await.rrsets["_acme-challenge"]["records"]
            .as_array()
            .unwrap()
            .len(),
        24
    );
    let mut tasks = Vec::new();
    for (provider, intent) in operations {
        tasks.push(tokio::spawn(async move {
            provider.cleanup_intents(&[intent]).await.unwrap();
        }));
    }
    for task in tasks {
        task.await.unwrap();
    }
    assert!(fixture.state.lock().await.rrsets.is_empty());
}

#[tokio::test]
async fn ambiguous_create_and_cleanup_are_reconciled_without_replaying_mutation() {
    let fixture = fixture(MockState {
        ambiguous_write: true,
        ..Default::default()
    })
    .await;
    let expected = intent("recover-this-value");
    fixture.provider.present(&expected).await.unwrap();
    let restarted = DnsProvider::with_endpoint_for_test(config(), &fixture.endpoint).unwrap();
    fixture.state.lock().await.ambiguous_write = true;
    restarted.cleanup_intents(&[expected]).await.unwrap();
    let state = fixture.state.lock().await;
    assert!(state.rrsets.is_empty());
    assert_eq!(
        state
            .requests
            .iter()
            .filter(|(method, _, _)| method == Method::POST)
            .count(),
        1
    );
    assert_eq!(
        state
            .requests
            .iter()
            .filter(|(method, _, _)| method == Method::PATCH)
            .count(),
        1
    );
}

#[tokio::test]
async fn ambiguous_unapplied_write_is_reported_and_restart_can_clean_exact_value() {
    let fixture = fixture(MockState {
        ambiguous_write: true,
        discard_write: true,
        ..Default::default()
    })
    .await;
    let expected = intent("value");
    assert!(matches!(
        fixture.provider.present(&expected).await,
        Err(CertificateError::DnsProviderUnavailable)
    ));
    let state = fixture.state.lock().await;
    assert_eq!(
        state
            .requests
            .iter()
            .filter(|(method, _, _)| method == Method::POST)
            .count(),
        1
    );
    drop(state);
    fixture.state.lock().await.discard_write = false;
    fixture.provider.present(&expected).await.unwrap();
    let restarted = DnsProvider::with_endpoint_for_test(config(), &fixture.endpoint).unwrap();
    restarted.cleanup_intents(&[expected]).await.unwrap();
}

#[tokio::test]
async fn successful_but_unapplied_mutation_fails_verification() {
    let fixture = fixture(MockState {
        discard_write: true,
        ..Default::default()
    })
    .await;
    assert!(matches!(
        fixture.provider.present(&intent("value")).await,
        Err(CertificateError::DnsProviderUnavailable)
    ));
}

#[tokio::test]
async fn request_status_and_untrusted_responses_fail_safely() {
    for status in [
        StatusCode::UNAUTHORIZED,
        StatusCode::FORBIDDEN,
        StatusCode::TOO_MANY_REQUESTS,
    ] {
        let fixture = fixture(MockState {
            read_status: Some(status),
            ..Default::default()
        })
        .await;
        let result = fixture.provider.present(&intent("value")).await;
        if status == StatusCode::TOO_MANY_REQUESTS {
            assert!(matches!(
                result,
                Err(CertificateError::DnsProviderUnavailable)
            ));
        } else {
            assert!(matches!(
                result,
                Err(CertificateError::DnsProviderUnauthorized)
            ));
        }
        assert_eq!(fixture.state.lock().await.requests.len(), 2);
    }
    for state in [
        MockState {
            malformed_read: true,
            ..Default::default()
        },
        MockState {
            oversized_read: true,
            ..Default::default()
        },
    ] {
        let fixture = fixture(state).await;
        assert!(matches!(
            fixture.provider.present(&intent("value")).await,
            Err(CertificateError::DnsProviderUnavailable)
        ));
    }
    let fixture = fixture(MockState {
        wrong_zone: true,
        ..Default::default()
    })
    .await;
    assert!(matches!(
        fixture.provider.zone_name().await,
        Err(CertificateError::DnsProviderInvalid)
    ));
}

#[tokio::test]
async fn malformed_rrset_identity_is_rejected_before_mutation() {
    let fixture = fixture(MockState {
        wrong_rrset: true,
        rrsets: BTreeMap::from([(
            "_acme-challenge".to_owned(),
            rrset("_acme-challenge", 3600, &["\"foreign\""]),
        )]),
        ..Default::default()
    })
    .await;
    assert!(matches!(
        fixture.provider.present(&intent("value")).await,
        Err(CertificateError::DnsProviderInvalid)
    ));
    assert_eq!(fixture.state.lock().await.requests.len(), 2);
}

#[tokio::test]
async fn apex_rrset_route_uses_reserved_at_alias_and_nested_name_is_relative() {
    let fixture = fixture(MockState {
        rrsets: BTreeMap::from([("".to_owned(), rrset("", 3600, &["\"apex-value\""]))]),
        ..Default::default()
    })
    .await;
    assert_eq!(fixture.provider.desec_subname("example.com").unwrap(), "");
    assert_eq!(
        fixture
            .provider
            .desec_subname("_acme-challenge.api.example.com")
            .unwrap(),
        "_acme-challenge.api"
    );
    assert!(fixture.provider.desec_subname("notexample.com").is_err());
    assert!(fixture.provider.desec_rrset_url("invalid/segment").is_err());
    assert!(fixture.provider.desec_rrset_url("..").is_err());
    let too_long = format!("{}.{}.{}", "a".repeat(60), "b".repeat(60), "c".repeat(60));
    assert!(fixture.provider.desec_rrset_url(&too_long).is_err());
    assert!(
        fixture
            .provider
            .desec_read_rrset("")
            .await
            .unwrap()
            .is_some()
    );
    assert_eq!(
        fixture.state.lock().await.requests[0].1,
        "/api/v1/domains/example.com/rrsets/@/TXT/"
    );
}

#[tokio::test]
async fn oversized_merged_request_is_rejected_before_write() {
    let value = "f".repeat(240);
    let quoted = quote_txt(&value);
    let records = vec![quoted.as_str(); 70];
    let fixture = fixture(MockState {
        rrsets: BTreeMap::from([(
            "_acme-challenge".to_owned(),
            rrset("_acme-challenge", 3600, &records),
        )]),
        ..Default::default()
    })
    .await;
    assert!(matches!(
        fixture.provider.present(&intent("value")).await,
        Err(CertificateError::DnsProviderInvalid)
    ));
    assert_eq!(fixture.state.lock().await.requests.len(), 2);
}

#[test]
fn txt_presentation_roundtrips_escaped_chunks_and_rejects_malformed_strings() {
    for value in ["quote\"backslash\\".to_owned(), "a".repeat(2048)] {
        assert_eq!(unquote_txt(&quote_txt(&value)).unwrap(), value.as_bytes());
    }
    assert_eq!(unquote_txt("\"one\" \"\\116wo\"").unwrap(), b"onetwo");
    for malformed in [
        "plain",
        "\"unterminated",
        "\"\\999\"",
        "\"\\12\"",
        "\"valid\"junk",
        "",
    ] {
        assert!(unquote_txt(malformed).is_none(), "{malformed}");
    }
    assert!(unquote_txt(&format!("\"{}\"", "a".repeat(256))).is_none());
}

#[tokio::test]
async fn concurrent_present_and_cleanup_preserve_remaining_orders_and_foreign_values() {
    let fixture = fixture(MockState {
        rrsets: BTreeMap::from([(
            "_acme-challenge".to_owned(),
            rrset("_acme-challenge", 7200, &["\"foreign\""]),
        )]),
        ..Default::default()
    })
    .await;
    let mut old = Vec::new();
    for index in 0..12 {
        let operation = intent(&format!("old-{index}"));
        fixture.provider.present(&operation).await.unwrap();
        old.push(operation);
    }
    let mut tasks = Vec::new();
    for (index, operation) in old.into_iter().enumerate() {
        let provider = DnsProvider::with_endpoint_for_test(config(), &fixture.endpoint).unwrap();
        tasks.push(tokio::spawn(async move {
            let new = intent(&format!("new-{index}"));
            let cleanup_intents = [operation];
            let (present, cleanup) = tokio::join!(
                provider.present(&new),
                provider.cleanup_intents(&cleanup_intents)
            );
            present.unwrap();
            cleanup.unwrap();
        }));
    }
    for task in tasks {
        task.await.unwrap();
    }
    let state = fixture.state.lock().await;
    let values = state.rrsets["_acme-challenge"]["records"]
        .as_array()
        .unwrap();
    assert_eq!(values.len(), 13);
    assert!(values.contains(&json!("\"foreign\"")));
    for index in 0..12 {
        assert!(values.contains(&json!(format!("\"new-{index}\""))));
    }
    assert_eq!(state.rrsets["_acme-challenge"]["ttl"], 7200);
}

#[tokio::test]
async fn write_failures_do_not_retry_or_remove_preexisting_foreign_values() {
    for status in [
        StatusCode::UNAUTHORIZED,
        StatusCode::FORBIDDEN,
        StatusCode::TOO_MANY_REQUESTS,
    ] {
        let fixture = fixture(MockState {
            write_status: Some(status),
            rrsets: BTreeMap::from([(
                "_acme-challenge".to_owned(),
                rrset("_acme-challenge", 3600, &["\"foreign\""]),
            )]),
            ..Default::default()
        })
        .await;
        let result = fixture.provider.present(&intent("value")).await;
        if status == StatusCode::TOO_MANY_REQUESTS {
            assert!(matches!(
                result,
                Err(CertificateError::DnsProviderUnavailable)
            ));
        } else {
            assert!(matches!(
                result,
                Err(CertificateError::DnsProviderUnauthorized)
            ));
        }
        let state = fixture.state.lock().await;
        assert_eq!(
            state
                .requests
                .iter()
                .filter(|(method, _, _)| method == Method::PATCH)
                .count(),
            1
        );
        assert_eq!(
            state.rrsets["_acme-challenge"]["records"],
            json!(["\"foreign\""])
        );
    }
}

#[tokio::test]
async fn invalid_domain_minimum_ttl_and_foreign_intents_fail_before_mutation() {
    for minimum_ttl in [0, 86401] {
        let fixture = fixture(MockState {
            minimum_ttl: Some(minimum_ttl),
            ..Default::default()
        })
        .await;
        assert!(matches!(
            fixture.provider.present(&intent("value")).await,
            Err(CertificateError::DnsProviderInvalid)
        ));
        assert_eq!(fixture.state.lock().await.requests.len(), 1);
    }
    let fixture = fixture(MockState::default()).await;
    let foreign = DnsRecordIntent::new("operation", "notexample.com", "value").unwrap();
    assert!(matches!(
        fixture.provider.present(&foreign).await,
        Err(CertificateError::DnsProviderInvalid)
    ));
    assert_eq!(fixture.state.lock().await.requests.len(), 1);
}
