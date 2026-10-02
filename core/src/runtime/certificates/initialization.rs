use super::CERTIFICATE_INDEX_FILE;
use super::material_files::public_metadata_with_candidate;
use super::operations;
use super::persistence::persist_index;
use super::recovery::{persist_candidate_manifest, reconcile_candidate_manifests};
use super::scheduling::{account_retry_is_blocking, max_retry_deadline, retry_is_blocking};
use super::validation::{index_is_valid, read_regular_private_file, utc_now};
use super::{
    CertificateError, CertificateEventKind, CertificateEventPage, CertificateIndex,
    CertificateMetadata, CertificateOperation, CertificateOperationStage, CertificateStatus,
    CertificateStore, CertificateStoreReadiness, MAX_ACME_RETRY_DELAY_SECONDS,
    MAX_CERTIFICATE_INDEX_BYTES, MIN_ACME_RETRY_DELAY_SECONDS, OffsetDateTime,
    default_event_journal_version,
};

impl CertificateStore {
    pub(crate) async fn initialize(&self) -> Result<(), CertificateError> {
        let result = self.initialize_inner().await;
        let readiness = if result.is_ok() {
            CertificateStoreReadiness::Ready
        } else {
            let current = *self.readiness.lock().await;
            if matches!(current, CertificateStoreReadiness::Corrupt) {
                current
            } else {
                CertificateStoreReadiness::InitializationFailed
            }
        };
        *self.readiness.lock().await = readiness;
        result
    }

    async fn initialize_inner(&self) -> Result<(), CertificateError> {
        let certificates_dir = self.ensure_certificates_dir()?;
        let mut index = match read_regular_private_file(
            &certificates_dir,
            CERTIFICATE_INDEX_FILE,
            MAX_CERTIFICATE_INDEX_BYTES,
        )? {
            Some(bytes) => match serde_json::from_slice(&bytes) {
                Ok(index) => index,
                Err(_) => {
                    *self.readiness.lock().await = CertificateStoreReadiness::Corrupt;
                    return Err(CertificateError::StoreUnavailable);
                }
            },
            None => CertificateIndex::default(),
        };
        let generated_store_id = index.store_id.is_empty();
        if generated_store_id {
            index.store_id = operations::new_uuid_v7()?;
        }
        if index.event_journal_version == 0 {
            index.event_journal_version = default_event_journal_version();
        }
        if !index_is_valid(&index) {
            *self.readiness.lock().await = CertificateStoreReadiness::Corrupt;
            return Err(CertificateError::StoreUnavailable);
        }
        let recovered_candidate_state =
            match reconcile_candidate_manifests(&certificates_dir, &mut index) {
                Ok(changed) => changed,
                Err(error) => {
                    *self.readiness.lock().await = CertificateStoreReadiness::Corrupt;
                    return Err(error);
                }
            };
        let mut recovered_interrupted_operation = false;
        let recovery_now = utc_now()?;
        let recovery_deadline = OffsetDateTime::now_utc().checked_add(time::Duration::seconds(
            i64::from(MIN_ACME_RETRY_DELAY_SECONDS),
        ));
        let mut recovery_events = Vec::new();
        for (id, entry) in &mut index.certificates {
            if entry.metadata.operation != CertificateOperation::Idle {
                entry.metadata.operation = CertificateOperation::Idle;
                entry.metadata.status = if entry.material_id.is_some() {
                    CertificateStatus::Valid
                } else {
                    CertificateStatus::Failed
                };
                if let Some(candidate) = index.pending_candidates.get(id) {
                    entry.metadata.last_error_code = candidate.activation.last_error_code.clone();
                    entry.metadata.updated_at = recovery_now.clone();
                    recovered_interrupted_operation = true;
                    continue;
                }
                entry.metadata.last_error_code =
                    Some(CertificateError::AcmeFailed.code().to_owned());
                entry.metadata.attempt_count = entry.metadata.attempt_count.max(1);
                if entry.metadata.last_attempt_at.is_none() {
                    entry.metadata.last_attempt_at = Some(recovery_now.clone());
                }
                entry.metadata.last_error_at = Some(recovery_now.clone());
                let operation_id = entry
                    .metadata
                    .current_operation
                    .as_ref()
                    .map(|operation| operation.id.clone());
                if let Some(operation) = entry.metadata.current_operation.as_mut() {
                    operation.stage = CertificateOperationStage::RetryScheduled;
                    operation.updated_at = recovery_now.clone();
                }
                entry.retry_delay_seconds = Some(
                    entry
                        .retry_delay_seconds
                        .unwrap_or(MIN_ACME_RETRY_DELAY_SECONDS)
                        .clamp(MIN_ACME_RETRY_DELAY_SECONDS, MAX_ACME_RETRY_DELAY_SECONDS),
                );
                if let Some(recovery_deadline) = recovery_deadline {
                    entry.next_attempt_at =
                        max_retry_deadline(entry.next_attempt_at.as_deref(), recovery_deadline);
                }
                entry.metadata.updated_at = recovery_now.clone();
                if let Some(operation_id) = operation_id {
                    recovery_events.push((
                        operation_id,
                        entry.metadata.id.clone(),
                        entry.metadata.last_error_code.clone(),
                    ));
                }
                recovered_interrupted_operation = true;
            }
        }
        for (operation_id, certificate_id, error_code) in recovery_events {
            let _ = operations::append_event(
                &mut index,
                &operation_id,
                &certificate_id,
                CertificateEventKind::Failed,
                CertificateOperationStage::Failed,
                error_code.clone(),
            );
            let _ = operations::append_event(
                &mut index,
                &operation_id,
                &certificate_id,
                CertificateEventKind::RetryScheduled,
                CertificateOperationStage::RetryScheduled,
                error_code,
            );
        }
        if generated_store_id || recovered_interrupted_operation || recovered_candidate_state {
            persist_index(&certificates_dir, &index)?;
        }
        *self.index.lock().await = index;
        Ok(())
    }

    pub(crate) async fn readiness(&self) -> CertificateStoreReadiness {
        *self.readiness.lock().await
    }

    pub(crate) async fn renewal_is_allowed(&self, id: &str) -> bool {
        let index = self.index.lock().await;
        let now = OffsetDateTime::now_utc();
        index.certificates.get(id).is_some_and(|entry| {
            !index.pending_candidates.contains_key(id)
                && !retry_is_blocking(entry, now)
                && entry
                    .metadata
                    .environment
                    .is_none_or(|environment| !account_retry_is_blocking(&index, environment, now))
        })
    }
    pub(crate) async fn list(&self) -> Result<Vec<CertificateMetadata>, CertificateError> {
        self.ensure_ready().await?;
        let index = self.index.lock().await;
        Ok(index
            .certificates
            .iter()
            .map(|(id, stored)| {
                public_metadata_with_candidate(stored, index.pending_candidates.get(id))
            })
            .collect())
    }

    pub(crate) async fn get(&self, id: &str) -> Result<CertificateMetadata, CertificateError> {
        self.ensure_ready().await?;
        let index = self.index.lock().await;
        index
            .certificates
            .get(id)
            .map(|stored| public_metadata_with_candidate(stored, index.pending_candidates.get(id)))
            .ok_or(CertificateError::NotFound)
    }

    pub(crate) async fn events(
        &self,
        after: Option<&str>,
        limit: usize,
    ) -> Result<CertificateEventPage, CertificateError> {
        self.ensure_ready().await?;
        let index = self.index.lock().await;
        operations::events_page(&index, after, limit)
    }

    pub(crate) async fn record_operation_stage(
        &self,
        id: &str,
        stage: CertificateOperationStage,
    ) -> Result<(), CertificateError> {
        self.ensure_ready().await?;
        let now = utc_now()?;
        let certificates_dir = self.certificates_dir()?;
        let mut index = self.index.lock().await;
        let Some(previous_active) = index.certificates.get(id).cloned() else {
            return Ok(());
        };
        let Some(mut operation) = previous_active.metadata.current_operation.clone() else {
            return Err(CertificateError::OperationInProgress);
        };
        if operation.stage == stage {
            return Ok(());
        }
        operation.stage = stage;
        operation.updated_at = now;
        let previous_candidate = index.pending_candidates.get(id).cloned();
        let previous_events = index.events.clone();
        let previous_sequence = index.event_sequence;
        if let Some(active) = index.certificates.get_mut(id) {
            active.metadata.current_operation = Some(operation.clone());
            active.metadata.updated_at = operation.updated_at.clone();
        }
        if let Some(candidate) = index.pending_candidates.get_mut(id) {
            candidate.staged.metadata.current_operation = Some(operation.clone());
        }
        if let Some(kind) = operations::event_kind_for_stage(stage) {
            let error_code = (stage == CertificateOperationStage::Failed
                || stage == CertificateOperationStage::NeedsAttention)
                .then(|| {
                    index
                        .certificates
                        .get(id)
                        .and_then(|entry| entry.metadata.last_error_code.clone())
                })
                .flatten();
            operations::append_event(&mut index, &operation.id, id, kind, stage, error_code)?;
        }
        if let Some(candidate) = index.pending_candidates.get(id)
            && let Err(error) = persist_candidate_manifest(&certificates_dir, id, candidate)
        {
            index
                .certificates
                .insert(id.to_owned(), previous_active.clone());
            if let Some(previous_candidate) = previous_candidate.as_ref() {
                index
                    .pending_candidates
                    .insert(id.to_owned(), previous_candidate.clone());
            }
            index.events = previous_events;
            index.event_sequence = previous_sequence;
            return Err(error);
        }
        if let Err(error) = persist_index(&certificates_dir, &index) {
            index.certificates.insert(id.to_owned(), previous_active);
            if let Some(previous_candidate) = previous_candidate.as_ref() {
                index
                    .pending_candidates
                    .insert(id.to_owned(), previous_candidate.clone());
                let _ = persist_candidate_manifest(&certificates_dir, id, previous_candidate);
            }
            index.events = previous_events;
            index.event_sequence = previous_sequence;
            return Err(error);
        }
        Ok(())
    }

    async fn ensure_ready(&self) -> Result<(), CertificateError> {
        if matches!(self.readiness().await, CertificateStoreReadiness::Ready) {
            Ok(())
        } else {
            Err(CertificateError::StoreUnavailable)
        }
    }
}
