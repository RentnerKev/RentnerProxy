use super::{
    CertificateError, CertificateOperation, CertificateStore, CertificateStoreReadiness,
    DnsProviderConfig, encrypt, persistence::persist_index,
};

impl CertificateStore {
    pub(in crate::runtime) async fn dns_configurations(
        &self,
    ) -> Result<Vec<(String, DnsProviderConfig, bool)>, CertificateError> {
        if self.readiness().await != CertificateStoreReadiness::Ready {
            return Err(CertificateError::StoreUnavailable);
        }
        let index = self.index.lock().await;
        let mut configurations = Vec::new();
        for (id, entry) in &index.certificates {
            if let Some(acme) = &entry.acme
                && let Some(encrypted) = &acme.dns_provider
            {
                configurations.push((
                    id.clone(),
                    crate::runtime::dns::decrypt(encrypted, id)?,
                    entry.metadata.operation == CertificateOperation::Idle
                        && acme.pending_dns_records.is_empty()
                        && !index.pending_candidates.contains_key(id),
                ));
            }
        }
        for (id, candidate) in &index.pending_candidates {
            if let Some(acme) = &candidate.staged.acme
                && let Some(encrypted) = &acme.dns_provider
            {
                configurations.push((
                    id.clone(),
                    crate::runtime::dns::decrypt(encrypted, id)?,
                    false,
                ));
            }
        }
        Ok(configurations)
    }

    pub(in crate::runtime) async fn adopt_dns_connection(
        &self,
        id: &str,
        expected: &DnsProviderConfig,
        connection: &DnsProviderConfig,
    ) -> Result<(), CertificateError> {
        self.acquire_lease(id).await?;
        let result = async {
            let mut index = self.index.lock().await;
            let current = index
                .certificates
                .get(id)
                .ok_or(CertificateError::NotFound)?;
            let acme = current
                .acme
                .as_ref()
                .ok_or(CertificateError::DnsProviderInvalid)?;
            if current.metadata.operation != CertificateOperation::Idle
                || index.pending_candidates.contains_key(id)
                || !acme.pending_dns_records.is_empty()
                || acme
                    .dns_provider
                    .as_ref()
                    .map(|value| crate::runtime::dns::decrypt(value, id))
                    .transpose()?
                    .as_ref()
                    != Some(expected)
            {
                return Err(CertificateError::OperationInProgress);
            }
            let mut next = index.clone();
            let acme = next
                .certificates
                .get_mut(id)
                .and_then(|entry| entry.acme.as_mut())
                .ok_or(CertificateError::NotFound)?;
            acme.dns_provider = Some(encrypt(connection, id)?);
            let directory = self.certificates_dir()?;
            if let Err(error) = persist_index(&directory, &next) {
                // A rename can succeed before a final fsync fails. Re-read the
                // authoritative index before any caller may prune reservations.
                let restored = super::validation::read_regular_private_file(
                    &directory,
                    super::CERTIFICATE_INDEX_FILE,
                    super::MAX_CERTIFICATE_INDEX_BYTES,
                )
                .ok()
                .flatten()
                .and_then(|bytes| serde_json::from_slice(&bytes).ok())
                .filter(super::validation::index_is_valid);
                if let Some(restored) = restored {
                    *index = restored;
                } else {
                    *self.readiness.lock().await = CertificateStoreReadiness::InitializationFailed;
                }
                return Err(error);
            }
            *index = next;
            Ok(())
        }
        .await;
        self.release_lease(id).await;
        result
    }
}
