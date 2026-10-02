use super::material_files::validate_candidate_material;
use super::operations;
use super::persistence::persist_index;
use super::recovery::persist_candidate_manifest;
use super::scheduling::{candidate_retry_deadline, next_candidate_retry_delay};
use super::validation::utc_now;
use super::{
    CertificateError, CertificateEventKind, CertificateOperation, CertificateOperationStage,
    CertificateStatus, CertificateStore, OffsetDateTime, Rfc3339, StagedCertificate,
};

impl CertificateStore {
    pub(crate) async fn pending_candidate_ids(&self) -> Result<Vec<String>, CertificateError> {
        let index = self.index.lock().await;
        Ok(index.pending_candidates.keys().cloned().collect())
    }

    pub(crate) async fn begin_candidate_activation(
        &self,
        id: &str,
        scheduled: bool,
    ) -> Result<Option<StagedCertificate>, CertificateError> {
        self.acquire_lease(id).await?;
        let now = OffsetDateTime::now_utc();
        let (candidate, active) = {
            let index = self.index.lock().await;
            let Some(candidate) = index.pending_candidates.get(id).cloned() else {
                drop(index);
                self.release_lease(id).await;
                return Ok(None);
            };
            let Some(active) = index.certificates.get(id).cloned() else {
                drop(index);
                self.release_lease(id).await;
                return Err(CertificateError::StoreUnavailable);
            };
            if active.material_id == candidate.staged.material_id {
                drop(index);
                self.release_lease(id).await;
                return Ok(None);
            }
            if candidate.base_material_id != active.material_id {
                drop(index);
                self.release_lease(id).await;
                return Err(CertificateError::StoreUnavailable);
            }
            if active.metadata.operation != CertificateOperation::Idle {
                drop(index);
                self.release_lease(id).await;
                return Err(CertificateError::OperationInProgress);
            }
            if scheduled
                && candidate
                    .activation
                    .next_attempt_at
                    .as_deref()
                    .and_then(|deadline| OffsetDateTime::parse(deadline, &Rfc3339).ok())
                    .is_some_and(|deadline| deadline > now)
            {
                drop(index);
                self.release_lease(id).await;
                return Ok(None);
            }
            (candidate, active)
        };

        let certificates_dir = match self.certificates_dir() {
            Ok(directory) => directory,
            Err(error) => {
                self.release_lease(id).await;
                return Err(error);
            }
        };
        if let Err(error) = validate_candidate_material(&certificates_dir, id, &candidate.staged) {
            self.finish_candidate_attention(id, error).await;
            return Err(error);
        }

        let now_string = match utc_now() {
            Ok(now) => now,
            Err(error) => {
                self.release_lease(id).await;
                return Err(error);
            }
        };
        let mut attempted_candidate = candidate.clone();
        attempted_candidate.activation.attempt_count = attempted_candidate
            .activation
            .attempt_count
            .saturating_add(1);
        attempted_candidate.activation.last_attempt_at = Some(now_string.clone());
        attempted_candidate.activation.last_error_code = None;
        attempted_candidate.activation.next_attempt_at = None;
        let mut index = self.index.lock().await;
        let Some(current_candidate) = index.pending_candidates.get(id).cloned() else {
            drop(index);
            self.release_lease(id).await;
            return Ok(None);
        };
        let Some(current_active) = index.certificates.get(id).cloned() else {
            drop(index);
            self.release_lease(id).await;
            return Err(CertificateError::StoreUnavailable);
        };
        if current_candidate.staged != candidate.staged
            || current_candidate.base_material_id != active.material_id
            || current_active.material_id != active.material_id
            || current_active.metadata.operation != CertificateOperation::Idle
        {
            drop(index);
            self.release_lease(id).await;
            return Err(CertificateError::OperationInProgress);
        }
        if let Err(error) = persist_candidate_manifest(&certificates_dir, id, &attempted_candidate)
        {
            drop(index);
            self.release_lease(id).await;
            return Err(error);
        }

        index
            .pending_candidates
            .insert(id.to_owned(), attempted_candidate.clone());
        let active_before = current_active;
        let mut active_attempt = active_before.clone();
        active_attempt.metadata.operation = attempted_candidate.activation_operation;
        active_attempt.metadata.last_error_code = None;
        active_attempt.metadata.updated_at = now_string;
        index.certificates.insert(id.to_owned(), active_attempt);

        let _ = persist_index(&certificates_dir, &index);
        drop(index);
        Ok(Some(StagedCertificate {
            id: id.to_owned(),
            stored: attempted_candidate.staged,
        }))
    }

    pub(crate) async fn finish_candidate_failed(
        &self,
        staged: &StagedCertificate,
        error: CertificateError,
    ) {
        let mut index = self.index.lock().await;
        let Some(previous_candidate) = index.pending_candidates.get(&staged.id).cloned() else {
            drop(index);
            self.release_lease(&staged.id).await;
            return;
        };
        let mut staged_for_compare = staged.stored.clone();
        staged_for_compare.metadata.current_operation =
            previous_candidate.staged.metadata.current_operation.clone();
        if previous_candidate.staged != staged_for_compare {
            drop(index);
            self.release_lease(&staged.id).await;
            return;
        }
        let now = utc_now().ok();
        let mut candidate = previous_candidate;
        candidate.activation.attempt_count = candidate.activation.attempt_count.max(1);
        let delay = next_candidate_retry_delay(
            &staged.id,
            candidate.activation.attempt_count,
            candidate.activation.retry_delay_seconds,
        );
        candidate.activation.retry_delay_seconds = Some(delay);
        candidate.activation.next_attempt_at = candidate_retry_deadline(delay);
        candidate.activation.last_error_code = Some(error.code().to_owned());
        if candidate.activation.last_attempt_at.is_none() {
            candidate.activation.last_attempt_at = now.clone();
        }
        if let Some(operation) = candidate.staged.metadata.current_operation.as_mut() {
            operation.stage = CertificateOperationStage::RetryScheduled;
            if let Some(now) = now.clone() {
                operation.updated_at = now;
            }
        }
        index
            .pending_candidates
            .insert(staged.id.clone(), candidate.clone());
        if let Some(active) = index.certificates.get_mut(&staged.id) {
            active.metadata.operation = CertificateOperation::Idle;
            active.metadata.status = if active.material_id.is_some() {
                CertificateStatus::Valid
            } else {
                CertificateStatus::Failed
            };
            active.metadata.last_error_code = Some(error.code().to_owned());
            active.metadata.last_error_at = now.clone();
            active.metadata.current_operation = candidate.staged.metadata.current_operation.clone();
            if let Some(now) = now {
                active.metadata.updated_at = now;
            }
        }

        if let Ok(directory) = self.certificates_dir() {
            let _ = persist_candidate_manifest(&directory, &staged.id, &candidate);
            if let Some(operation) = candidate.staged.metadata.current_operation.as_ref() {
                let _ = operations::append_event(
                    &mut index,
                    &operation.id,
                    &staged.id,
                    operations::CertificateEventKind::Failed,
                    CertificateOperationStage::Failed,
                    Some(error.code().to_owned()),
                );
                let _ = operations::append_event(
                    &mut index,
                    &operation.id,
                    &staged.id,
                    operations::CertificateEventKind::RetryScheduled,
                    CertificateOperationStage::RetryScheduled,
                    Some(error.code().to_owned()),
                );
            }
            let _ = persist_index(&directory, &index);
        }
        drop(index);
        self.release_lease(&staged.id).await;
    }

    async fn finish_candidate_attention(&self, id: &str, error: CertificateError) {
        let mut index = self.index.lock().await;
        let Some(mut candidate) = index.pending_candidates.get(id).cloned() else {
            drop(index);
            self.release_lease(id).await;
            return;
        };
        let Some(operation) = candidate.staged.metadata.current_operation.as_mut() else {
            drop(index);
            self.release_lease(id).await;
            return;
        };
        operation.stage = CertificateOperationStage::NeedsAttention;
        operation.updated_at = utc_now().unwrap_or_else(|_| operation.updated_at.clone());
        candidate.activation.last_error_code = Some(error.code().to_owned());
        candidate.activation.next_attempt_at = None;
        candidate.activation.retry_delay_seconds = None;
        index
            .pending_candidates
            .insert(id.to_owned(), candidate.clone());
        let candidate_operation = candidate.staged.metadata.current_operation.clone();
        if let Some(active) = index.certificates.get_mut(id) {
            active.metadata.operation = CertificateOperation::Idle;
            active.metadata.last_error_code = Some(error.code().to_owned());
            active.metadata.last_error_at = utc_now().ok();
            active.metadata.current_operation = candidate_operation.clone();
            active.metadata.updated_at =
                utc_now().unwrap_or_else(|_| active.metadata.updated_at.clone());
        }
        if let Ok(directory) = self.certificates_dir() {
            let _ = persist_candidate_manifest(&directory, id, &candidate);
            if let Some(operation) = candidate_operation {
                let _ = operations::append_event(
                    &mut index,
                    &operation.id,
                    id,
                    CertificateEventKind::Failed,
                    CertificateOperationStage::NeedsAttention,
                    Some(error.code().to_owned()),
                );
            }
            let _ = persist_index(&directory, &index);
        }
        drop(index);
        self.release_lease(id).await;
    }
}
