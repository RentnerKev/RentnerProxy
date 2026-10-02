use super::{
    CertificateError, CertificateEventPage, CertificateImportRequest, CertificateMetadata,
    CertificateOperationStage, CertificateStoreReadiness, ProxyRuntime, StagedCertificate,
};
use std::sync::Arc;
use tokio::time::timeout;

impl ProxyRuntime {
    pub(crate) async fn certificates(&self) -> Result<Vec<CertificateMetadata>, CertificateError> {
        self.certificate_store.list().await
    }

    pub(crate) async fn certificate_store_readiness(&self) -> CertificateStoreReadiness {
        self.certificate_store.readiness().await
    }

    pub(crate) async fn certificate_events(
        &self,
        after: Option<&str>,
        limit: usize,
    ) -> Result<CertificateEventPage, CertificateError> {
        self.certificate_store.events(after, limit).await
    }

    pub(crate) async fn certificate(
        &self,
        id: &str,
    ) -> Result<CertificateMetadata, CertificateError> {
        self.certificate_store.get(id).await
    }

    pub(crate) async fn import_certificate(
        self: &Arc<Self>,
        id: &str,
        request: CertificateImportRequest,
    ) -> Result<CertificateMetadata, CertificateError> {
        let runtime = Arc::clone(self);
        let id = id.to_owned();
        tokio::spawn(async move { runtime.import_certificate_inner(&id, request).await })
            .await
            .unwrap_or(Err(CertificateError::StoreUnavailable))
    }

    async fn import_certificate_inner(
        self: &Arc<Self>,
        id: &str,
        request: CertificateImportRequest,
    ) -> Result<CertificateMetadata, CertificateError> {
        let staged = self.certificate_store.stage_manual(id, request).await?;
        self.commit_or_reapply_staged_certificate(staged).await
    }

    pub(super) async fn commit_or_reapply_staged_certificate(
        self: &Arc<Self>,
        staged: StagedCertificate,
    ) -> Result<CertificateMetadata, CertificateError> {
        let id = staged.id().to_owned();
        let recorded = self
            .certificate_store
            .record_operation_stage(&id, CertificateOperationStage::Applying)
            .await;
        if recorded.is_err() || self.apply_staged_for_active(staged.clone()).await.is_err() {
            if staged.is_acme() {
                self.certificate_store
                    .finish_candidate_failed(&staged, CertificateError::RuntimeApplyFailed)
                    .await;
            } else {
                self.certificate_store.discard_staged(&staged).await;
            }
            return Err(CertificateError::RuntimeApplyFailed);
        }
        self.certificate_store.get(&id).await
    }

    pub(crate) async fn retry_certificate_candidate(
        self: &Arc<Self>,
        id: &str,
        scheduled: bool,
    ) -> Result<Option<CertificateMetadata>, CertificateError> {
        let Some(staged) = self
            .certificate_store
            .begin_candidate_activation(id, scheduled)
            .await?
        else {
            return Ok(None);
        };
        self.commit_or_reapply_staged_certificate(staged)
            .await
            .map(Some)
    }

    pub(crate) async fn delete_certificate(&self, id: &str) -> Result<(), CertificateError> {
        let _guard = timeout(self.settings.lock_wait, self.apply_lock.lock())
            .await
            .map_err(|_| CertificateError::InUse)?;
        let state = self.state.lock().await;
        let marker = format!("/certificates/{id}/versions/");
        let in_use =
            !state.engine_available || state.active_json.replace('\\', "/").contains(&marker);
        drop(state);
        let cached_in_use = self.restore_active_configuration().is_some_and(|config| {
            config
                .proxy_hosts
                .iter()
                .any(|host| host.certificate_id.as_deref() == Some(id))
                || config
                    .redirect_hosts
                    .iter()
                    .any(|host| host.certificate_id.as_deref() == Some(id))
        });
        self.certificate_store
            .delete_if_unused(id, in_use || cached_in_use)
            .await
    }
}
