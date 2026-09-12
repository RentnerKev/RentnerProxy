use super::material_files::public_metadata_with_candidate;
use super::operations;
use super::persistence::persist_index;
use super::recovery::remove_candidate_manifest;
use super::validation::utc_now;
use super::{
    CertificateError, CertificateMetadata, CertificateOperation, CertificateOperationStage,
    CertificateSource, CertificateStatus, CertificateStore, OperationKind, StagedCertificate,
};

impl CertificateStore {
    pub(crate) async fn commit_staged(
        &self,
        staged: &StagedCertificate,
    ) -> Result<CertificateMetadata, CertificateError> {
        let mut index = self.index.lock().await;
        if let Some(candidate) = index.pending_candidates.get(&staged.id).cloned() {
            let Some(previous) = index.certificates.get(&staged.id).cloned() else {
                drop(index);
                return Err(CertificateError::StoreUnavailable);
            };
            let mut staged_for_compare = staged.stored.clone();
            staged_for_compare.metadata.current_operation =
                candidate.staged.metadata.current_operation.clone();
            if candidate.staged != staged_for_compare
                || candidate.base_material_id != previous.material_id
            {
                drop(index);
                return Err(CertificateError::StoreUnavailable);
            }
            let mut committed = candidate.staged.clone();

            committed.acme = previous.acme.clone().or(committed.acme);
            committed.metadata.operation = CertificateOperation::Idle;
            committed.metadata.status = CertificateStatus::Valid;
            committed.metadata.last_error_code = None;
            committed.metadata.attempt_count = 0;
            let activation_time = utc_now().ok();
            committed.metadata.last_success_at = activation_time.clone();
            committed.metadata.last_attempt_at = previous.metadata.last_attempt_at.clone();
            let operation_kind = committed
                .metadata
                .current_operation
                .as_ref()
                .map(|operation| operation.kind);
            if let Some(operation) = committed.metadata.current_operation.as_mut() {
                operation.stage = CertificateOperationStage::Applied;
                operation.updated_at = committed
                    .metadata
                    .last_success_at
                    .clone()
                    .unwrap_or_else(|| operation.updated_at.clone());
            }
            committed.metadata.updated_at = activation_time
                .clone()
                .unwrap_or_else(|| committed.metadata.updated_at.clone());
            committed.metadata.last_activated_at = committed.metadata.last_success_at.clone();
            committed.next_attempt_at = None;
            committed.retry_delay_seconds = None;

            let previous_events = index.events.clone();
            let previous_event_sequence = index.event_sequence;
            let previous_candidate = index.pending_candidates.remove(&staged.id);
            let previous_active = index
                .certificates
                .insert(staged.id.clone(), committed.clone());
            let operation_id = committed
                .metadata
                .current_operation
                .as_ref()
                .map(|operation| operation.id.clone());
            let append = operation_id.as_deref().map_or(Ok(()), |operation_id| {
                operations::append_event(
                    &mut index,
                    operation_id,
                    &staged.id,
                    operations::CertificateEventKind::Activated,
                    CertificateOperationStage::Applied,
                    None,
                )
                .and_then(|()| {
                    if operation_kind == Some(OperationKind::Renew) {
                        operations::append_event(
                            &mut index,
                            operation_id,
                            &staged.id,
                            operations::CertificateEventKind::Renewed,
                            CertificateOperationStage::Applied,
                            None,
                        )
                    } else {
                        Ok(())
                    }
                })
            });
            if let Err(error) = append {
                if let Some(previous_active) = previous_active.as_ref() {
                    index
                        .certificates
                        .insert(staged.id.clone(), previous_active.clone());
                }
                if let Some(previous_candidate) = previous_candidate.as_ref() {
                    index
                        .pending_candidates
                        .insert(staged.id.clone(), previous_candidate.clone());
                }
                index.events = previous_events;
                index.event_sequence = previous_event_sequence;
                drop(index);
                return Err(error);
            }
            let result = self
                .certificates_dir()
                .and_then(|directory| persist_index(&directory, &index));
            if let Err(error) = result {
                if let Some(previous_active) = previous_active {
                    index
                        .certificates
                        .insert(staged.id.clone(), previous_active);
                }
                if let Some(previous_candidate) = previous_candidate {
                    index
                        .pending_candidates
                        .insert(staged.id.clone(), previous_candidate);
                }
                index.events = previous_events;
                index.event_sequence = previous_event_sequence;

                drop(index);
                return Err(error);
            }
            let metadata = public_metadata_with_candidate(&committed, None);
            drop(index);
            if let Ok(directory) = self.certificates_dir() {
                let _ = remove_candidate_manifest(&directory, &staged.id);
            }
            self.release_lease(&staged.id).await;
            return Ok(metadata);
        }

        self.certificates_dir()
            .and_then(|directory| remove_candidate_manifest(&directory, &staged.id))?;
        let mut committed = staged.stored.clone();
        if committed.metadata.source == CertificateSource::Acme {
            committed.metadata.attempt_count = 0;
            committed.metadata.last_success_at = utc_now().ok();
            committed.next_attempt_at = None;
            committed.retry_delay_seconds = None;
            if let Some(previous) = index.certificates.get(&staged.id) {
                committed.metadata.last_attempt_at = previous.metadata.last_attempt_at.clone();
            }
        } else if let Some(previous) = index.certificates.get(&staged.id) {
            committed.next_attempt_at = previous.next_attempt_at.clone();
            committed.retry_delay_seconds = previous.retry_delay_seconds;
            committed.metadata.attempt_count = previous.metadata.attempt_count;
            committed.metadata.last_attempt_at = previous.metadata.last_attempt_at.clone();
            committed.metadata.last_success_at = previous.metadata.last_success_at.clone();
        }
        let committed_at = utc_now().ok();
        if let Some(operation) = committed.metadata.current_operation.as_mut() {
            operation.stage = CertificateOperationStage::Applied;
            operation.updated_at = committed_at
                .clone()
                .unwrap_or_else(|| operation.updated_at.clone());
            committed.metadata.last_activated_at = Some(operation.updated_at.clone());
        }
        committed.metadata.updated_at =
            committed_at.unwrap_or_else(|| committed.metadata.updated_at.clone());
        let is_manual_import = committed.metadata.source == CertificateSource::Manual;
        let operation_id = committed
            .metadata
            .current_operation
            .as_ref()
            .map(|operation| operation.id.clone());
        let previous_events = index.events.clone();
        let previous_event_sequence = index.event_sequence;
        let previous = index
            .certificates
            .insert(staged.id.clone(), committed.clone());
        let append = operation_id.as_deref().map_or(Ok(()), |operation_id| {
            let import_events = if is_manual_import {
                operations::append_event(
                    &mut index,
                    operation_id,
                    &staged.id,
                    operations::CertificateEventKind::Accepted,
                    CertificateOperationStage::Queued,
                    None,
                )
                .and_then(|()| {
                    operations::append_event(
                        &mut index,
                        operation_id,
                        &staged.id,
                        operations::CertificateEventKind::Started,
                        CertificateOperationStage::Queued,
                        None,
                    )
                })
            } else {
                Ok(())
            };
            import_events.and_then(|()| {
                operations::append_event(
                    &mut index,
                    operation_id,
                    &staged.id,
                    operations::CertificateEventKind::Activated,
                    CertificateOperationStage::Applied,
                    None,
                )
            })
        });
        if let Err(error) = append {
            match previous.as_ref() {
                Some(previous) => {
                    index
                        .certificates
                        .insert(staged.id.clone(), previous.clone());
                }
                None => {
                    index.certificates.remove(&staged.id);
                }
            }
            index.events = previous_events;
            index.event_sequence = previous_event_sequence;
            drop(index);
            return Err(error);
        }
        let result = self
            .certificates_dir()
            .and_then(|directory| persist_index(&directory, &index));
        if let Err(error) = result {
            match previous {
                Some(previous) => {
                    index.certificates.insert(staged.id.clone(), previous);
                }
                None => {
                    index.certificates.remove(&staged.id);
                }
            }
            index.events = previous_events;
            index.event_sequence = previous_event_sequence;
            drop(index);
            return Err(error);
        }
        let metadata = public_metadata_with_candidate(&committed, None);
        drop(index);
        self.release_lease(&staged.id).await;
        Ok(metadata)
    }

    pub(crate) async fn discard_staged(&self, staged: &StagedCertificate) {
        let mut index = self.index.lock().await;
        if let Some(previous) = index.certificates.get(&staged.id).cloned()
            && previous
                .metadata
                .current_operation
                .as_ref()
                .is_some_and(|operation| {
                    staged
                        .stored
                        .metadata
                        .current_operation
                        .as_ref()
                        .is_some_and(|staged_operation| staged_operation.id == operation.id)
                })
        {
            let mut failed = previous;
            if let Some(operation) = failed.metadata.current_operation.as_mut() {
                operation.stage = CertificateOperationStage::Failed;
                operation.updated_at = utc_now().unwrap_or_else(|_| operation.updated_at.clone());
            }
            failed.metadata.updated_at = failed
                .metadata
                .current_operation
                .as_ref()
                .map(|operation| operation.updated_at.clone())
                .unwrap_or_else(|| failed.metadata.updated_at.clone());
            failed.metadata.status = if failed.material_id.is_some() {
                CertificateStatus::Valid
            } else {
                CertificateStatus::Failed
            };
            failed.metadata.last_error_code =
                Some(CertificateError::RuntimeApplyFailed.code().to_owned());
            failed.metadata.last_error_at = utc_now().ok();
            index.certificates.insert(staged.id.clone(), failed);
            let operation_id = index
                .certificates
                .get(&staged.id)
                .and_then(|entry| entry.metadata.current_operation.as_ref())
                .map(|operation| operation.id.clone());
            if let Some(operation_id) = operation_id {
                let _ = operations::append_event(
                    &mut index,
                    &operation_id,
                    &staged.id,
                    operations::CertificateEventKind::Failed,
                    CertificateOperationStage::Failed,
                    Some(CertificateError::RuntimeApplyFailed.code().to_owned()),
                );
            }
            if let Ok(directory) = self.certificates_dir() {
                let _ = persist_index(&directory, &index);
            }
        }
        drop(index);
        self.release_lease(&staged.id).await;
    }
}
