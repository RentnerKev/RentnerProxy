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
