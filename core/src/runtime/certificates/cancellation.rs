use super::material_files::public_metadata;
use super::persistence::persist_index;
use super::validation::utc_now;
use super::{
    AcmeChallengeType, CertificateError, CertificateMetadata, CertificateOperation,
    CertificateOperationStage, CertificateSource, CertificateStore, DnsValidationMode,
    OperationKind, StoredCertificate,
};
use crate::proxy::is_canonical_uuid_v7;

fn delegated_operation(entry: &StoredCertificate, operation_id: &str) -> bool {
    entry.metadata.source == CertificateSource::Acme
        && entry.metadata.operation != CertificateOperation::Idle
        && entry.acme.as_ref().is_some_and(|acme| {
            acme.dns_mode == DnsValidationMode::Delegated
                && acme.challenge_type == AcmeChallengeType::Dns01
        })
        && entry
            .metadata
            .current_operation
            .as_ref()
            .is_some_and(|operation| {
                operation.id == operation_id
                    && matches!(operation.kind, OperationKind::Issue | OperationKind::Renew)
            })
}

impl CertificateStore {
    pub(crate) async fn request_delegated_cancel(
        &self,
        id: &str,
        operation_id: &str,
    ) -> Result<CertificateMetadata, CertificateError> {
        self.ensure_ready().await?;
        if !is_canonical_uuid_v7(id) {
            return Err(CertificateError::NotFound);
        }
        if !is_canonical_uuid_v7(operation_id) {
            return Err(CertificateError::OperationInProgress);
        }
        // This lock also serializes Finalizing admission, so a cancellation and finalization
        // cannot both be accepted. Persist before publishing the acknowledgement.
        let mut index = self.index.lock().await;
        let previous = index
            .certificates
            .get(id)
            .cloned()
            .ok_or(CertificateError::NotFound)?;
        if index.pending_candidates.contains_key(id)
            || !delegated_operation(&previous, operation_id)
        {
            return Err(CertificateError::OperationInProgress);
        }
        let operation = previous
            .metadata
            .current_operation
            .as_ref()
            .ok_or(CertificateError::OperationInProgress)?;
        if previous
            .acme
            .as_ref()
            .is_some_and(|acme| acme.cancel_requested)
            && operation.stage == CertificateOperationStage::Cancelling
        {
            return Ok(public_metadata(&previous));
        }
        if !matches!(
            operation.stage,
            CertificateOperationStage::Queued
                | CertificateOperationStage::CreatingOrder
                | CertificateOperationStage::PreparingChallenge
                | CertificateOperationStage::WaitingForValidation
        ) {
            return Err(CertificateError::OperationInProgress);
        }
        let mut cancelled = previous.clone();
        let now = utc_now()?;
        cancelled
            .acme
            .as_mut()
            .ok_or(CertificateError::OperationInProgress)?
            .cancel_requested = true;
        let operation = cancelled
            .metadata
            .current_operation
            .as_mut()
            .ok_or(CertificateError::OperationInProgress)?;
        operation.stage = CertificateOperationStage::Cancelling;
        operation.updated_at = now.clone();
        cancelled.metadata.updated_at = now;
        cancelled.next_attempt_at = None;
        cancelled.retry_delay_seconds = None;
        index.certificates.insert(id.to_owned(), cancelled.clone());
        if let Err(error) = self
            .certificates_dir()
            .and_then(|directory| persist_index(&directory, &index))
        {
            index.certificates.insert(id.to_owned(), previous);
            return Err(error);
        }
        Ok(public_metadata(&cancelled))
    }

    pub(crate) async fn delegated_cancel_requested(
        &self,
        id: &str,
        operation_id: &str,
    ) -> Result<bool, CertificateError> {
        let index = self.index.lock().await;
        let entry = index
            .certificates
            .get(id)
            .ok_or(CertificateError::NotFound)?;
        if !delegated_operation(entry, operation_id) {
            return Err(CertificateError::OperationInProgress);
        }
        Ok(entry
            .acme
            .as_ref()
            .is_some_and(|acme| acme.cancel_requested))
    }
}
