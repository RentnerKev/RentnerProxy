use super::{CertificateMetadata, MAX_CANDIDATE_ACTIVATIONS_PER_TICK, ProxyRuntime, certificates};
use std::{
    sync::{Arc, atomic::Ordering},
    time::Duration,
};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use tokio::time::interval;

impl ProxyRuntime {
    pub(crate) async fn start_renewal_scheduler(
        self: &Arc<Self>,
        challenges: crate::server::challenges::ChallengeStore,
    ) {
        let mut task = self.renewal_task.lock().await;
        if task.is_some() {
            return;
        }
        let runtime = Arc::clone(self);
        *task = Some(tokio::spawn(async move {
            let mut timer = interval(Duration::from_secs(60));
            timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                timer.tick().await;
                runtime.retry_certificate_candidates().await;
                runtime.recover_dns_cleanup().await;
                runtime.renew_due_certificates(challenges.clone()).await;
            }
        }));
    }

    async fn renew_due_certificates(
        self: &Arc<Self>,
        challenges: crate::server::challenges::ChallengeStore,
    ) {
        let Ok(certificates) = self.certificate_store.list().await else {
            return;
        };
        for certificate in certificates {
            if certificate.source != certificates::CertificateSource::Acme
                || certificate.operation != certificates::CertificateOperation::Idle
                || certificate.status != certificates::CertificateStatus::Valid
                || !Self::renewal_is_due(&certificate)
            {
                continue;
            }
            if !self
                .certificate_store
                .renewal_is_allowed(&certificate.id)
                .await
            {
                continue;
            }
            let _ = self
                .start_scheduled_acme_renewal(certificate.id, challenges.clone())
                .await;
        }
    }

    async fn retry_certificate_candidates(self: &Arc<Self>) {
        let Ok(mut ids) = self.certificate_store.pending_candidate_ids().await else {
            return;
        };
        if ids.is_empty() {
            return;
        }
        let offset = self.candidate_cursor.fetch_add(1, Ordering::Relaxed) % ids.len();
        ids.rotate_left(offset);
        for id in ids.into_iter().take(MAX_CANDIDATE_ACTIVATIONS_PER_TICK) {
            if self.stopping.load(Ordering::SeqCst) {
                break;
            }
            let _ = self.retry_certificate_candidate(&id, true).await;
        }
    }

    pub(super) fn renewal_is_due(certificate: &CertificateMetadata) -> bool {
        Self::renewal_is_due_at(certificate, OffsetDateTime::now_utc())
    }

    fn renewal_is_due_at(certificate: &CertificateMetadata, now: OffsetDateTime) -> bool {
        if certificate.source != certificates::CertificateSource::Acme
            || certificate.status != certificates::CertificateStatus::Valid
            || certificate.operation != certificates::CertificateOperation::Idle
        {
            return false;
        }
        let Some(issued_at) = certificate.issued_at.as_deref() else {
            return false;
        };
        let Some(expires_at) = certificate.expires_at.as_deref() else {
            return false;
        };
        let Ok(issued_at) = OffsetDateTime::parse(issued_at, &Rfc3339) else {
            return false;
        };
        let Ok(expires_at) = OffsetDateTime::parse(expires_at, &Rfc3339) else {
            return false;
        };
        let Some(renewal_at) = certificates::renewal_timestamp(issued_at, expires_at) else {
            return false;
        };
        now >= renewal_at
    }
}

#[cfg(test)]
mod renewal_tests {
    use super::*;

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
                !ProxyRuntime::renewal_is_due_at(
                    &certificate,
                    renewal_at - time::Duration::seconds(1),
                ),
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
}
