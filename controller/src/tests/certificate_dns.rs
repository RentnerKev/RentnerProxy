use super::validation::{index_is_valid, is_acme_request_domain};
use super::*;
use base64::Engine as _;

const ID: &str = "0198d98a-0000-7000-8000-000000000091";

fn dns_request() -> CertificateIssueRequest {
    serde_json::from_value(serde_json::json!({
        "domains": ["*.example.com", "example.com"],
        "environment": "staging", "acceptTerms": true, "challengeType": "dns-01",
        "dnsProvider": { "type": "cloudflare", "zoneId": "a".repeat(32), "apiToken": "fixture-dns-token" }
    })).unwrap()
}

#[test]
fn wildcard_request_contract_and_legacy_http_default() {
    let base = format!(
        "{}.{}.{}.{}",
        "a".repeat(63),
        "b".repeat(63),
        "c".repeat(63),
        "d".repeat(45)
    );
    for prefix in ["", "*."] {
        assert!(is_acme_request_domain(
            &format!("{prefix}{base}"),
            AcmeChallengeType::Dns01,
            CertificateEnvironment::Production
        ));
        assert!(!is_acme_request_domain(
            &format!("{prefix}{base}d"),
            AcmeChallengeType::Dns01,
            CertificateEnvironment::Production
        ));
    }
    let request = dns_request();
    assert_eq!(request.challenge_type, AcmeChallengeType::Dns01);
    for name in ["*.example.com", "example.com", "api.example.com"] {
        assert!(is_acme_request_domain(
            name,
            AcmeChallengeType::Dns01,
            CertificateEnvironment::Production
        ));
    }
    for name in [
        "*.*.example.com",
        "foo*.example.com",
        "*.com",
        "*.127.0.0.1",
        "*.example.test",
        "*.example.invalid",
    ] {
        assert!(!is_acme_request_domain(
            name,
            AcmeChallengeType::Dns01,
            CertificateEnvironment::Production
        ));
    }
    assert!(!is_acme_request_domain(
        "*.example.com",
        AcmeChallengeType::Http01,
        CertificateEnvironment::Production
    ));
    let legacy: CertificateIssueRequest = serde_json::from_value(serde_json::json!({
        "domains": ["example.com"], "environment": "staging", "acceptTerms": true
    }))
    .unwrap();
    assert_eq!(legacy.challenge_type, AcmeChallengeType::Http01);
    assert_eq!(
        serde_json::to_value(legacy.challenge_type).unwrap(),
        "http-01"
    );
    assert_eq!(
        serde_json::to_value(request.challenge_type).unwrap(),
        "dns-01"
    );
}

#[test]
fn dns_lifecycle_with_isolated_key() {
    const CHILD: &str = "RENTNERPROXY_DNS_STORE_TEST_CHILD";
    if std::env::var_os(CHILD).is_none() {
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "runtime::certificates::dns_tests::dns_lifecycle_with_isolated_key",
                "--nocapture",
            ])
            .env(CHILD, "1")
            .env(
                "APP_ENCRYPTION_KEY",
                base64::engine::general_purpose::STANDARD.encode([7_u8; 32]),
            )
            .env_remove("APP_ENCRYPTION_KEY_FILE")
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "isolated DNS test failed: {} {}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        return;
    }
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
        .block_on(async {
            let directory = std::env::temp_dir().join(format!(
                "rentnerproxy-dns-store-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            std::fs::create_dir(&directory).unwrap();
            let request = dns_request();
            let store = CertificateStore::new(directory.clone());
            store.initialize().await.unwrap();
            assert_eq!(
                store
                    .begin_issue(ID, request.clone(), false)
                    .await
                    .unwrap()
                    .operation,
                CertificateOperation::Issuing
            );
            let intents = vec![
                DnsRecordIntent::new(ID, "example.com", "apex-proof").unwrap(),
                DnsRecordIntent::new(ID, "*.example.com", "wildcard-proof").unwrap(),
            ];
            store
                .set_pending_dns_records(ID, intents.clone())
                .await
                .unwrap();
            let other_intent =
                DnsRecordIntent::new("another-certificate", "example.com", "proof").unwrap();
            assert_eq!(
                store.set_pending_dns_records(ID, vec![other_intent]).await,
                Err(CertificateError::DnsProviderInvalid)
            );
            assert_eq!(store.pending_dns_records(ID).await.unwrap(), intents);
            let index_text = std::fs::read_to_string(
                directory.join("certificates").join(CERTIFICATE_INDEX_FILE),
            )
            .unwrap();
            assert!(!index_text.contains("fixture-dns-token"));
            for mutation in ["missing_acme", "missing_provider", "http_provider"] {
                let mut value: serde_json::Value = serde_json::from_str(&index_text).unwrap();
                let entry = &mut value["certificates"][ID];
                match mutation {
                    "missing_acme" => entry["acme"] = serde_json::Value::Null,
                    "missing_provider" => entry["acme"]["dnsProvider"] = serde_json::Value::Null,
                    _ => entry["acme"]["challengeType"] = "http-01".into(),
                }
                let invalid: CertificateIndex = serde_json::from_value(value).unwrap();
                assert!(!index_is_valid(&invalid), "accepted {mutation}");
            }
            assert!(
                !serde_json::to_string(&store.list().await.unwrap())
                    .unwrap()
                    .contains("dnsProvider")
            );
            drop(store);

            let reopened = CertificateStore::new(directory);
            reopened.initialize().await.unwrap();
            assert_eq!(reopened.pending_dns_records(ID).await.unwrap(), intents);
            assert_eq!(
                reopened.delete_if_unused(ID, false).await,
                Err(CertificateError::DnsCleanupFailed)
            );

            reopened
                .index
                .lock()
                .await
                .certificates
                .get_mut(ID)
                .unwrap()
                .next_attempt_at = Some("2000-01-01T00:00:00Z".to_owned());
            assert_eq!(
                reopened.begin_issue(ID, request.clone(), false).await,
                Err(CertificateError::DnsCleanupFailed)
            );
            let leaf = rcgen::generate_simple_self_signed(request.domains.clone()).unwrap();
            assert!(matches!(
                reopened
                    .stage_manual(
                        ID,
                        CertificateImportRequest {
                            certificate_pem: leaf.cert.pem(),
                            private_key_pem: leaf.signing_key.serialize_pem(),
                            chain_pem: None,
                            required_domains: None,
                        }
                    )
                    .await,
                Err(CertificateError::DnsCleanupFailed)
            ));
            let (_, renewed_request) = reopened.begin_renewal(ID).await.unwrap();
            assert_eq!(renewed_request.domains, request.domains);
            assert_eq!(renewed_request.dns_provider, request.dns_provider);
            assert_eq!(renewed_request.challenge_type, AcmeChallengeType::Dns01);
            reopened
                .set_pending_dns_records(ID, Vec::new())
                .await
                .unwrap();
            let staged = reopened
                .stage_acme(
                    ID,
                    &renewed_request,
                    leaf.cert.pem(),
                    leaf.signing_key.serialize_pem(),
                )
                .await
                .unwrap();
            let first = reopened.commit_staged(&staged).await.unwrap();
            assert_eq!(first.id, ID);
            assert_eq!(first.status, CertificateStatus::Valid);
            assert!(certificate_covers(&first.domains, "proxy.example.com"));
            assert!(certificate_covers(&first.domains, "example.com"));
            assert!(!certificate_covers(
                &first.domains,
                "deep.proxy.example.com"
            ));
            assert!(!certificate_covers(&first.domains, "unrelatedexample.com"));

            let (_, request) = reopened.begin_renewal(ID).await.unwrap();
            let replacement = rcgen::generate_simple_self_signed(request.domains.clone()).unwrap();
            let staged = reopened
                .stage_acme(
                    ID,
                    &request,
                    replacement.cert.pem(),
                    replacement.signing_key.serialize_pem(),
                )
                .await
                .unwrap();
            let renewed = reopened.commit_staged(&staged).await.unwrap();
            assert_eq!(renewed.id, first.id);
            assert_ne!(renewed.fingerprint, first.fingerprint);
            assert_eq!(renewed.domains, first.domains);

            let original_config = {
                let mut index = reopened.index.lock().await;
                let config = index
                    .certificates
                    .get_mut(ID)
                    .unwrap()
                    .acme
                    .as_mut()
                    .unwrap()
                    .dns_provider
                    .as_mut()
                    .unwrap();
                let original = config.clone();
                config.ciphertext[0] ^= 1;
                original
            };
            for attempt in 0..2 {
                if attempt > 0 {
                    reopened
                        .index
                        .lock()
                        .await
                        .certificates
                        .get_mut(ID)
                        .unwrap()
                        .next_attempt_at = Some("2000-01-01T00:00:00Z".to_owned());
                }
                assert!(matches!(
                    reopened.begin_renewal(ID).await,
                    Err(CertificateError::DnsCredentialsUnavailable)
                ));
                let failed = reopened.get(ID).await.unwrap();
                assert_eq!(failed.status, CertificateStatus::Valid);
                assert_eq!(failed.operation, CertificateOperation::Idle);
                assert_eq!(failed.fingerprint, renewed.fingerprint);
                assert_eq!(
                    failed.last_error_code.as_deref(),
                    Some("dns_credentials_unavailable")
                );
            }
            reopened
                .index
                .lock()
                .await
                .certificates
                .get_mut(ID)
                .unwrap()
                .acme
                .as_mut()
                .unwrap()
                .dns_provider = Some(original_config);
            reopened
                .index
                .lock()
                .await
                .certificates
                .get_mut(ID)
                .unwrap()
                .next_attempt_at = Some("2000-01-01T00:00:00Z".to_owned());
            reopened.begin_renewal(ID).await.unwrap();
            reopened
                .finish_failed(ID, CertificateError::AcmeFailed)
                .await;
            reopened.delete_if_unused(ID, false).await.unwrap();
        });
}
