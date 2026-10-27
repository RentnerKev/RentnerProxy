use std::{
    hash::{Hash, Hasher},
    sync::LazyLock,
    time::Duration,
};

use aws_lc_rs::digest::{Context, SHA256};
use reqwest::{Method, StatusCode, Url};
use tokio::sync::{Mutex, MutexGuard};

use crate::runtime::certificates::CertificateError;

use super::{
    api::{MAX_REQUEST_BODY_BYTES, ProviderRequestError, map_provider_error},
    models::{DnsPresentError, DnsRecordHandle, DnsRecordIntent},
    provider::DnsProvider,
};

mod protocol;
use protocol::{DesecDomain, DesecRrset, quote_txt};

#[cfg(test)]
mod tests;

const LOCK_TIMEOUT: Duration = Duration::from_secs(15);
// deSEC replaces whole RRsets. Serialize the read/modify/write sequence across
// provider instances, with bounded memory and wait time. Other processes and
// external API clients must coordinate separately; deSEC documents no
// conditional writes.
static RRSET_LOCKS: LazyLock<[Mutex<()>; 256]> =
    LazyLock::new(|| std::array::from_fn(|_| Mutex::new(())));

impl DnsProvider {
    pub(super) async fn desec_zone_name(&self) -> Result<String, CertificateError> {
        if let Some(name) = self.cached_zone_name.get() {
            return Ok(name.clone());
        }
        let url = self.api_path(&format!("domains/{}/", self.config.zone_id()))?;
        let (status, body) = self
            .send(Method::GET, url, None)
            .await
            .map_err(map_provider_error)?;
        if !status.is_success() {
            return Err(map_provider_error(ProviderRequestError::status(status)));
        }
        let domain: DesecDomain =
            serde_json::from_slice(&body).map_err(|_| CertificateError::DnsProviderUnavailable)?;
        if domain.name != self.config.zone_id() || !(1..=86400).contains(&domain.minimum_ttl) {
            return Err(CertificateError::DnsProviderInvalid);
        }
        let _ = self.desec_minimum_ttl.set(domain.minimum_ttl);
        let _ = self.cached_zone_name.set(domain.name.clone());
        Ok(domain.name)
    }

    pub(super) async fn desec_present(
        &self,
        intent: &DnsRecordIntent,
        owner_name: &str,
    ) -> Result<DnsRecordHandle, DnsPresentError> {
        let subname = self.desec_subname(owner_name)?;
        let _guard = self.desec_lock(&subname).await?;
        let existing = self.desec_read_rrset(&subname).await?;
        // The persisted random operation value is the ownership authority. The
        // provider has no comments/record IDs, so an identical existing value is
        // also used for restart recovery instead of creating public markers.
        if existing
            .as_ref()
            .is_some_and(|rrset| rrset.contains(&intent.value))
        {
            return Ok(self.desec_handle(intent, owner_name));
        }
        let create = existing.is_none();
        let ttl = *self
            .desec_minimum_ttl
            .get()
            .ok_or(CertificateError::DnsProviderInvalid)?;
        let mut rrset = existing.unwrap_or_else(|| DesecRrset::new(subname.clone(), ttl));
        rrset.records.push(quote_txt(&intent.value));
        self.desec_write_rrset(&subname, &rrset, create)
            .await
            .map_err(super::provider::present_request_error)?;
        Ok(self.desec_handle(intent, owner_name))
    }

    pub(super) async fn desec_find_owned_records(
        &self,
        intent: &DnsRecordIntent,
        owner_name: &str,
    ) -> Result<Vec<DnsRecordHandle>, CertificateError> {
        let subname = self.desec_subname(owner_name)?;
        let rrset = self.desec_read_rrset(&subname).await?;
        Ok(
            if rrset.is_some_and(|rrset| rrset.contains(&intent.value)) {
                vec![self.desec_handle(intent, owner_name)]
            } else {
                Vec::new()
            },
        )
    }

    pub(super) async fn desec_cleanup_intents(
        &self,
        intents: &[DnsRecordIntent],
    ) -> Result<(), CertificateError> {
        let mut failed = false;
        for intent in intents {
            if self.desec_cleanup_intent(intent).await.is_err() {
                failed = true;
            }
        }
        if failed {
            Err(CertificateError::DnsCleanupFailed)
        } else {
            Ok(())
        }
    }

    async fn desec_cleanup_intent(&self, intent: &DnsRecordIntent) -> Result<(), CertificateError> {
        intent.validate()?;
        let owner_name = self.validate_intent(intent).await?;
        let subname = self.desec_subname(&owner_name)?;
        let _guard = self.desec_lock(&subname).await?;
        let Some(mut rrset) = self.desec_read_rrset(&subname).await? else {
            return Ok(());
        };
        let previous_len = rrset.records.len();
        rrset.remove_value(&intent.value);
        if rrset.records.len() == previous_len {
            return Ok(());
        }
        self.desec_write_rrset(&subname, &rrset, false)
            .await
            .map_err(map_provider_error)?;
        Ok(())
    }

    fn desec_subname(&self, owner_name: &str) -> Result<String, CertificateError> {
        if owner_name == self.config.zone_id() {
            return Ok(String::new());
        }
        owner_name
            .strip_suffix(self.config.zone_id())
            .and_then(|prefix| prefix.strip_suffix('.'))
            .filter(|prefix| !prefix.is_empty() && valid_subname(prefix))
            .map(str::to_owned)
            .ok_or(CertificateError::DnsProviderInvalid)
    }

    fn desec_rrset_url(&self, subname: &str) -> Result<Url, CertificateError> {
        if !valid_subname(subname) {
            return Err(CertificateError::DnsProviderInvalid);
        }
        // deSEC reserves @ for an apex RRset in detail endpoint URLs.
        let subname = if subname.is_empty() { "@" } else { subname };
        self.api_path(&format!(
            "domains/{}/rrsets/{subname}/TXT/",
            self.config.zone_id()
        ))
    }

    async fn desec_read_rrset(
        &self,
        subname: &str,
    ) -> Result<Option<DesecRrset>, CertificateError> {
        let url = self.desec_rrset_url(subname)?;
        let (status, body) = self
            .send(Method::GET, url, None)
            .await
            .map_err(map_provider_error)?;
        if status == StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !status.is_success() {
            return Err(map_provider_error(ProviderRequestError::status(status)));
        }
        let rrset: DesecRrset =
            serde_json::from_slice(&body).map_err(|_| CertificateError::DnsProviderUnavailable)?;
        rrset.validate(self.config.zone_id(), subname)?;
        Ok(Some(rrset))
    }

    async fn desec_write_rrset(
        &self,
        subname: &str,
        rrset: &DesecRrset,
        create: bool,
    ) -> Result<(), ProviderRequestError> {
        let url = if create {
            self.api_path(&format!("domains/{}/rrsets/", self.config.zone_id()))
        } else {
            self.desec_rrset_url(subname)
        }
        .map_err(|_| ProviderRequestError::InvalidRequest)?;
        let body = if create {
            serde_json::to_vec(rrset)
        } else {
            serde_json::to_vec(&serde_json::json!({"records": rrset.records}))
        }
        .map_err(|_| ProviderRequestError::InvalidRequest)?;
        if body.len() > MAX_REQUEST_BODY_BYTES {
            return Err(ProviderRequestError::InvalidRequest);
        }
        // Empty records removes the RRset with the same atomic replacement
        // operation. Never replay an ambiguous mutation; reread its outcome.
        let result = match self
            .send(
                if create { Method::POST } else { Method::PATCH },
                url,
                Some(body),
            )
            .await
        {
            Ok((status, _)) if status.is_success() => Ok(()),
            Ok((status, _)) => Err(ProviderRequestError::status(status)),
            Err(error) => Err(error),
        };
        if result.as_ref().is_err_and(|error| !error.is_ambiguous()) {
            return result;
        }
        let matches = match self.desec_read_rrset(subname).await {
            Ok(Some(actual)) => actual.same_contents(rrset),
            Ok(None) => rrset.records.is_empty(),
            Err(_) => false,
        };
        if matches {
            Ok(())
        } else {
            Err(result
                .err()
                .unwrap_or(ProviderRequestError::InvalidResponse))
        }
    }

    async fn desec_lock(&self, subname: &str) -> Result<MutexGuard<'static, ()>, CertificateError> {
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        self.base_url.hash(&mut hasher);
        self.config.zone_id().hash(&mut hasher);
        subname.hash(&mut hasher);
        let index = (hasher.finish() % RRSET_LOCKS.len() as u64) as usize;
        tokio::time::timeout(LOCK_TIMEOUT, RRSET_LOCKS[index].lock())
            .await
            .map_err(|_| CertificateError::DnsProviderUnavailable)
    }

    fn desec_handle(&self, intent: &DnsRecordIntent, owner_name: &str) -> DnsRecordHandle {
        let mut digest = Context::new(&SHA256);
        for part in [self.config.zone_id(), owner_name, &intent.value] {
            digest.update(part.as_bytes());
            digest.update(&[0]);
        }
        let id = digest.finish().as_ref()[..16]
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect();
        DnsRecordHandle {
            id,
            intent: intent.clone(),
        }
    }
}

fn valid_subname(subname: &str) -> bool {
    subname.is_empty()
        || (subname.len() <= 178
            && subname.split('.').all(|label| {
                !label.is_empty()
                    && label.len() <= 63
                    && label.bytes().all(|byte| {
                        byte.is_ascii_lowercase()
                            || byte.is_ascii_digit()
                            || matches!(byte, b'-' | b'_')
                    })
            }))
}
