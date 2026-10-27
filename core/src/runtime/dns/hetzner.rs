use std::{
    hash::{Hash, Hasher},
    sync::LazyLock,
    time::Duration,
};

use aws_lc_rs::digest::{Context, SHA256};
use tokio::sync::{Mutex, MutexGuard};

use crate::runtime::{
    certificates::CertificateError,
    hetzner::{Api, Error, ErrorKind, Record, Rrset},
};

use super::{
    config::DnsProviderConfig,
    models::{DnsRecordHandle, DnsRecordIntent},
    provider::DnsProvider,
    txt::{quote_txt, unquote_txt},
};

#[cfg(test)]
mod tests;

const OPERATION_TIMEOUT: Duration = Duration::from_secs(30);
const RECONCILIATION_TIMEOUT: Duration = Duration::from_secs(3);
const LOCK_TIMEOUT: Duration = Duration::from_secs(15);
// Serialize ownership checks and native value mutations across all instances in
// this controller, with bounded storage. Native actions preserve concurrent
// foreign additions from other controllers or API clients.
static RRSET_LOCKS: LazyLock<[Mutex<()>; 256]> =
    LazyLock::new(|| std::array::from_fn(|_| Mutex::new(())));

impl DnsProvider {
    pub(super) async fn hetzner_zone_name(&self) -> Result<String, CertificateError> {
        if let Some(name) = self.cached_zone_name.get() {
            return Ok(name.clone());
        }
        let api = Api::new(
            &self.client,
            &self.base_url,
            self.hetzner_token()?,
            tokio::time::Instant::now() + OPERATION_TIMEOUT,
        );
        let zone = api.zone(self.config.zone_id()).await.map_err(map_error)?;
        let _ = self.cached_zone_name.set(zone.name.clone());
        Ok(zone.name)
    }

    pub(super) async fn hetzner_present(
        &self,
        intent: &DnsRecordIntent,
        owner_name: &str,
    ) -> Result<DnsRecordHandle, CertificateError> {
        let name = self.hetzner_subname(owner_name).await?;
        let _guard = self.hetzner_lock(&name).await?;
        let existing = self.hetzner_read_rrset(&name).await?;
        if let Some(rrset) = &existing {
            // Hetzner keys records by value. Never take over another client's
            // same-value record by changing its comment or adding a duplicate.
            if rrset
                .records
                .iter()
                .any(|record| same_value(record, &intent.value) && !owned_record(record, intent))
            {
                return Err(CertificateError::DnsProviderInvalid);
            }
            if rrset
                .records
                .iter()
                .any(|record| owned_record(record, intent))
            {
                return Ok(self.hetzner_handle(intent, owner_name));
            }
        }
        let records = [Record {
            value: quote_txt(&intent.value),
            comment: Some(intent.marker.clone()),
        }];
        let api = Api::new(
            &self.client,
            &self.base_url,
            self.hetzner_token()?,
            tokio::time::Instant::now() + OPERATION_TIMEOUT,
        );
        let outcome = if existing.is_some() {
            api.add_records(self.config.zone_id(), &name, "TXT", &records)
                .await
        } else {
            // Explicit null inherits the zone TTL. Existing RRSets are changed
            // with native add_records only, leaving their TTL untouched.
            api.create_rrset(self.config.zone_id(), &name, "TXT", None, &records)
                .await
        };
        let outcome = match outcome {
            Err(error) if !may_have_written(&error) => return Err(map_error(error)),
            outcome => outcome,
        };
        // Never replay an uncertain mutation. Reconcile by reading with a fresh
        // bounded budget, including when the action poll exhausted its budget.
        let actual = self
            .hetzner_read_rrset_with_timeout(&name, RECONCILIATION_TIMEOUT)
            .await;
        if actual.as_ref().is_ok_and(|actual| {
            actual.as_ref().is_some_and(|actual| {
                actual
                    .records
                    .iter()
                    .any(|record| owned_record(record, intent))
                    && preserves_foreign_records(existing.as_ref(), actual, intent)
            })
        }) {
            return Ok(self.hetzner_handle(intent, owner_name));
        }
        Err(outcome
            .err()
            .map_or(CertificateError::DnsProviderUnavailable, map_error))
    }

    pub(super) async fn hetzner_find_owned_records(
        &self,
        intent: &DnsRecordIntent,
        owner_name: &str,
    ) -> Result<Vec<DnsRecordHandle>, CertificateError> {
        let name = self.hetzner_subname(owner_name).await?;
        let rrset = self.hetzner_read_rrset(&name).await?;
        Ok(
            if rrset.is_some_and(|rrset| {
                rrset
                    .records
                    .iter()
                    .any(|record| owned_record(record, intent))
            }) {
                vec![self.hetzner_handle(intent, owner_name)]
            } else {
                Vec::new()
            },
        )
    }

    pub(super) async fn hetzner_cleanup_intents(
        &self,
        intents: &[DnsRecordIntent],
    ) -> Result<(), CertificateError> {
        let mut failed = false;
        for intent in intents {
            if self.hetzner_cleanup_intent(intent).await.is_err() {
                failed = true;
            }
        }
        if failed {
            Err(CertificateError::DnsCleanupFailed)
        } else {
            Ok(())
        }
    }

    async fn hetzner_cleanup_intent(
        &self,
        intent: &DnsRecordIntent,
    ) -> Result<(), CertificateError> {
        intent.validate()?;
        let owner_name = self.validate_intent(intent).await?;
        let name = self.hetzner_subname(&owner_name).await?;
        let _guard = self.hetzner_lock(&name).await?;
        let Some(existing) = self.hetzner_read_rrset(&name).await? else {
            return Ok(());
        };
        let records = existing
            .records
            .iter()
            .filter(|record| owned_record(record, intent))
            .cloned()
            .collect::<Vec<_>>();
        if records.is_empty() {
            return Ok(());
        }
        if existing
            .records
            .iter()
            .any(|record| same_value(record, &intent.value) && !owned_record(record, intent))
        {
            return Err(CertificateError::DnsCleanupFailed);
        }
        let api = Api::new(
            &self.client,
            &self.base_url,
            self.hetzner_token()?,
            tokio::time::Instant::now() + OPERATION_TIMEOUT,
        );
        // Do not DELETE the RRSet, even when the last observed value is ours:
        // a foreign writer may have added a value since the GET.
        let outcome = api
            .remove_records(self.config.zone_id(), &name, "TXT", &records)
            .await;
        if let Err(error) = outcome
            && !may_have_written(&error)
        {
            return Err(map_error(error));
        }
        match self
            .hetzner_read_rrset_with_timeout(&name, RECONCILIATION_TIMEOUT)
            .await?
        {
            Some(actual)
                if !actual
                    .records
                    .iter()
                    .any(|record| owned_record(record, intent))
                    && preserves_foreign_records(Some(&existing), &actual, intent) =>
            {
                Ok(())
            }
            None if existing
                .records
                .iter()
                .all(|record| owned_record(record, intent)) =>
            {
                Ok(())
            }
            _ => Err(CertificateError::DnsCleanupFailed),
        }
    }

    async fn hetzner_read_rrset(&self, name: &str) -> Result<Option<Rrset>, CertificateError> {
        self.hetzner_read_rrset_with_timeout(name, OPERATION_TIMEOUT)
            .await
    }

    async fn hetzner_read_rrset_with_timeout(
        &self,
        name: &str,
        timeout: Duration,
    ) -> Result<Option<Rrset>, CertificateError> {
        let api = Api::new(
            &self.client,
            &self.base_url,
            self.hetzner_token()?,
            tokio::time::Instant::now() + timeout,
        );
        let rrset = api
            .rrset(self.config.zone_id(), name, "TXT")
            .await
            .map_err(map_error)?;
        if rrset.as_ref().is_some_and(|rrset| {
            rrset
                .records
                .iter()
                .any(|record| unquote_txt(&record.value).is_none())
        }) {
            return Err(CertificateError::DnsProviderInvalid);
        }
        Ok(rrset)
    }

    async fn hetzner_subname(&self, owner_name: &str) -> Result<String, CertificateError> {
        let zone = self.hetzner_zone_name().await?;
        if owner_name == zone {
            return Ok("@".to_owned());
        }
        owner_name
            .strip_suffix(&zone)
            .and_then(|prefix| prefix.strip_suffix('.'))
            .filter(|name| {
                !name.is_empty()
                    && name.len() <= 253
                    && name.split('.').all(|label| {
                        !label.is_empty()
                            && label.len() <= 63
                            && label.bytes().all(|byte| {
                                byte.is_ascii_lowercase()
                                    || byte.is_ascii_digit()
                                    || matches!(byte, b'-' | b'_')
                            })
                    })
            })
            .map(str::to_owned)
            .ok_or(CertificateError::DnsProviderInvalid)
    }

    fn hetzner_token(&self) -> Result<&str, CertificateError> {
        match &self.config {
            DnsProviderConfig::Hetzner { api_token, .. } => Ok(api_token),
            _ => Err(CertificateError::DnsProviderInvalid),
        }
    }

    async fn hetzner_lock(&self, name: &str) -> Result<MutexGuard<'static, ()>, CertificateError> {
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        self.base_url.hash(&mut hasher);
        self.config.zone_id().hash(&mut hasher);
        name.hash(&mut hasher);
        let index = (hasher.finish() % RRSET_LOCKS.len() as u64) as usize;
        tokio::time::timeout(LOCK_TIMEOUT, RRSET_LOCKS[index].lock())
            .await
            .map_err(|_| CertificateError::DnsProviderUnavailable)
    }

    fn hetzner_handle(&self, intent: &DnsRecordIntent, owner_name: &str) -> DnsRecordHandle {
        let mut digest = Context::new(&SHA256);
        for part in [
            self.config.zone_id(),
            owner_name,
            &intent.value,
            &intent.marker,
        ] {
            digest.update(part.as_bytes());
            digest.update(&[0]);
        }
        // Provider IDs contain a slash (name/type); journal handles require an
        // opaque safe ID and derive their authority from the persisted intent.
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

fn same_value(record: &Record, value: &str) -> bool {
    unquote_txt(&record.value).as_deref() == Some(value.as_bytes())
}

fn owned_record(record: &Record, intent: &DnsRecordIntent) -> bool {
    record.comment.as_deref() == Some(intent.marker.as_str()) && same_value(record, &intent.value)
}

fn preserves_foreign_records(
    existing: Option<&Rrset>,
    actual: &Rrset,
    intent: &DnsRecordIntent,
) -> bool {
    match existing {
        Some(existing) => {
            existing.ttl == actual.ttl
                && existing
                    .records
                    .iter()
                    .filter(|record| !owned_record(record, intent))
                    .all(|record| actual.records.contains(record))
        }
        None => actual.ttl.is_none(),
    }
}

fn may_have_written(error: &Error) -> bool {
    !matches!(error.kind, ErrorKind::Unauthorized | ErrorKind::RateLimited)
}

fn map_error(error: Error) -> CertificateError {
    match error.kind {
        ErrorKind::Unauthorized => CertificateError::DnsProviderUnauthorized,
        _ => CertificateError::DnsProviderUnavailable,
    }
}
