use super::persistence::persist_index;
use super::validation::{
    dns_intent_belongs_to, environment_name, read_regular_private_file, utc_now, write_private_file,
};
use super::{
    AcmeChallengeType, CertificateEnvironment, CertificateError, CertificateStore,
    DnsProviderConfig, DnsRecordIntent, MAX_PRIVATE_KEY_PEM_BYTES,
};
use crate::proxy::is_canonical_uuid_v7;

impl CertificateStore {
    pub(crate) async fn pending_dns_records(
        &self,
        id: &str,
    ) -> Result<Vec<DnsRecordIntent>, CertificateError> {
        let index = self.index.lock().await;
        index
            .certificates
            .get(id)
            .ok_or(CertificateError::NotFound)
            .map(|entry| {
                entry
                    .acme
                    .as_ref()
                    .map(|acme| acme.pending_dns_records.clone())
                    .unwrap_or_default()
            })
    }

    pub(crate) async fn pending_dns_cleanup_ids(&self) -> Result<Vec<String>, CertificateError> {
        let index = self.index.lock().await;
        Ok(index
            .certificates
            .iter()
            .filter(|(_, entry)| {
                entry
                    .acme
                    .as_ref()
                    .is_some_and(|acme| !acme.pending_dns_records.is_empty())
            })
            .map(|(id, _)| id.clone())
            .collect())
    }

    pub(crate) async fn begin_dns_cleanup(
        &self,
        id: &str,
    ) -> Result<
        Option<(
            CertificateEnvironment,
            DnsProviderConfig,
            Vec<DnsRecordIntent>,
        )>,
        CertificateError,
    > {
        self.acquire_lease(id).await?;
        let result = {
            let index = self.index.lock().await;
            match index.certificates.get(id) {
                None => Err(CertificateError::NotFound),
                Some(entry) => match entry.acme.as_ref() {
                    None => Ok(None),
                    Some(acme) if acme.pending_dns_records.is_empty() => Ok(None),
                    Some(acme) => entry
                        .metadata
                        .environment
                        .ok_or(CertificateError::DnsCredentialsUnavailable)
                        .and_then(|environment| {
                            acme.dns_provider
                                .as_ref()
                                .ok_or(CertificateError::DnsCredentialsUnavailable)
                                .and_then(|encrypted| {
                                    crate::runtime::dns::decrypt(encrypted, id).map(|provider| {
                                        (environment, provider, acme.pending_dns_records.clone())
                                    })
                                })
                        })
                        .map(Some),
                },
            }
        };
        match result {
            Ok(Some(work)) => Ok(Some(work)),
            Ok(None) => {
                self.release_lease(id).await;
                Ok(None)
            }
            Err(error) => {
                self.release_lease(id).await;
                Err(error)
            }
        }
    }

    pub(crate) async fn finish_dns_cleanup(&self, id: &str) {
        self.release_lease(id).await;
    }

    pub(crate) async fn set_pending_dns_records(
        &self,
        id: &str,
        records: Vec<DnsRecordIntent>,
    ) -> Result<(), CertificateError> {
        if !is_canonical_uuid_v7(id)
            || records.len() > 256
            || records
                .iter()
                .any(|record| !dns_intent_belongs_to(record, id))
        {
            return Err(CertificateError::DnsProviderInvalid);
        }
        let mut index = self.index.lock().await;
        let Some(previous) = index.certificates.get(id).cloned() else {
            return Err(CertificateError::NotFound);
        };
        if previous
            .acme
            .as_ref()
            .is_none_or(|acme| acme.challenge_type != AcmeChallengeType::Dns01)
        {
            return Err(CertificateError::DnsProviderInvalid);
        }
        let mut updated = previous.clone();
        let now = utc_now()?;
        updated.metadata.updated_at = now;
        let Some(acme) = updated.acme.as_mut() else {
            return Err(CertificateError::DnsProviderInvalid);
        };
        acme.pending_dns_records = records;
        index.certificates.insert(id.to_owned(), updated);
        let result = self
            .certificates_dir()
            .and_then(|directory| persist_index(&directory, &index));
        if let Err(error) = result {
            index.certificates.insert(id.to_owned(), previous);
            return Err(error);
        }
        Ok(())
    }

    pub(crate) async fn load_acme_account(
        &self,
        environment: CertificateEnvironment,
    ) -> Result<Option<Vec<u8>>, CertificateError> {
        let directory = self
            .ensure_certificates_dir()?
            .ensure_dir("acme-accounts")
            .map_err(|_| CertificateError::StoreUnavailable)?;
        read_regular_private_file(
            &directory,
            &format!("{}.json", environment_name(environment)),
            MAX_PRIVATE_KEY_PEM_BYTES,
        )
    }

    pub(crate) async fn store_acme_account(
        &self,
        environment: CertificateEnvironment,
        credentials: &[u8],
    ) -> Result<(), CertificateError> {
        if credentials.len() > MAX_PRIVATE_KEY_PEM_BYTES {
            return Err(CertificateError::StoreUnavailable);
        }
        let directory = self
            .ensure_certificates_dir()?
            .ensure_dir("acme-accounts")
            .map_err(|_| CertificateError::StoreUnavailable)?;
        write_private_file(
            &directory,
            &format!("{}.json", environment_name(environment)),
            credentials,
        )
    }
}
