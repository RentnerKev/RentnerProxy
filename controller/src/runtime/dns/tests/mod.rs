use std::sync::Arc;

use axum::http::StatusCode;
use serde_json::json;
use tokio::sync::Mutex;

use crate::runtime::certificates::CertificateError;

use super::*;
use super::{
    config::{CLOUDFLARE_API_BASE, parse_api_endpoint},
    encryption::{decrypt_with_key, encrypt_with_key},
    validation::{bare_authorization_name, validate_sans_against_zone},
};

mod fixtures;
use fixtures::{MockRecord, MockState, config, fixture};

#[test]
fn config_json_is_tagged_and_debug_redacts_token() {
    let config = config();
    let value = serde_json::to_value(&config).unwrap();
    assert_eq!(value["type"], "cloudflare");
    assert_eq!(value["zoneId"], "0123456789abcdef0123456789abcdef");
    assert_eq!(value["apiToken"], "token-without-whitespace");
    let debug = format!("{config:?}");
    assert!(!debug.contains("token-without-whitespace"));
    assert!(debug.contains("REDACTED"));
}

#[test]
fn config_deserialization_rejects_bad_zone_and_token() {
    for value in [
        json!({"type":"cloudflare","zoneId":"0123456789ABCDEF0123456789abcdef","apiToken":"x"}),
        json!({"type":"cloudflare","zoneId":"0123456789abcdef0123456789abcde","apiToken":"x"}),
        json!({"type":"cloudflare","zoneId":"0123456789abcdef0123456789abcdef","apiToken":"x y"}),
        json!({"type":"cloudflare","zoneId":"0123456789abcdef0123456789abcdef","apiToken":""}),
    ] {
        assert!(serde_json::from_value::<DnsProviderConfig>(value).is_err());
    }
}

#[test]
fn encrypt_decrypt_uses_aad_and_never_persists_plaintext() {
    let config = config();
    let key = [7_u8; 32];
    let encrypted = encrypt_with_key(&config, "certificate-1", &key).unwrap();
    let encoded = serde_json::to_string(&encrypted).unwrap();
    assert!(!encoded.contains("token-without-whitespace"));
    assert_eq!(
        decrypt_with_key(&encrypted, "certificate-1", &key).unwrap(),
        config
    );
    assert_eq!(
        decrypt_with_key(&encrypted, "certificate-2", &key),
        Err(CertificateError::DnsCredentialsUnavailable)
    );
    let mut tampered = encrypted.clone();
    tampered.ciphertext[0] ^= 1;
    assert_eq!(
        decrypt_with_key(&tampered, "certificate-1", &key),
        Err(CertificateError::DnsCredentialsUnavailable)
    );
}

#[test]
fn authorization_names_enforce_zone_boundaries_and_wildcards() {
    let zone = "example.com";
    let names = validate_sans_against_zone(
        &[
            "example.com".to_owned(),
            "*.example.com".to_owned(),
            "api.child.example.com".to_owned(),
        ],
        zone,
    )
    .unwrap();
    assert_eq!(
        names,
        vec![
            "example.com".to_owned(),
            "example.com".to_owned(),
            "api.child.example.com".to_owned(),
        ]
    );
    assert!(validate_sans_against_zone(&["example.com.evil".to_owned()], zone).is_err());
    assert!(validate_sans_against_zone(&["badexample.com".to_owned()], zone).is_err());
}

#[test]
fn intent_marker_and_owner_name_are_stable_for_apex_and_wildcard() {
    let apex = DnsRecordIntent::new("certificate-1", "example.com", "digest-apex").unwrap();
    let wildcard =
        DnsRecordIntent::new("certificate-1", "*.example.com", "digest-wildcard").unwrap();
    assert_eq!(apex.name, wildcard.name);
    assert_ne!(apex.value, wildcard.value);
    assert_eq!(apex.marker, wildcard.marker);
    assert_eq!(
        bare_authorization_name("_acme-challenge.example.com"),
        Some("example.com".to_owned())
    );
}

#[test]
fn endpoint_is_pinned_and_test_path_is_normalized() {
    let production = parse_api_endpoint(CLOUDFLARE_API_BASE, false).unwrap();
    assert_eq!(production.as_str(), CLOUDFLARE_API_BASE);
    let test = parse_api_endpoint("http://127.0.0.1:1234", true).unwrap();
    assert_eq!(test.as_str(), "http://127.0.0.1:1234/client/v4/");
    assert!(parse_api_endpoint("http://user@127.0.0.1:1234", true).is_err());
    assert!(parse_api_endpoint("https://api.cloudflare.com?token=secret", false).is_err());
}

#[tokio::test]
async fn provider_presents_and_cleans_only_exact_owned_values() {
    let state = Arc::new(Mutex::new(MockState::default()));
    state.lock().await.records.push(MockRecord {
        id: "foreign".to_owned(),
        name: "_acme-challenge.example.com".to_owned(),
        content: "foreign-value".to_owned(),
        comment: "operator-owned".to_owned(),
    });
    let (provider, state, shutdown, task) = fixture(state).await;
    let apex = DnsRecordIntent::new("certificate-1", "example.com", "digest-apex").unwrap();
    let wildcard =
        DnsRecordIntent::new("certificate-1", "*.example.com", "digest-wildcard").unwrap();
    let first = provider.present(&apex).await.unwrap();
    let second = provider.present(&wildcard).await.unwrap();
    assert_ne!(first.id, second.id);
    assert_eq!(state.lock().await.records.len(), 3);
    provider.cleanup_intents(&[apex, wildcard]).await.unwrap();
    let records = state.lock().await.records.clone();
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].id, "foreign");
    let _ = shutdown.send(());
    task.await.unwrap();
}

#[tokio::test]
async fn provider_recovers_owned_record_after_ambiguous_create() {
    let state = Arc::new(Mutex::new(MockState {
        ambiguous_post: true,
        ..MockState::default()
    }));
    let (provider, state, shutdown, task) = fixture(state).await;
    let intent = DnsRecordIntent::new("certificate-1", "example.com", "digest").unwrap();
    let handle = provider.present(&intent).await.unwrap();
    assert_eq!(state.lock().await.post_count, 1);
    assert_eq!(handle.intent, intent);
    provider.cleanup_intents(&[intent]).await.unwrap();
    assert!(state.lock().await.records.is_empty());
    let _ = shutdown.send(());
    task.await.unwrap();
}

#[tokio::test]
async fn provider_lists_bounded_pages_and_maps_auth_and_cleanup_failures() {
    let mut initial = MockState::default();
    for index in 0..100 {
        initial.records.push(MockRecord {
            id: format!("foreign-{index}"),
            name: "_acme-challenge.example.com".to_owned(),
            content: format!("foreign-{index}"),
            comment: "operator-owned".to_owned(),
        });
    }
    let intent = DnsRecordIntent::new("certificate-1", "example.com", "digest").unwrap();
    initial.records.push(MockRecord {
        id: "owned-page-two".to_owned(),
        name: "_acme-challenge.example.com".to_owned(),
        content: intent.value.clone(),
        comment: intent.marker.clone(),
    });
    let state = Arc::new(Mutex::new(initial));
    let (provider, state, shutdown, task) = fixture(state).await;
    state.lock().await.zone_status = Some(StatusCode::FORBIDDEN);
    assert_eq!(
        provider.zone_name().await,
        Err(CertificateError::DnsProviderUnauthorized)
    );
    state.lock().await.zone_status = None;
    let records = provider.find_owned_records(&intent).await.unwrap();
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].id, "owned-page-two");
    let handle = provider.present(&intent).await.unwrap();
    state.lock().await.delete_failures = 1;
    assert_eq!(
        provider
            .cleanup_intents(std::slice::from_ref(&intent))
            .await,
        Err(CertificateError::DnsCleanupFailed)
    );
    assert!(
        state
            .lock()
            .await
            .records
            .iter()
            .any(|record| record.id == handle.id)
    );
    provider.cleanup_intents(&[intent]).await.unwrap();
    assert!(
        !state
            .lock()
            .await
            .records
            .iter()
            .any(|record| record.id == handle.id)
    );
    let _ = shutdown.send(());
    task.await.unwrap();
}
