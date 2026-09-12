use super::operations;
use super::persistence::persist_index;
use super::scheduling::{
    max_retry_deadline, max_retry_deadline_string, next_retry_delay, retry_deadline,
};
use super::validation::utc_now;
use super::{
    CertificateEnvironment, CertificateError, CertificateEventKind, CertificateOperation,
    CertificateOperationStage, CertificateSource, CertificateStatus, CertificateStore,
    OffsetDateTime, Rfc3339, StagedCertificate,
};
use crate::proxy::is_canonical_uuid_v7;

impl CertificateStore {
    pub(crate) async fn defer_acme_retry(
        &self,
        id: &str,
        deadline: OffsetDateTime,
    ) -> Result<(), CertificateError> {
        if !is_canonical_uuid_v7(id) {
            return Err(CertificateError::NotFound);
        }
        let deadline = deadline
            .format(&Rfc3339)
            .map_err(|_| CertificateError::StoreUnavailable)?;
        let mut index = self.index.lock().await;
        let Some(previous) = index.certificates.get(id).cloned() else {
            return Err(CertificateError::NotFound);
        };
        if previous.metadata.source != CertificateSource::Acme
            && previous.metadata.operation == CertificateOperation::Idle
        {
            return Err(CertificateError::InvalidCertificate);
        }
        let mut updated = previous;
        updated.next_attempt_at =
            max_retry_deadline_string(updated.next_attempt_at.as_deref(), &deadline)
                .or(Some(deadline));
        if let Ok(now) = utc_now() {
            updated.metadata.updated_at = now;
        }
        index.certificates.insert(id.to_owned(), updated);
        let result = self
            .certificates_dir()
            .and_then(|directory| persist_index(&directory, &index));

        result
    }

    pub(crate) async fn defer_acme_account_retry(
        &self,
        environment: CertificateEnvironment,
        deadline: OffsetDateTime,
    ) -> Result<(), CertificateError> {
        let deadline = deadline
            .format(&Rfc3339)
            .map_err(|_| CertificateError::StoreUnavailable)?;
        let mut index = self.index.lock().await;
        let current = index.acme_retry_until.get(&environment).map(String::as_str);
        let updated = max_retry_deadline_string(current, &deadline).unwrap_or(deadline);
        index.acme_retry_until.insert(environment, updated);
        self.certificates_dir()
            .and_then(|directory| persist_index(&directory, &index))
    }

    pub(crate) async fn finish_failed(&self, id: &str, error: CertificateError) {
        let pending_candidate = {
            let index = self.index.lock().await;
            index
                .pending_candidates
                .get(id)
                .map(|candidate| StagedCertificate {
                    id: id.to_owned(),
                    stored: candidate.staged.clone(),
                })
        };
        if let Some(staged) = pending_candidate {
            self.finish_candidate_failed(&staged, error).await;
            return;
        }
        let mut index = self.index.lock().await;
        if let Some(entry) = index.certificates.get_mut(id) {
            let had_acme_operation = entry.metadata.operation != CertificateOperation::Idle;
            let retryable = entry.metadata.source == CertificateSource::Acme || had_acme_operation;
            let operation_id = entry
                .metadata
                .current_operation
                .as_ref()
                .map(|operation| operation.id.clone());
            entry.metadata.operation = CertificateOperation::Idle;
            entry.metadata.status = if entry.material_id.is_some() {
                CertificateStatus::Valid
            } else {
                CertificateStatus::Failed
            };
            entry.metadata.last_error_code = Some(error.code().to_owned());
            if retryable {
                entry.metadata.attempt_count = entry.metadata.attempt_count.max(1);
                let delay =
                    next_retry_delay(id, entry.metadata.attempt_count, entry.retry_delay_seconds);
                entry.retry_delay_seconds = Some(delay);
                if let Some(deadline) = retry_deadline(delay) {
                    entry.next_attempt_at =
                        max_retry_deadline(entry.next_attempt_at.as_deref(), deadline);
                }
            }
            let now = utc_now().ok();
            if let Some(now) = now.clone() {
                if entry.metadata.last_attempt_at.is_none()
                    && entry.metadata.source == CertificateSource::Acme
                {
                    entry.metadata.last_attempt_at = Some(now.clone());
                }
                entry.metadata.last_error_at = Some(now.clone());
                if let Some(operation) = entry.metadata.current_operation.as_mut() {
                    operation.stage = if retryable {
                        CertificateOperationStage::RetryScheduled
                    } else {
                        CertificateOperationStage::Failed
                    };
                    operation.updated_at = now;
                }
                entry.metadata.updated_at =
                    utc_now().unwrap_or_else(|_| entry.metadata.updated_at.clone());
            }
            if let Some(operation_id) = operation_id {
                let stage = if retryable {
                    CertificateOperationStage::RetryScheduled
                } else {
                    CertificateOperationStage::Failed
                };
                let _ = operations::append_event(
                    &mut index,
                    &operation_id,
                    id,
                    CertificateEventKind::Failed,
                    CertificateOperationStage::Failed,
                    Some(error.code().to_owned()),
                );
                if retryable {
                    let _ = operations::append_event(
                        &mut index,
                        &operation_id,
                        id,
                        CertificateEventKind::RetryScheduled,
                        stage,
                        Some(error.code().to_owned()),
                    );
                }
            }
            let _ = self
                .certificates_dir()
                .and_then(|directory| persist_index(&directory, &index));
        }
        drop(index);
        self.release_lease(id).await;
    }
}
