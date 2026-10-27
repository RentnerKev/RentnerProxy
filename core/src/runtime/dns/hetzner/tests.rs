use std::collections::BTreeMap;

use reqwest::{Method, StatusCode};
use serde_json::json;

use super::super::{DnsProvider, DnsRecordIntent};
use crate::runtime::certificates::CertificateError;

#[path = "fixtures.rs"]
mod fixtures;
use fixtures::{MockState, config, fixture, record, rrset};

fn intent(value: &str) -> DnsRecordIntent {
    DnsRecordIntent::new("certificate-operation", "example.com", value).unwrap()
}

fn writes(state: &MockState) -> usize {
    state
        .requests
        .iter()
        .filter(|(method, _, _)| method == Method::POST)
        .count()
}

#[tokio::test]
async fn create_inherits_zone_ttl_and_uses_comment_and_safe_restart_handle() {
    let fixture = fixture(MockState::default()).await;
    let expected = intent("operation-value");
    let handle = fixture.provider.present(&expected).await.unwrap();
    assert_eq!(handle.id.len(), 32);
    assert!(handle.id.bytes().all(|byte| byte.is_ascii_hexdigit()));
    assert_eq!(
        fixture
            .provider
            .find_owned_records(&expected)
            .await
            .unwrap(),
        vec![handle.clone()]
    );
    let restarted = DnsProvider::with_endpoint_for_test(config(), &fixture.endpoint).unwrap();
    assert_eq!(restarted.present(&expected).await.unwrap(), handle);
    let state = fixture.state.lock().await;
    assert_eq!(writes(&state), 1);
    let (_, path, body) = state
        .requests
        .iter()
        .find(|(method, _, _)| method == Method::POST)
        .unwrap();
    assert_eq!(path, "/v1/zones/42/rrsets");
    assert_eq!(body["ttl"], json!(null));
    assert_eq!(
        body["records"],
        json!([{"value": "\"operation-value\"", "comment": expected.marker}])
    );
    drop(state);
    restarted.cleanup_intents(&[expected]).await.unwrap();
    assert!(fixture.state.lock().await.rrsets.is_empty());
}

#[tokio::test]
async fn native_add_and_remove_preserve_all_foreign_values_comments_and_existing_ttls() {
    for ttl in [None, Some(7200)] {
        let original = vec![
            record("\"foreign\" \"value\"", Some("external owner")),
            record("\"literal\\034quote\"", None),
            record(
                "\"other-operation\"",
                Some("rentnerproxy-acme:other-operation"),
            ),
        ];
        let fixture = fixture(MockState {
            rrsets: BTreeMap::from([(
                "_acme-challenge".to_owned(),
                rrset("_acme-challenge", ttl, original.clone()),
            )]),
            ..Default::default()
        })
        .await;
        let expected = intent("new-value");
        fixture.provider.present(&expected).await.unwrap();
        let state = fixture.state.lock().await;
        assert_eq!(state.rrsets["_acme-challenge"]["ttl"], json!(ttl));
        let (_, path, body) = state
            .requests
            .iter()
            .find(|(method, _, _)| method == Method::POST)
            .unwrap();
        assert_eq!(
            path,
            "/v1/zones/42/rrsets/_acme-challenge/TXT/actions/add_records"
        );
        assert_eq!(body.as_object().unwrap().len(), 1);
        assert_eq!(
            state.rrsets["_acme-challenge"]["records"]
                .as_array()
                .unwrap()
                .len(),
            4
        );
        drop(state);
        fixture.provider.cleanup_intents(&[expected]).await.unwrap();
        assert_eq!(
            fixture.state.lock().await.rrsets["_acme-challenge"],
            rrset("_acme-challenge", ttl, original)
        );
    }
}

#[tokio::test]
async fn apex_wildcard_and_subdomain_use_relative_owners_and_cleanup_independently() {
    let fixture = fixture(MockState::default()).await;
    let apex = intent("apex-value");
    let wildcard =
        DnsRecordIntent::new("wildcard-operation", "*.example.com", "wildcard-value").unwrap();
    let subdomain =
        DnsRecordIntent::new("subdomain-operation", "foo.example.com", "subdomain-value").unwrap();
    let (left, right) = tokio::join!(
        fixture.provider.present(&apex),
        fixture.provider.present(&wildcard)
    );
    assert_ne!(left.unwrap().id, right.unwrap().id);
    fixture.provider.present(&subdomain).await.unwrap();
    let state = fixture.state.lock().await;
    assert_eq!(
        state.rrsets["_acme-challenge"]["records"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    assert_eq!(
        state.rrsets["_acme-challenge.foo"]["name"],
        "_acme-challenge.foo"
    );
    drop(state);
    fixture.provider.cleanup_intents(&[apex]).await.unwrap();
    assert_eq!(
        fixture.state.lock().await.rrsets["_acme-challenge"]["records"],
        json!([record("\"wildcard-value\"", Some(&wildcard.marker))])
    );
    fixture
        .provider
        .cleanup_intents(&[wildcard, subdomain])
        .await
        .unwrap();
    assert!(fixture.state.lock().await.rrsets.is_empty());
}

#[tokio::test]
async fn separate_instances_serialize_create_and_cleanup_for_many_intents() {
    let fixture = fixture(MockState::default()).await;
    let mut tasks = Vec::new();
    for index in 0..16 {
        let provider = DnsProvider::with_endpoint_for_test(config(), &fixture.endpoint).unwrap();
        tasks.push(tokio::spawn(async move {
            let expected = intent(&format!("operation-{index}"));
            provider.present(&expected).await.unwrap();
            (provider, expected)
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
        16
    );
    let mut tasks = Vec::new();
    for (provider, expected) in operations {
        tasks.push(tokio::spawn(async move {
            provider.cleanup_intents(&[expected]).await.unwrap();
        }));
    }
    for task in tasks {
        task.await.unwrap();
    }
    assert!(fixture.state.lock().await.rrsets.is_empty());
}

#[tokio::test]
async fn foreign_same_value_is_never_adopted_or_removed() {
    let expected = intent("same-value");
    for comment in [
        None,
        Some("foreign owner"),
        Some("rentnerproxy-acme:other-operation"),
    ] {
        let original = rrset(
            "_acme-challenge",
            None,
            vec![record("\"same-\" \"value\"", comment)],
        );
        let fixture = fixture(MockState {
            rrsets: BTreeMap::from([("_acme-challenge".to_owned(), original.clone())]),
            ..Default::default()
        })
        .await;
        assert!(
            fixture
                .provider
                .find_owned_records(&expected)
                .await
                .unwrap()
                .is_empty()
        );
        assert_eq!(
            fixture.provider.present(&expected).await.unwrap_err(),
            CertificateError::DnsProviderInvalid
        );
        fixture
            .provider
            .cleanup_intents(std::slice::from_ref(&expected))
            .await
            .unwrap();
        let state = fixture.state.lock().await;
        assert_eq!(state.rrsets["_acme-challenge"], original);
        assert_eq!(writes(&state), 0);
    }
}

#[tokio::test]
async fn matching_marker_alone_does_not_authorize_cleanup() {
    let expected = intent("operation-value");
    let original = rrset(
        "_acme-challenge",
        None,
        vec![record("\"different-value\"", Some(&expected.marker))],
    );
    let fixture = fixture(MockState {
        rrsets: BTreeMap::from([("_acme-challenge".to_owned(), original.clone())]),
        ..Default::default()
    })
    .await;
    assert!(
        fixture
            .provider
            .find_owned_records(&expected)
            .await
            .unwrap()
            .is_empty()
    );
    fixture.provider.cleanup_intents(&[expected]).await.unwrap();
    let state = fixture.state.lock().await;
    assert_eq!(state.rrsets["_acme-challenge"], original);
    assert_eq!(writes(&state), 0);
}

#[tokio::test]
async fn ownership_checks_handle_bind_chunks_escapes_and_preserve_wire_value_on_remove() {
    let expected = intent("operation-value");
    let owned = record("\"operation\\045\" \"value\"", Some(&expected.marker));
    let fixture = fixture(MockState {
        rrsets: BTreeMap::from([(
            "_acme-challenge".to_owned(),
            rrset("_acme-challenge", Some(3600), vec![owned.clone()]),
        )]),
        ..Default::default()
    })
    .await;
    fixture.provider.present(&expected).await.unwrap();
    fixture.provider.cleanup_intents(&[expected]).await.unwrap();
    let state = fixture.state.lock().await;
    assert_eq!(writes(&state), 1);
    let (_, path, body) = state
        .requests
        .iter()
        .find(|(method, _, _)| method == Method::POST)
        .unwrap();
    assert!(path.ends_with("/actions/remove_records"));
    assert_eq!(body["records"], json!([owned]));
}

#[tokio::test]
async fn malformed_bind_records_are_rejected_before_any_mutation() {
    for value in ["unquoted", "\"unterminated", "\"\\999\"", "\"\"unexpected"] {
        let fixture = fixture(MockState {
            rrsets: BTreeMap::from([(
                "_acme-challenge".to_owned(),
                rrset("_acme-challenge", None, vec![record(value, None)]),
            )]),
            ..Default::default()
        })
        .await;
        assert_eq!(
            fixture
                .provider
                .present(&intent("operation-value"))
                .await
                .unwrap_err(),
            CertificateError::DnsProviderInvalid
        );
        assert_eq!(writes(&*fixture.state.lock().await), 0);
    }
}

#[tokio::test]
async fn ambiguous_create_add_and_remove_are_reconciled_without_replay() {
    for existing in [false, true] {
        let fixture = fixture(MockState {
            ambiguous_write: true,
            rrsets: if existing {
                BTreeMap::from([(
                    "_acme-challenge".to_owned(),
                    rrset(
                        "_acme-challenge",
                        None,
                        vec![record("\"foreign\"", Some("other client"))],
                    ),
                )])
            } else {
                BTreeMap::new()
            },
            ..Default::default()
        })
        .await;
        let expected = intent("operation-value");
        fixture.provider.present(&expected).await.unwrap();
        fixture.state.lock().await.ambiguous_write = true;
        fixture.provider.cleanup_intents(&[expected]).await.unwrap();
        let state = fixture.state.lock().await;
        assert_eq!(writes(&state), 2);
        assert!(state.rrsets.values().all(|rrset| {
            rrset["records"]
                .as_array()
                .unwrap()
                .iter()
                .all(|record| record["comment"] != "rentnerproxy-acme:certificate-operation")
        }));
    }
}

#[tokio::test]
async fn unconfirmed_writes_fail_and_cleanup_stays_recoverable() {
    let fixture = fixture(MockState {
        discard_write: true,
        ..Default::default()
    })
    .await;
    let expected = intent("operation-value");
    assert_eq!(
        fixture.provider.present(&expected).await.unwrap_err(),
        CertificateError::DnsProviderUnavailable
    );
    assert_eq!(writes(&*fixture.state.lock().await), 1);
    fixture.state.lock().await.discard_write = false;
    fixture.provider.present(&expected).await.unwrap();
    fixture.state.lock().await.discard_write = true;
    assert_eq!(
        fixture
            .provider
            .cleanup_intents(std::slice::from_ref(&expected))
            .await
            .unwrap_err(),
        CertificateError::DnsCleanupFailed
    );
    fixture.state.lock().await.discard_write = false;
    let restarted = DnsProvider::with_endpoint_for_test(config(), &fixture.endpoint).unwrap();
    restarted.cleanup_intents(&[expected]).await.unwrap();
    assert!(fixture.state.lock().await.rrsets.is_empty());
}

#[tokio::test]
async fn cleanup_accepts_empty_or_missing_rrset_and_preserves_foreign_racing_addition() {
    for keep_empty in [false, true] {
        let fixture = fixture(MockState {
            empty_rrset_after_cleanup: keep_empty,
            ..Default::default()
        })
        .await;
        let expected = intent("operation-value");
        fixture.provider.present(&expected).await.unwrap();
        fixture
            .provider
            .cleanup_intents(std::slice::from_ref(&expected))
            .await
            .unwrap();
        fixture.provider.cleanup_intents(&[expected]).await.unwrap();
        let state = fixture.state.lock().await;
        assert_eq!(state.rrsets.contains_key("_acme-challenge"), keep_empty);
        assert_eq!(writes(&state), 2);
    }
    let fixture = fixture(MockState {
        foreign_add_on_remove: true,
        ..Default::default()
    })
    .await;
    let expected = intent("operation-value");
    fixture.provider.present(&expected).await.unwrap();
    fixture.provider.cleanup_intents(&[expected]).await.unwrap();
    assert_eq!(
        fixture.state.lock().await.rrsets["_acme-challenge"]["records"],
        json!([record("\"racing-foreign\"", Some("other client"))])
    );
}

#[tokio::test]
async fn protected_rrset_unauthorized_and_rate_limited_mutations_fail_without_replay() {
    for status in [
        StatusCode::UNAUTHORIZED,
        StatusCode::TOO_MANY_REQUESTS,
        StatusCode::FORBIDDEN,
    ] {
        let fixture = fixture(MockState {
            write_status: Some(status),
            rrsets: BTreeMap::from([(
                "_acme-challenge".to_owned(),
                rrset("_acme-challenge", None, vec![record("\"foreign\"", None)]),
            )]),
            ..Default::default()
        })
        .await;
        assert!(
            fixture
                .provider
                .present(&intent("operation-value"))
                .await
                .is_err()
        );
        assert_eq!(writes(&*fixture.state.lock().await), 1);
    }
}

#[tokio::test]
async fn action_failure_wrong_resource_and_foreign_record_loss_never_report_success() {
    for state in [
        MockState {
            action_error: true,
            ..Default::default()
        },
        MockState {
            wrong_action_resource: true,
            ..Default::default()
        },
        MockState {
            lose_foreign_on_add: true,
            rrsets: BTreeMap::from([(
                "_acme-challenge".to_owned(),
                rrset(
                    "_acme-challenge",
                    None,
                    vec![record("\"foreign\"", Some("other client"))],
                ),
            )]),
            ..Default::default()
        },
    ] {
        let fixture = fixture(state).await;
        assert_eq!(
            fixture
                .provider
                .present(&intent("operation-value"))
                .await
                .unwrap_err(),
            CertificateError::DnsProviderUnavailable
        );
        assert_eq!(writes(&*fixture.state.lock().await), 1);
    }
}

#[tokio::test]
async fn secondary_zone_is_rejected_without_txt_mutation() {
    let fixture = fixture(MockState {
        zone_mode: Some("secondary".to_owned()),
        ..Default::default()
    })
    .await;
    assert!(
        fixture
            .provider
            .present(&intent("operation-value"))
            .await
            .is_err()
    );
    assert_eq!(writes(&*fixture.state.lock().await), 0);
}

#[tokio::test]
async fn ambiguous_same_value_with_foreign_comment_blocks_cleanup_without_deleting_anything() {
    let expected = intent("operation-value");
    let original = rrset(
        "_acme-challenge",
        None,
        vec![
            record("\"operation-value\"", Some(&expected.marker)),
            record("\"operation-\" \"value\"", Some("foreign owner")),
        ],
    );
    let fixture = fixture(MockState {
        rrsets: BTreeMap::from([("_acme-challenge".to_owned(), original.clone())]),
        ..Default::default()
    })
    .await;
    assert_eq!(
        fixture
            .provider
            .cleanup_intents(&[expected])
            .await
            .unwrap_err(),
        CertificateError::DnsCleanupFailed
    );
    let state = fixture.state.lock().await;
    assert_eq!(state.rrsets["_acme-challenge"], original);
    assert_eq!(writes(&state), 0);
}

#[tokio::test]
async fn running_actions_are_polled_before_create_and_cleanup_complete() {
    let fixture = fixture(MockState {
        running_action: true,
        ..Default::default()
    })
    .await;
    let expected = intent("operation-value");
    fixture.provider.present(&expected).await.unwrap();
    fixture.provider.cleanup_intents(&[expected]).await.unwrap();
    let state = fixture.state.lock().await;
    assert_eq!(
        state
            .requests
            .iter()
            .filter(|(method, path, _)| method == Method::GET && path == "/v1/actions/123")
            .count(),
        2
    );
    assert_eq!(writes(&state), 2);
    assert!(state.rrsets.is_empty());
}
