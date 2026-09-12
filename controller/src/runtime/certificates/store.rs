use std::collections::BTreeSet;
use std::path::PathBuf;

use super::{
    CERTIFICATES_DIRECTORY, CertificateError, CertificateIndex, CertificateStore,
    CertificateStoreReadiness, SafeDir, state_dir,
};

impl CertificateStore {
    pub(crate) fn new(state_dir: PathBuf) -> Self {
        Self {
            state_dir,
            index: tokio::sync::Mutex::new(CertificateIndex::default()),
            leases: tokio::sync::Mutex::new(BTreeSet::new()),
            readiness: tokio::sync::Mutex::new(CertificateStoreReadiness::NotReady),
        }
    }

    pub(super) async fn acquire_lease(&self, id: &str) -> Result<(), CertificateError> {
        let mut leases = self.leases.lock().await;
        if !leases.insert(id.to_owned()) {
            return Err(CertificateError::OperationInProgress);
        }
        Ok(())
    }

    pub(super) async fn release_lease(&self, id: &str) {
        self.leases.lock().await.remove(id);
    }

    pub(super) fn state_dir(&self) -> Result<SafeDir, CertificateError> {
        state_dir(&self.state_dir).map_err(|_| CertificateError::StoreUnavailable)
    }

    pub(super) fn certificates_dir(&self) -> Result<SafeDir, CertificateError> {
        self.state_dir()?
            .open_dir(CERTIFICATES_DIRECTORY)
            .map_err(|_| CertificateError::StoreUnavailable)
    }

    pub(super) fn ensure_certificates_dir(&self) -> Result<SafeDir, CertificateError> {
        self.state_dir()?
            .ensure_dir(CERTIFICATES_DIRECTORY)
            .map_err(|_| CertificateError::StoreUnavailable)
    }
}
