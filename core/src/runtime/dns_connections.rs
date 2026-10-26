mod access;
mod models;
mod references;
#[cfg(test)]
mod tests;
mod validation;
mod verification;

pub(crate) use super::dns::capabilities::{ProviderId, catalog as provider_catalog};
use super::{
    clock::utc_now,
    dns::{EncryptedDnsConfig, encryption},
    state::state_dir,
};
pub(crate) use models::Metadata;
pub(crate) use models::{
    Consumer, ConsumerType, DeleteRequest, Error, Reference, SaveRequest, TestRequest,
};
use models::{TestResult, ValidatedReference, Zone};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeSet, path::PathBuf};
use tokio::sync::{Mutex, MutexGuard};

const FILE: &str = "dns-connections.json";
const MAX_BYTES: usize = 1024 * 1024;
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Entry {
    metadata: Metadata,
    secret: EncryptedDnsConfig,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pending_checks: Vec<verification::PermissionCheck>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Registry {
    version: u8,
    connections: Vec<Entry>,
}

pub(crate) struct Store {
    path: PathBuf,
    state: Mutex<Option<Registry>>,
    pub(crate) bindings: Mutex<()>,
    checks: Mutex<()>,
    #[cfg(test)]
    key: Option<[u8; 32]>,
    #[cfg(test)]
    endpoint: Option<String>,
    #[cfg(test)]
    fail_after_persist: std::sync::atomic::AtomicBool,
}
impl Store {
    pub(crate) fn new(path: PathBuf) -> Self {
        Self {
            path,
            state: Mutex::new(None),
            bindings: Mutex::new(()),
            checks: Mutex::new(()),
            #[cfg(test)]
            key: None,
            #[cfg(test)]
            endpoint: None,
            #[cfg(test)]
            fail_after_persist: std::sync::atomic::AtomicBool::new(false),
        }
    }
    fn key(&self) -> Result<[u8; 32], Error> {
        #[cfg(test)]
        if let Some(key) = self.key {
            return Ok(key);
        }
        encryption::encryption_key_from_environment().map_err(|_| Error::CredentialsUnavailable)
    }
    fn endpoint(&self) -> &str {
        #[cfg(test)]
        if let Some(endpoint) = self.endpoint.as_deref() {
            return endpoint;
        }
        "https://api.cloudflare.com/client/v4/"
    }
    async fn lock(&self) -> Result<MutexGuard<'_, Option<Registry>>, Error> {
        let mut state = self.state.lock().await;
        if state.is_none() {
            *state = Some(self.load()?);
        }
        Ok(state)
    }
    fn registry<'a>(
        state: &'a mut MutexGuard<'_, Option<Registry>>,
    ) -> Result<&'a mut Registry, Error> {
        state.as_mut().ok_or(Error::StoreUnavailable)
    }
    fn load(&self) -> Result<Registry, Error> {
        let dir = state_dir(&self.path).map_err(|_| Error::StoreUnavailable)?;
        let bytes = match dir.read_file(FILE, MAX_BYTES) {
            Ok(bytes) => bytes,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return Ok(Registry {
                    version: 1,
                    connections: vec![],
                });
            }
            Err(_) => return Err(Error::StoreUnavailable),
        };
        let registry: Registry =
            serde_json::from_slice(&bytes).map_err(|_| Error::StoreUnavailable)?;
        if registry.version != 1 || registry.connections.len() > 100 {
            return Err(Error::StoreUnavailable);
        }
        let mut ids = BTreeSet::new();
        let mut names = BTreeSet::new();
        for entry in &registry.connections {
            validation::metadata(&entry.metadata).map_err(|_| Error::StoreUnavailable)?;
            verification::validate_pending(entry)?;
            if !ids.insert(&entry.metadata.id)
                || !names.insert(entry.metadata.name.to_lowercase())
                || entry.secret.version != 1
                || entry.secret.nonce.len() != 12
                || !(17..=528).contains(&entry.secret.ciphertext.len())
            {
                return Err(Error::StoreUnavailable);
            }
        }
        Ok(registry)
    }
    fn persist(&self, registry: &Registry) -> Result<(), Error> {
        let bytes = serde_json::to_vec(registry).map_err(|_| Error::StoreUnavailable)?;
        if bytes.len() > MAX_BYTES {
            return Err(Error::StoreUnavailable);
        }
        state_dir(&self.path)
            .and_then(|dir| dir.atomic_write(FILE, &bytes))
            .map_err(|_| Error::StoreUnavailable)?;
        #[cfg(test)]
        if self
            .fail_after_persist
            .swap(false, std::sync::atomic::Ordering::SeqCst)
        {
            return Err(Error::StoreUnavailable);
        }
        Ok(())
    }
    fn commit(
        &self,
        state: &mut MutexGuard<'_, Option<Registry>>,
        registry: Registry,
    ) -> Result<(), Error> {
        // Replacement may succeed before a later directory sync fails. Only
        // authoritative disk state can decide the next admitted operation.
        **state = None;
        self.persist(&registry)?;
        **state = Some(registry);
        Ok(())
    }
    fn decrypt(&self, entry: &Entry) -> Result<String, Error> {
        let aad = format!("dns-connection:{}:v1", entry.metadata.id);
        let bytes = encryption::decrypt_bytes(&entry.secret, &aad, &self.key()?)
            .map_err(|_| Error::CredentialsUnavailable)?;
        let token = String::from_utf8(bytes).map_err(|_| Error::CredentialsUnavailable)?;
        validation::token(&token).map_err(|_| Error::CredentialsUnavailable)?;
        Ok(token)
    }
    pub(crate) async fn list(&self) -> Result<Vec<Metadata>, Error> {
        let mut state = self.lock().await?;
        Ok(Self::registry(&mut state)?
            .connections
            .iter()
            .map(|e| e.metadata.clone())
            .collect())
    }
    pub(crate) async fn test(&self, request: TestRequest) -> Result<TestResult, Error> {
        if let Some(id) = &request.connection_id {
            validation::id(id)?;
        }
        if let Some(token) = &request.api_token {
            validation::token(token)?;
        }
        if request.connection_id.is_none() && request.api_token.is_none() {
            return Err(Error::TokenRequired);
        }
        let entry = {
            let mut state = self.lock().await?;
            let registry = Self::registry(&mut state)?;
            request
                .connection_id
                .as_ref()
                .map(|id| {
                    registry
                        .connections
                        .iter()
                        .find(|e| &e.metadata.id == id)
                        .cloned()
                        .ok_or(Error::ConnectionNotFound)
                })
                .transpose()?
        };
        let provider = resolve_provider(request.provider, entry.as_ref())?;
        let selected = request.zone_ids.unwrap_or_else(|| {
            entry
                .as_ref()
                .map(|e| e.metadata.zones.iter().map(|z| z.id.clone()).collect())
                .unwrap_or_default()
        });
        validation::selection(&selected, false)?;
        let token = match request.api_token {
            Some(token) => token,
            None => self.decrypt(entry.as_ref().ok_or(Error::TokenRequired)?)?,
        };
        let zones = validation::permitted(provider, self.endpoint(), &token).await?;
        select(&zones, &selected)?;
        // A test against a stored credential must not silently describe a stale revision.
        if let Some(entry) = entry {
            let mut state = self.lock().await?;
            let registry = Self::registry(&mut state)?;
            check_revision(registry, &entry.metadata.id, entry.metadata.revision)?;
        }
        Ok(TestResult {
            zones,
            selected_zone_ids: selected,
            checked_at: utc_now(),
            dns_write_verified: false,
        })
    }
    pub(crate) async fn save(&self, id: String, request: SaveRequest) -> Result<Metadata, Error> {
        let _checks = self
            .checks
            .try_lock()
            .map_err(|_| Error::ConnectionConflict)?;
        validation::id(&id)?;
        validation::id(&request.actor_user_id)?;
        validation::name(&request.name)?;
        validation::selection(&request.zone_ids, true)?;
        if let Some(token) = &request.api_token {
            validation::token(token)?;
        }
        let old = {
            let mut state = self.lock().await?;
            let registry = Self::registry(&mut state)?;
            check_revision(registry, &id, request.expected_revision)?;
            check_name(registry, &id, &request.name)?;
            if request.expected_revision == 0 && registry.connections.len() >= 100 {
                return Err(Error::ConnectionLimit);
            }
            registry
                .connections
                .iter()
                .find(|e| e.metadata.id == id)
                .cloned()
        };
        let provider = resolve_provider(request.provider, old.as_ref())?;
        if old.as_ref().is_some_and(|e| {
            e.metadata
                .references
                .iter()
                .any(|r| !request.zone_ids.contains(&r.zone_id))
        }) {
            return Err(Error::ConnectionInUse);
        }
        if old.as_ref().is_some_and(|entry| {
            entry
                .pending_checks
                .iter()
                .any(|check| !request.zone_ids.contains(&check.zone_id))
        }) {
            return Err(Error::ConnectionInUse);
        }
        let token = match &request.api_token {
            Some(token) => token.clone(),
            None => self.decrypt(old.as_ref().ok_or(Error::TokenRequired)?)?,
        };
        let permitted = validation::permitted(provider, self.endpoint(), &token).await?;
        let zones = select(&permitted, &request.zone_ids)?;
        let revision = request
            .expected_revision
            .checked_add(1)
            .ok_or(Error::ConnectionConflict)?;
        let secret = encryption::encrypt_bytes(
            token.as_bytes(),
            &format!("dns-connection:{id}:v1"),
            &self.key()?,
        )
        .map_err(|_| Error::CredentialsUnavailable)?;
        let mut state = self.lock().await?;
        let registry = Self::registry(&mut state)?;
        check_revision(registry, &id, request.expected_revision)?;
        check_name(registry, &id, &request.name)?;
        let current = registry.connections.iter().find(|e| e.metadata.id == id);
        if current.is_some_and(|e| {
            e.metadata
                .references
                .iter()
                .any(|r| !request.zone_ids.contains(&r.zone_id))
        }) {
            return Err(Error::ConnectionInUse);
        }
        if current.is_none() && registry.connections.len() >= 100 {
            return Err(Error::ConnectionLimit);
        }
        let mut now = utc_now();
        if let Some(entry) = &old {
            // Wall-clock correction must not move an established connection backwards.
            if validation::timestamp(&now)? < validation::timestamp(&entry.metadata.updated_at)? {
                now = entry.metadata.updated_at.clone();
            }
        }
        let verification = if request.api_token.is_none()
            && old
                .as_ref()
                .is_some_and(|entry| entry.metadata.zones == zones)
        {
            old.as_ref()
                .map(|entry| entry.metadata.verification.clone())
                .unwrap_or_default()
        } else {
            models::Verification::default()
        };
        let pending_checks = old
            .as_ref()
            .map(|entry| entry.pending_checks.clone())
            .unwrap_or_default();
        let metadata = Metadata {
            id: id.clone(),
            provider: provider.as_str().into(),
            ownership: "instance".into(),
            name: request.name,
            created_by_user_id: old
                .as_ref()
                .map(|e| e.metadata.created_by_user_id.clone())
                .unwrap_or(request.actor_user_id),
            revision,
            zones,
            references: current
                .map(|e| e.metadata.references.clone())
                .unwrap_or_default(),
            created_at: old
                .map(|e| e.metadata.created_at)
                .unwrap_or_else(|| now.clone()),
            updated_at: now,
            verification,
        };
        let mut next = registry.clone();
        next.connections.retain(|e| e.metadata.id != id);
        next.connections.push(Entry {
            metadata: metadata.clone(),
            secret,
            pending_checks,
        });
        self.commit(&mut state, next)?;
        Ok(metadata)
    }
    pub(crate) async fn delete(&self, id: &str, expected_revision: u32) -> Result<(), Error> {
        validation::id(id)?;
        if expected_revision == 0 {
            return Err(Error::InvalidInput);
        }
        let mut state = self.lock().await?;
        let registry = Self::registry(&mut state)?;
        check_revision(registry, id, expected_revision)?;
        if registry
            .connections
            .iter()
            .find(|e| e.metadata.id == id)
            .is_some_and(|e| !e.metadata.references.is_empty() || !e.pending_checks.is_empty())
        {
            return Err(Error::ConnectionInUse);
        }
        let mut next = registry.clone();
        next.connections.retain(|e| e.metadata.id != id);
        self.commit(&mut state, next)?;
        Ok(())
    }
    pub(crate) async fn validate_reference(
        &self,
        reference: Reference,
    ) -> Result<ValidatedReference, Error> {
        validation::reference(&reference)?;
        let mut state = self.lock().await?;
        let registry = Self::registry(&mut state)?;
        let entry = registry
            .connections
            .iter()
            .find(|e| e.metadata.id == reference.connection_id)
            .ok_or(Error::ConnectionNotFound)?;
        let zone = entry
            .metadata
            .zones
            .iter()
            .find(|z| z.id == reference.zone_id)
            .cloned()
            .ok_or(Error::ZoneNotPermitted)?;
        // Checking decryption fails closed if the installation key was lost or rotated.
        self.decrypt(entry)?;
        Ok(ValidatedReference {
            reference,
            revision: entry.metadata.revision,
            zone,
        })
    }
}
fn resolve_provider(
    requested: Option<ProviderId>,
    existing: Option<&Entry>,
) -> Result<ProviderId, Error> {
    let stored = existing
        .map(|entry| ProviderId::parse(&entry.metadata.provider).ok_or(Error::InvalidInput))
        .transpose()?;
    if requested
        .zip(stored)
        .is_some_and(|(requested, stored)| requested != stored)
    {
        return Err(Error::InvalidInput);
    }
    Ok(stored.or(requested).unwrap_or_default())
}

fn check_revision(registry: &Registry, id: &str, revision: u32) -> Result<(), Error> {
    match registry.connections.iter().find(|e| e.metadata.id == id) {
        Some(e) if e.metadata.revision == revision => Ok(()),
        None if revision == 0 => Ok(()),
        None => Err(Error::ConnectionNotFound),
        _ => Err(Error::ConnectionConflict),
    }
}
fn check_name(registry: &Registry, id: &str, name: &str) -> Result<(), Error> {
    if registry
        .connections
        .iter()
        .any(|e| e.metadata.id != id && e.metadata.name.to_lowercase() == name.to_lowercase())
    {
        Err(Error::ConnectionConflict)
    } else {
        Ok(())
    }
}
fn select(zones: &[Zone], ids: &[String]) -> Result<Vec<Zone>, Error> {
    ids.iter()
        .map(|id| {
            zones
                .iter()
                .find(|z| &z.id == id)
                .cloned()
                .ok_or(Error::ZoneNotPermitted)
        })
        .collect()
}
