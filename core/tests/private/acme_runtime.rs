use super::*;
use crate::runtime::{
    RuntimeSettings,
    certificates::{CertificateEnvironment, CertificateOperation, CertificateStatus},
};

const ID: &str = "0198d98a-0000-7000-8000-000000000198";

fn request() -> CertificateIssueRequest {
    CertificateIssueRequest {
        domains: vec!["example.com".to_owned()],
        environment: CertificateEnvironment::Staging,
        contact_email: None,
        challenge_type: AcmeChallengeType::Http01,
        dns_mode: crate::runtime::certificates::DnsValidationMode::Provider,
        dns_provider: None,
        accept_terms: true,
    }
}

async fn runtime() -> Arc<ProxyRuntime> {
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let directory = std::env::temp_dir().join(format!(
        "rentnerproxy-acme-runtime-{}-{}-{}",
        std::process::id(),
        time::OffsetDateTime::now_utc().unix_timestamp_nanos(),
        NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    ));
    std::fs::create_dir_all(&directory).unwrap();
    let runtime = ProxyRuntime::new(RuntimeSettings::new(directory, 0), None);
    runtime.certificate_store.initialize().await.unwrap();
    runtime
}

#[tokio::test]
async fn shutdown_rejects_every_acme_entrypoint_before_creating_work() {
    let runtime = runtime().await;
    runtime.begin_shutdown();
    let challenges = ChallengeStore::new();
    for result in [
        runtime
            .start_acme_issue(ID.to_owned(), request(), challenges.clone())
            .await,
        runtime
            .start_acme_renewal(ID.to_owned(), challenges.clone())
            .await,
        runtime
            .start_scheduled_acme_renewal(ID.to_owned(), challenges.clone())
            .await,
        runtime
            .start_scheduled_acme_retry(ID.to_owned(), challenges)
            .await,
        runtime
            .start_manual_dns_continue(
                ID.to_owned(),
                crate::runtime::certificates::ManualDnsActionRequest {
                    operation_id: ID.to_owned(),
                    challenge_set_id: ID.to_owned(),
                },
            )
            .await,
    ] {
        assert_eq!(result, Err(CertificateError::OperationInProgress));
    }
    assert!(runtime.certificate_store.list().await.unwrap().is_empty());
}

#[tokio::test]
async fn absent_certificates_never_start_renewal_or_retry() {
    let runtime = runtime().await;
    let challenges = ChallengeStore::new();
    for result in [
        runtime
            .start_acme_renewal(ID.to_owned(), challenges.clone())
            .await,
        runtime
            .start_scheduled_acme_renewal(ID.to_owned(), challenges.clone())
            .await,
        runtime
            .start_scheduled_acme_retry(ID.to_owned(), challenges)
            .await,
    ] {
        assert_eq!(result, Err(CertificateError::NotFound));
    }
    assert!(runtime.certificate_store.list().await.unwrap().is_empty());
}

#[tokio::test]
async fn failed_dns_setup_finishes_operation_and_preserves_failure_reason() {
    for (config, expected) in [
        (None, CertificateError::AcmeDnsRequired),
        (
            Some(crate::runtime::dns::DnsProviderConfig::Cloudflare {
                zone_id: "invalid".to_owned(),
                api_token: "test".to_owned(),
            }),
            CertificateError::DnsProviderInvalid,
        ),
    ] {
        let runtime = runtime().await;
        let accepted = runtime
            .certificate_store
            .begin_issue(ID, request(), false)
            .await
            .unwrap();
        assert_eq!(accepted.operation, CertificateOperation::Issuing);
        let mut invalid_request = request();
        invalid_request.challenge_type = AcmeChallengeType::Dns01;
        invalid_request.dns_provider = config;
        Arc::clone(&runtime)
            .issue_acme_inner(ID.to_owned(), invalid_request, ChallengeStore::new())
            .await;
        let failed = runtime.certificate_store.get(ID).await.unwrap();
        assert_eq!(failed.status, CertificateStatus::Failed);
        assert_eq!(failed.operation, CertificateOperation::Idle);
        assert_eq!(failed.last_error_code.as_deref(), Some(expected.code()));
        assert!(failed.candidate.is_none());
    }
}

#[tokio::test]
async fn missing_cleanup_and_issue_records_fail_without_network_work() {
    let runtime = runtime().await;
    runtime.recover_dns_cleanup_one(ID).await;
    runtime.recover_dns_cleanup().await;
    Arc::clone(&runtime)
        .issue_acme_inner(ID.to_owned(), request(), ChallengeStore::new())
        .await;
    assert!(runtime.certificate_store.list().await.unwrap().is_empty());
}

#[tokio::test]
async fn background_issue_records_account_failure_and_releases_operation() {
    let runtime = runtime().await;
    runtime
        .certificate_store
        .store_acme_account(
            CertificateEnvironment::Staging,
            br#"{"directory":"invalid-account-directory"}"#,
        )
        .await
        .unwrap();
    let accepted = runtime
        .start_acme_issue(ID.to_owned(), request(), ChallengeStore::new())
        .await
        .unwrap();
    assert_eq!(accepted.operation, CertificateOperation::Issuing);
    let failed = tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            let metadata = runtime.certificate_store.get(ID).await.unwrap();
            if metadata.operation == CertificateOperation::Idle {
                break metadata;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert_eq!(failed.status, CertificateStatus::Failed);
    assert_eq!(
        failed.last_error_code.as_deref(),
        Some(CertificateError::StoreUnavailable.code())
    );
    assert!(failed.candidate.is_none());
    assert!(
        runtime
            .certificate_store
            .pending_dns_cleanup_ids()
            .await
            .unwrap()
            .is_empty()
    );
}

#[path = "delegated_acme_lifecycle.rs"]
mod delegated_lifecycle;

async fn seed_active_certificate(runtime: &ProxyRuntime, due: bool) -> String {
    let request = request();
    runtime
        .certificate_store
        .begin_issue(ID, request.clone(), false)
        .await
        .unwrap();
    let mut params = rcgen::CertificateParams::new(request.domains.clone()).unwrap();
    let now = time::OffsetDateTime::now_utc();
    params.not_before = now - time::Duration::days(if due { 20 } else { 1 });
    params.not_after = now + time::Duration::days(if due { 1 } else { 90 });
    let key = rcgen::KeyPair::generate().unwrap();
    let certificate = params.self_signed(&key).unwrap();
    let staged = runtime
        .certificate_store
        .stage_acme(ID, &request, certificate.pem(), key.serialize_pem())
        .await
        .unwrap();
    runtime
        .certificate_store
        .commit_staged(&staged)
        .await
        .unwrap()
        .fingerprint
        .unwrap()
}

async fn fail_account_locally(runtime: &ProxyRuntime) {
    runtime
        .certificate_store
        .store_acme_account(
            CertificateEnvironment::Staging,
            br#"{"directory":"invalid-account-directory"}"#,
        )
        .await
        .unwrap();
}

async fn wait_for_idle(runtime: &ProxyRuntime) -> super::super::CertificateMetadata {
    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            let metadata = runtime.certificate_store.get(ID).await.unwrap();
            if metadata.operation == CertificateOperation::Idle {
                break metadata;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap()
}

#[tokio::test]
async fn explicit_and_scheduled_renewal_keep_active_certificate_on_account_failure() {
    for scheduled in [false, true] {
        let runtime = runtime().await;
        let original = seed_active_certificate(&runtime, true).await;
        fail_account_locally(&runtime).await;
        let accepted = if scheduled {
            runtime
                .start_scheduled_acme_renewal(ID.to_owned(), ChallengeStore::new())
                .await
        } else {
            runtime
                .start_acme_renewal(ID.to_owned(), ChallengeStore::new())
                .await
        }
        .unwrap();
        assert_eq!(accepted.operation, CertificateOperation::Renewing);
        let failed = wait_for_idle(&runtime).await;
        assert_eq!(failed.status, CertificateStatus::Valid);
        assert_eq!(failed.fingerprint.as_deref(), Some(original.as_str()));
        assert_eq!(
            failed.last_error_code.as_deref(),
            Some(CertificateError::StoreUnavailable.code())
        );
        assert!(failed.next_attempt_at.is_some());
        assert!(failed.candidate.is_none());
    }
}

#[tokio::test]
async fn scheduled_renewal_does_not_replace_a_certificate_before_its_due_date() {
    let runtime = runtime().await;
    seed_active_certificate(&runtime, false).await;
    let before = runtime.certificate_store.get(ID).await.unwrap();
    assert_eq!(
        runtime
            .start_scheduled_acme_renewal(ID.to_owned(), ChallengeStore::new())
            .await,
        Err(CertificateError::OperationInProgress)
    );
    assert_eq!(runtime.certificate_store.get(ID).await.unwrap(), before);
}

#[tokio::test]
async fn pending_candidate_fences_new_issuance_and_explicit_renewal_reuses_it() {
    let runtime = runtime().await;
    let request = request();
    runtime
        .certificate_store
        .begin_issue(ID, request.clone(), false)
        .await
        .unwrap();
    let leaf = rcgen::generate_simple_self_signed(request.domains.clone()).unwrap();
    let staged = runtime
        .certificate_store
        .stage_acme(
            ID,
            &request,
            leaf.cert.pem(),
            leaf.signing_key.serialize_pem(),
        )
        .await
        .unwrap();
    assert_eq!(
        runtime
            .start_acme_issue(ID.to_owned(), request, ChallengeStore::new())
            .await,
        Err(CertificateError::OperationInProgress)
    );
    runtime
        .certificate_store
        .finish_candidate_failed(&staged, CertificateError::RuntimeApplyFailed)
        .await;
    let candidate = runtime
        .certificate_store
        .get(ID)
        .await
        .unwrap()
        .candidate
        .unwrap();
    let activated = runtime
        .start_acme_renewal(ID.to_owned(), ChallengeStore::new())
        .await
        .unwrap();
    assert_eq!(activated.operation, CertificateOperation::Idle);
    assert_eq!(activated.status, CertificateStatus::Valid);
    assert_eq!(
        activated.fingerprint.as_deref(),
        Some(candidate.fingerprint.as_str())
    );
    assert!(activated.candidate.is_none());
    assert!(
        runtime
            .certificate_store
            .pending_candidate_ids()
            .await
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn scheduled_retry_resumes_due_stored_attempt_and_keeps_its_operation_kind() {
    let runtime = runtime().await;
    fail_account_locally(&runtime).await;
    runtime
        .certificate_store
        .begin_issue(ID, request(), false)
        .await
        .unwrap();
    runtime
        .certificate_store
        .finish_failed(ID, CertificateError::AcmeFailed)
        .await;
    let before = runtime.certificate_store.get(ID).await.unwrap();
    assert_eq!(
        runtime
            .start_scheduled_acme_retry(ID.to_owned(), ChallengeStore::new())
            .await,
        Err(CertificateError::OperationInProgress)
    );
    let settings = runtime.settings.clone();
    drop(runtime);
    let path = settings
        .state_dir
        .join("certificates/certificate-metadata.json");
    let mut index: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    index["certificates"][ID]["nextAttemptAt"] = serde_json::json!("2020-01-01T00:00:00Z");
    index["acmeRetryUntil"] = serde_json::json!({});
    std::fs::write(path, serde_json::to_vec(&index).unwrap()).unwrap();
    let runtime = ProxyRuntime::new(settings, None);
    runtime.certificate_store.initialize().await.unwrap();
    let accepted = runtime
        .start_scheduled_acme_retry(ID.to_owned(), ChallengeStore::new())
        .await
        .unwrap();
    assert_eq!(accepted.operation, CertificateOperation::Issuing);
    assert_eq!(accepted.attempt_count, before.attempt_count + 1);
    assert_ne!(
        accepted.current_operation.as_ref().unwrap().id,
        before.current_operation.as_ref().unwrap().id
    );
    let failed = wait_for_idle(&runtime).await;
    assert_eq!(failed.status, CertificateStatus::Failed);
    assert_eq!(
        failed.last_error_code.as_deref(),
        Some(CertificateError::StoreUnavailable.code())
    );
    assert!(failed.next_attempt_at.is_some());
}
