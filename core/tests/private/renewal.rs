use super::*;

#[tokio::test]
async fn empty_scheduler_is_idempotent_and_can_be_stopped() {
    let path = std::env::temp_dir().join(format!(
        "rentnerproxy-renewal-scheduler-{}-{}",
        std::process::id(),
        OffsetDateTime::now_utc().unix_timestamp_nanos()
    ));
    std::fs::create_dir_all(&path).unwrap();
    let runtime = ProxyRuntime::new(super::super::RuntimeSettings::new(path, 0), None);
    runtime.certificate_store.initialize().await.unwrap();
    let challenges = crate::server::challenges::ChallengeStore::new();
    runtime
        .renew_due_certificates(challenges.clone(), usize::MAX)
        .await;
    runtime.retry_certificate_candidates().await;
    runtime.start_renewal_scheduler(challenges.clone()).await;
    let first = runtime.renewal_task.lock().await.as_ref().unwrap().id();
    runtime.start_renewal_scheduler(challenges).await;
    let task = runtime.renewal_task.lock().await.take().unwrap();
    assert_eq!(first, task.id());
    task.abort();
    assert!(task.await.unwrap_err().is_cancelled());
    assert!(runtime.certificate_store.list().await.unwrap().is_empty());
}

#[test]
fn invalid_lifetime_metadata_cannot_trigger_renewal() {
    let now = timestamp("2026-04-01T00:00:00Z");
    for (issued, expires) in [
        (None, Some("2026-01-07T00:00:00Z")),
        (Some("2026-01-01T00:00:00Z"), None),
        (Some("bad timestamp"), Some("2026-01-07T00:00:00Z")),
        (Some("2026-01-01T00:00:00Z"), Some("bad timestamp")),
        (Some("2026-01-07T00:00:00Z"), Some("2026-01-01T00:00:00Z")),
        (Some("2026-01-01T00:00:00Z"), Some("2026-01-01T00:00:00Z")),
    ] {
        let mut certificate = certificate(certificates::CertificateSource::Acme, 6);
        certificate.issued_at = issued.map(str::to_owned);
        certificate.expires_at = expires.map(str::to_owned);
        assert!(!ProxyRuntime::renewal_is_due_at(&certificate, now));
    }
    for status in [
        certificates::CertificateStatus::Pending,
        certificates::CertificateStatus::Failed,
    ] {
        let mut certificate = certificate(certificates::CertificateSource::Acme, 6);
        certificate.status = status;
        assert!(!ProxyRuntime::renewal_is_due_at(&certificate, now));
    }
    for operation in [
        certificates::CertificateOperation::Issuing,
        certificates::CertificateOperation::Renewing,
    ] {
        let mut certificate = certificate(certificates::CertificateSource::Acme, 6);
        certificate.operation = operation;
        assert!(!ProxyRuntime::renewal_is_due_at(&certificate, now));
    }
}

#[test]
fn retry_requires_valid_deadline_and_issue_or_renew_operation() {
    let now = timestamp("2026-01-06T00:00:00Z");
    let mut certificate = certificate(certificates::CertificateSource::Acme, 6);
    certificate.next_attempt_at = Some("2026-01-06T00:00:00Z".to_owned());
    assert!(!ProxyRuntime::acme_retry_is_due_at(&certificate, now));
    certificate.current_operation = Some(certificates::CurrentOperation {
        id: certificate.id.clone(),
        kind: certificates::OperationKind::Renew,
        stage: certificates::CertificateOperationStage::RetryScheduled,
        started_at: certificate.updated_at.clone(),
        updated_at: certificate.updated_at.clone(),
    });
    assert!(ProxyRuntime::acme_retry_is_due_at(&certificate, now));
    certificate.current_operation.as_mut().unwrap().kind = certificates::OperationKind::Import;
    assert!(!ProxyRuntime::acme_retry_is_due_at(&certificate, now));
    certificate.current_operation.as_mut().unwrap().kind = certificates::OperationKind::Issue;
    for deadline in [None, Some("bad timestamp"), Some("2026-01-06T00:00:01Z")] {
        certificate.next_attempt_at = deadline.map(str::to_owned);
        assert!(!ProxyRuntime::acme_retry_is_due_at(&certificate, now));
    }
    certificate.next_attempt_at = Some("2026-01-06T00:00:00Z".to_owned());
    certificate.candidate = Some(certificates::CertificateCandidate {
        fingerprint: "candidate".to_owned(),
        issued_at: "2026-01-01T00:00:00Z".to_owned(),
        expires_at: "2026-01-07T00:00:00Z".to_owned(),
        last_error_code: None,
        next_attempt_at: None,
    });
    assert!(!ProxyRuntime::acme_retry_is_due_at(&certificate, now));
}

fn timestamp(value: &str) -> OffsetDateTime {
    OffsetDateTime::parse(value, &Rfc3339).expect("test timestamp should parse")
}

fn certificate(source: certificates::CertificateSource, days: i64) -> CertificateMetadata {
    let issued = timestamp("2026-01-01T00:00:00Z");
    let expires = issued + time::Duration::days(days);
    let format = |value: OffsetDateTime| value.format(&Rfc3339).unwrap();
    CertificateMetadata {
        id: "0198d98a-0000-7000-8000-000000000001".to_owned(),
        source,
        environment: Some(certificates::CertificateEnvironment::Staging),
        domains: vec!["example.com".to_owned()],
        status: certificates::CertificateStatus::Valid,
        operation: certificates::CertificateOperation::Idle,
        issued_at: Some(format(issued)),
        expires_at: Some(format(expires)),
        issuer: Some("test".to_owned()),
        fingerprint: Some("sha256:".to_owned() + &"0".repeat(64)),
        last_error_code: None,
        updated_at: format(issued),
        next_attempt_at: None,
        attempt_count: 0,
        last_attempt_at: None,
        last_success_at: None,
        next_renewal_at: Some(format(
            issued + time::Duration::seconds(days.saturating_mul(86_400).saturating_mul(2) / 3),
        )),
        candidate: None,
        dns_cleanup_pending: false,
        current_operation: None,
        challenge_type: None,
        last_activated_at: None,
        last_error_at: None,
    }
}

#[test]
fn renewal_starts_after_two_thirds_of_each_real_lifetime() {
    for days in [6, 30, 45, 90] {
        let certificate = certificate(certificates::CertificateSource::Acme, days);
        let issued = timestamp("2026-01-01T00:00:00Z");
        let renewal_at = issued + time::Duration::seconds(days * 86_400 * 2 / 3);
        assert!(
            !ProxyRuntime::renewal_is_due_at(&certificate, renewal_at - time::Duration::seconds(1),),
            "{days}-day certificate must remain idle before its boundary"
        );
        assert!(
            ProxyRuntime::renewal_is_due_at(&certificate, renewal_at),
            "{days}-day certificate must renew at its boundary"
        );
    }
}

#[test]
fn imported_certificates_are_never_due_for_acme_renewal() {
    let certificate = certificate(certificates::CertificateSource::Manual, 6);
    let now = timestamp("2026-01-06T00:00:00Z");
    assert!(!ProxyRuntime::renewal_is_due_at(&certificate, now));
}

#[test]
fn failed_initial_issue_is_retried_at_its_deadline_without_certificate_dates() {
    let now = timestamp("2026-01-06T00:00:00Z");
    let mut certificate = certificate(certificates::CertificateSource::Acme, 6);
    certificate.status = certificates::CertificateStatus::Failed;
    certificate.issued_at = None;
    certificate.expires_at = None;
    certificate.next_attempt_at = Some("2026-01-06T00:00:00Z".to_owned());
    certificate.current_operation = Some(certificates::CurrentOperation {
        id: certificate.id.clone(),
        kind: certificates::OperationKind::Issue,
        stage: certificates::CertificateOperationStage::RetryScheduled,
        started_at: certificate.updated_at.clone(),
        updated_at: certificate.updated_at.clone(),
    });
    assert!(!ProxyRuntime::renewal_is_due_at(&certificate, now));
    assert!(!ProxyRuntime::acme_retry_is_due_at(
        &certificate,
        now - time::Duration::seconds(1)
    ));
    assert!(ProxyRuntime::acme_retry_is_due_at(&certificate, now));
    certificate.operation = certificates::CertificateOperation::Issuing;
    assert!(!ProxyRuntime::acme_retry_is_due_at(&certificate, now));
    certificate.operation = certificates::CertificateOperation::Idle;
    certificate.source = certificates::CertificateSource::Manual;
    assert!(!ProxyRuntime::acme_retry_is_due_at(&certificate, now));
    certificate.source = certificates::CertificateSource::Acme;
    certificate.current_operation.as_mut().unwrap().stage =
        certificates::CertificateOperationStage::Failed;
    assert!(!ProxyRuntime::acme_retry_is_due_at(&certificate, now));
}
