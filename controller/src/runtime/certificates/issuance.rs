use super::material_files::public_metadata;
use super::operations;
use super::persistence::persist_index;
use super::scheduling::{account_retry_is_blocking, retry_is_blocking};
use super::validation::{
    canonical_domains, has_duplicate_domains, is_acme_request_domain, is_valid_email, utc_now,
};
use super::{
    AcmeChallengeType, CertificateError, CertificateIssueRequest, CertificateMetadata,
    CertificateOperation, CertificateOperationStage, CertificateSource, CertificateStatus,
    CertificateStore, OffsetDateTime, OperationKind, StoredCertificate, StoredMetadata,
};
use crate::proxy::is_canonical_uuid_v7;

impl CertificateStore {
    pub(crate) async fn begin_issue(
        &self,
        id: &str,
        request: CertificateIssueRequest,
        renewal: bool,
    ) -> Result<CertificateMetadata, CertificateError> {
        if !is_canonical_uuid_v7(id)
            || request.domains.is_empty()
            || request.domains.len() > 100
            || request.domains.iter().any(|domain| {
                !is_acme_request_domain(domain, request.challenge_type, request.environment)
            })
            || has_duplicate_domains(&request.domains)
            || (request.challenge_type == AcmeChallengeType::Http01
                && request
                    .domains
                    .iter()
                    .any(|domain| domain.starts_with("*.")))
            || (request.challenge_type == AcmeChallengeType::Http01
                && request.dns_provider.is_some())
            || (request.challenge_type == AcmeChallengeType::Dns01
                && request.dns_provider.is_none())
            || (!renewal && !request.accept_terms)
            || request
                .contact_email
                .as_deref()
                .is_some_and(|email| !is_valid_email(email))
        {
            return Err(if !request.accept_terms && !renewal {
                CertificateError::TermsRequired
            } else if request.challenge_type == AcmeChallengeType::Dns01
                && request.dns_provider.is_none()
            {
                CertificateError::AcmeDnsRequired
            } else {
                CertificateError::AcmeDomainInvalid
            });
        }
        let now = utc_now()?;
        let now_instant = OffsetDateTime::now_utc();
        let acme = if renewal {
            None
        } else {
            Some(self.stored_acme_configuration(id, &request)?)
        };
        self.acquire_lease(id).await?;
        let mut index = self.index.lock().await;
        if index
            .certificates
            .get(id)
            .is_some_and(|current| current.metadata.operation != CertificateOperation::Idle)
        {
            drop(index);
            self.release_lease(id).await;
            return Err(CertificateError::OperationInProgress);
        }
        if index.pending_candidates.contains_key(id) {
            drop(index);
            self.release_lease(id).await;
            return Err(CertificateError::OperationInProgress);
        }
        if index
            .certificates
            .get(id)
            .is_some_and(|current| retry_is_blocking(current, now_instant))
        {
            drop(index);
            self.release_lease(id).await;
            return Err(CertificateError::OperationInProgress);
        }
        if account_retry_is_blocking(&index, request.environment, now_instant) {
            drop(index);
            self.release_lease(id).await;
            return Err(CertificateError::OperationInProgress);
        }
        if !renewal
            && index
                .certificates
                .get(id)
                .and_then(|entry| entry.acme.as_ref())
                .is_some_and(|acme| !acme.pending_dns_records.is_empty())
        {
            drop(index);
            self.release_lease(id).await;
            return Err(CertificateError::DnsCleanupFailed);
        }
        let operation = operations::new_operation(if renewal {
            OperationKind::Renew
        } else {
            OperationKind::Issue
        })?;
        let stored = if let Some(current) = index.certificates.get(id) {
            let mut preserved = current.clone();
            let attempt_count = preserved.metadata.attempt_count.saturating_add(1);
            preserved.metadata.operation = if renewal {
                CertificateOperation::Renewing
            } else {
                CertificateOperation::Issuing
            };
            preserved.metadata.last_error_code = None;
            preserved.metadata.updated_at = now.clone();
            preserved.metadata.attempt_count = attempt_count;
            preserved.metadata.last_attempt_at = Some(now.clone());
            preserved.metadata.current_operation = Some(operation.clone());
            preserved.metadata.challenge_type = Some(request.challenge_type);
            preserved.next_attempt_at = None;
            if !renewal {
                preserved.acme = acme;
            }
            preserved
        } else {
            StoredCertificate {
                metadata: StoredMetadata {
                    id: id.to_owned(),
                    source: CertificateSource::Acme,
                    environment: Some(request.environment),
                    domains: canonical_domains(&request.domains),
                    status: CertificateStatus::Pending,
                    operation: if renewal {
                        CertificateOperation::Renewing
                    } else {
                        CertificateOperation::Issuing
                    },
                    issued_at: None,
                    expires_at: None,
                    issuer: None,
                    fingerprint: None,
                    last_error_code: None,
                    updated_at: now.clone(),
                    attempt_count: 1,
                    last_attempt_at: Some(now),
                    last_success_at: None,
                    current_operation: Some(operation.clone()),
                    challenge_type: Some(request.challenge_type),
                    last_activated_at: None,
                    last_error_at: None,
                },
                material_id: None,
                acme: Some(acme.expect("new ACME requests always have configuration")),
                next_attempt_at: None,
                retry_delay_seconds: None,
            }
        };
        let previous = index.certificates.insert(id.to_owned(), stored.clone());
        let previous_events = index.events.clone();
        let previous_event_sequence = index.event_sequence;
        let operation_id = operation.id.as_str();
        if let Err(error) = operations::append_event(
            &mut index,
            operation_id,
            id,
            operations::CertificateEventKind::Accepted,
            CertificateOperationStage::Queued,
            None,
        )
        .and_then(|()| {
            operations::append_event(
                &mut index,
                operation_id,
                id,
                operations::CertificateEventKind::Started,
                CertificateOperationStage::Queued,
                None,
            )
        }) {
            index.events = previous_events.clone();
            index.event_sequence = previous_event_sequence;
            match previous {
                Some(previous) => {
                    index.certificates.insert(id.to_owned(), previous);
                }
                None => {
                    index.certificates.remove(id);
                }
            }
            drop(index);
            self.release_lease(id).await;
            return Err(error);
        }
        let persistence = self
            .certificates_dir()
            .and_then(|directory| persist_index(&directory, &index));
        if let Err(error) = persistence {
            index.events = previous_events;
            index.event_sequence = previous_event_sequence;
            match previous {
                Some(previous) => {
                    index.certificates.insert(id.to_owned(), previous);
                }
                None => {
                    index.certificates.remove(id);
                }
            }
            drop(index);
            self.release_lease(id).await;
            return Err(error);
        }
        Ok(public_metadata(&stored))
    }

    pub(crate) async fn begin_renewal(
        &self,
        id: &str,
    ) -> Result<(CertificateMetadata, CertificateIssueRequest), CertificateError> {
        self.acquire_lease(id).await?;
        let now = match utc_now() {
            Ok(now) => now,
            Err(error) => {
                self.release_lease(id).await;
                return Err(error);
            }
        };
        let now_instant = OffsetDateTime::now_utc();
        let mut index = self.index.lock().await;
        let Some(current) = index.certificates.get(id) else {
            drop(index);
            self.release_lease(id).await;
            return Err(CertificateError::NotFound);
        };
        if current.metadata.source != CertificateSource::Acme {
            drop(index);
            self.release_lease(id).await;
            return Err(CertificateError::InvalidCertificate);
        }
        if current.metadata.operation != CertificateOperation::Idle {
            drop(index);
            self.release_lease(id).await;
            return Err(CertificateError::OperationInProgress);
        }
        if index.pending_candidates.contains_key(id) {
            drop(index);
            self.release_lease(id).await;
            return Err(CertificateError::OperationInProgress);
        }
        if retry_is_blocking(current, now_instant) {
            drop(index);
            self.release_lease(id).await;
            return Err(CertificateError::OperationInProgress);
        }
        let Some(environment) = current.metadata.environment else {
            drop(index);
            self.release_lease(id).await;
            return Err(CertificateError::AcmeFailed);
        };
        if account_retry_is_blocking(&index, environment, now_instant) {
            drop(index);
            self.release_lease(id).await;
            return Err(CertificateError::OperationInProgress);
        }
        let Some(acme) = current.acme.as_ref() else {
            drop(index);
            self.release_lease(id).await;
            return Err(CertificateError::InvalidCertificate);
        };
        let challenge_type = acme.challenge_type;
        let operation = match operations::new_operation(OperationKind::Renew) {
            Ok(operation) => operation,
            Err(error) => {
                drop(index);
                self.release_lease(id).await;
                return Err(error);
            }
        };
        let previous = current.clone();
        let mut attempted = previous.clone();
        attempted.metadata.operation = CertificateOperation::Renewing;
        attempted.metadata.last_error_code = None;
        attempted.next_attempt_at = None;
        attempted.metadata.attempt_count = attempted.metadata.attempt_count.saturating_add(1);
        attempted.metadata.last_attempt_at = Some(now.clone());
        attempted.metadata.updated_at = now;
        attempted.metadata.current_operation = Some(operation.clone());
        index.certificates.insert(id.to_owned(), attempted.clone());
        let previous_events = index.events.clone();
        let previous_event_sequence = index.event_sequence;
        let operation_id = operation.id.as_str();
        if let Err(error) = operations::append_event(
            &mut index,
            operation_id,
            id,
            operations::CertificateEventKind::Accepted,
            CertificateOperationStage::Queued,
            None,
        )
        .and_then(|()| {
            operations::append_event(
                &mut index,
                operation_id,
                id,
                operations::CertificateEventKind::Started,
                CertificateOperationStage::Queued,
                None,
            )
        }) {
            index.certificates.insert(id.to_owned(), previous.clone());
            index.events = previous_events;
            index.event_sequence = previous_event_sequence;
            drop(index);
            self.release_lease(id).await;
            return Err(error);
        }
        if let Err(error) = self
            .certificates_dir()
            .and_then(|directory| persist_index(&directory, &index))
        {
            index.certificates.insert(id.to_owned(), previous);
            index.events = previous_events;
            index.event_sequence = previous_event_sequence;
            drop(index);
            self.release_lease(id).await;
            return Err(error);
        }

        let dns_provider = match attempted
            .acme
            .as_ref()
            .and_then(|acme| acme.dns_provider.as_ref())
            .map(|encrypted| crate::runtime::dns::decrypt(encrypted, id))
            .transpose()
        {
            Ok(dns_provider) => dns_provider,
            Err(error) => {
                drop(index);

                self.finish_failed(id, error).await;
                return Err(error);
            }
        };
        let request = CertificateIssueRequest {
            domains: attempted.metadata.domains.clone(),
            environment,
            contact_email: attempted
                .acme
                .as_ref()
                .and_then(|acme| acme.contact_email.clone()),
            challenge_type,
            dns_provider,
            accept_terms: true,
        };
        Ok((public_metadata(&attempted), request))
    }
}
