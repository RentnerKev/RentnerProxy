use std::{
    collections::{BTreeMap, BTreeSet},
    io::ErrorKind,
};

use super::material_files::material_at;
use super::persistence::persist_index;
use super::validation::certificate_covers;
use super::{
    CertificateError, CertificateMaterial, CertificateOperation, CertificateStatus,
    CertificateStore, OffsetDateTime, Rfc3339, StagedCertificate,
};
use crate::proxy::is_canonical_uuid_v7;

impl CertificateStore {
    pub(crate) async fn covers_domains(
        &self,
        id: &str,
        domains: &[String],
        require_unexpired: bool,
    ) -> Result<bool, CertificateError> {
        let index = self.index.lock().await;
        let entry = index
            .certificates
            .get(id)
            .ok_or(CertificateError::NotFound)?;

        Ok(entry.metadata.status == CertificateStatus::Valid
            && (!require_unexpired
                || entry
                    .metadata
                    .expires_at
                    .as_deref()
                    .is_some_and(|expires_at| {
                        OffsetDateTime::parse(expires_at, &Rfc3339)
                            .is_ok_and(|expires_at| expires_at > OffsetDateTime::now_utc())
                    }))
            && domains
                .iter()
                .all(|domain| certificate_covers(&entry.metadata.domains, domain)))
    }

    pub(crate) fn staged_material(
        &self,
        staged: &StagedCertificate,
    ) -> Result<CertificateMaterial, CertificateError> {
        staged.material(&self.certificates_dir()?)
    }

    pub(crate) async fn material(&self, id: &str) -> Result<CertificateMaterial, CertificateError> {
        let index = self.index.lock().await;
        let entry = index
            .certificates
            .get(id)
            .ok_or(CertificateError::NotFound)?;
        if entry.metadata.status != CertificateStatus::Valid {
            return Err(CertificateError::NotFound);
        }
        let material_id = entry
            .material_id
            .clone()
            .ok_or(CertificateError::NotFound)?;
        material_at(&self.certificates_dir()?, id, &material_id)
    }

    pub(crate) async fn delete_if_unused(
        &self,
        id: &str,
        in_use: bool,
    ) -> Result<(), CertificateError> {
        if in_use {
            return Err(CertificateError::InUse);
        }
        let certificates_dir = self.certificates_dir()?;
        self.acquire_lease(id).await?;
        let mut index = self.index.lock().await;
        let Some(entry) = index.certificates.get(id) else {
            drop(index);
            self.release_lease(id).await;
            return Err(CertificateError::NotFound);
        };
        if entry.metadata.operation != CertificateOperation::Idle {
            drop(index);
            self.release_lease(id).await;
            return Err(CertificateError::OperationInProgress);
        }
        if index.pending_candidates.contains_key(id) {
            drop(index);
            self.release_lease(id).await;
            return Err(CertificateError::OperationInProgress);
        }
        if entry
            .acme
            .as_ref()
            .is_some_and(|acme| !acme.pending_dns_records.is_empty())
        {
            drop(index);
            self.release_lease(id).await;
            return Err(CertificateError::DnsCleanupFailed);
        }

        let tombstone = format!(
            ".deleted-{id}-{}-{}",
            std::process::id(),
            OffsetDateTime::now_utc().unix_timestamp_nanos(),
        );
        let moved_directory = match certificates_dir.open_dir(id) {
            Ok(_) => certificates_dir
                .rename_dir(id, &tombstone)
                .map(|_| Some(tombstone.clone()))
                .map_err(|_| CertificateError::StoreUnavailable),
            Err(error) if error.kind() == ErrorKind::NotFound => {
                if entry.material_id.is_some() {
                    Err(CertificateError::StoreUnavailable)
                } else {
                    Ok(None)
                }
            }
            Err(_) => Err(CertificateError::StoreUnavailable),
        };
        let moved_directory = match moved_directory {
            Ok(moved_directory) => moved_directory,
            Err(error) => {
                drop(index);
                self.release_lease(id).await;
                return Err(error);
            }
        };
        let removed = index.certificates.remove(id).expect("entry checked");
        if let Err(error) = persist_index(&certificates_dir, &index) {
            index.certificates.insert(id.to_owned(), removed);
            let restore = moved_directory
                .as_ref()
                .is_none_or(|tombstone| certificates_dir.rename_dir(tombstone, id).is_ok());
            drop(index);
            self.release_lease(id).await;
            return if restore {
                Err(error)
            } else {
                Err(CertificateError::StoreUnavailable)
            };
        }
        drop(index);
        if let Some(tombstone) = moved_directory
            && certificates_dir.remove_dir_tree(&tombstone).is_err()
        {
            self.release_lease(id).await;
            return Err(CertificateError::StoreUnavailable);
        }
        self.release_lease(id).await;
        Ok(())
    }

    pub(crate) async fn collect_garbage(&self) -> Result<(), CertificateError> {
        let leases = self.leases.lock().await;
        let index = self.index.lock().await;
        let certificates_dir = self.certificates_dir()?;
        let mut protected = BTreeMap::<String, BTreeSet<String>>::new();
        for (id, entry) in &index.certificates {
            if let Some(material_id) = &entry.material_id {
                protected
                    .entry(id.clone())
                    .or_default()
                    .insert(material_id.clone());
            }
            if let Some(candidate) = index.pending_candidates.get(id)
                && let Some(material_id) = &candidate.staged.material_id
            {
                protected
                    .entry(id.clone())
                    .or_default()
                    .insert(material_id.clone());
            }
        }

        let certificate_entries = std::fs::read_dir(certificates_dir.path())
            .map_err(|_| CertificateError::StoreUnavailable)?;
        for certificate_entry in certificate_entries {
            let certificate_entry =
                certificate_entry.map_err(|_| CertificateError::StoreUnavailable)?;
            let file_type = certificate_entry
                .file_type()
                .map_err(|_| CertificateError::StoreUnavailable)?;
            if !file_type.is_dir() {
                continue;
            }
            let Some(id) = certificate_entry.file_name().to_str().map(str::to_owned) else {
                continue;
            };
            if !is_canonical_uuid_v7(&id) || !index.certificates.contains_key(&id) {
                continue;
            }
            if leases.contains(&id) {
                continue;
            }
            let certificate_dir = certificates_dir
                .open_dir(&id)
                .map_err(|_| CertificateError::StoreUnavailable)?;
            let versions_dir = match certificate_dir.open_dir("versions") {
                Ok(directory) => directory,
                Err(error) if error.kind() == ErrorKind::NotFound => continue,
                Err(_) => return Err(CertificateError::StoreUnavailable),
            };
            let versions = std::fs::read_dir(versions_dir.path())
                .map_err(|_| CertificateError::StoreUnavailable)?;
            for version in versions {
                let version = version.map_err(|_| CertificateError::StoreUnavailable)?;
                let file_type = version
                    .file_type()
                    .map_err(|_| CertificateError::StoreUnavailable)?;
                if !file_type.is_dir() {
                    continue;
                }
                let Some(version_id) = version.file_name().to_str().map(str::to_owned) else {
                    continue;
                };

                if version_id.starts_with('.')
                    || version_id.len() != 64
                    || !version_id.bytes().all(|byte| byte.is_ascii_hexdigit())
                {
                    continue;
                }
                if protected
                    .get(&id)
                    .is_some_and(|versions| versions.contains(&version_id))
                {
                    continue;
                }
                versions_dir
                    .remove_dir_tree(&version_id)
                    .map_err(|_| CertificateError::StoreUnavailable)?;
            }
        }
        drop(index);
        drop(leases);
        Ok(())
    }
}
