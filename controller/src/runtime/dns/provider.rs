use std::{collections::BTreeSet, fmt, sync::Arc, time::Duration};

use reqwest::{Client, Method, StatusCode, Url, redirect::Policy};
use serde_json::json;
use tokio::sync::OnceCell;

use crate::{
    proxy::is_canonical_domain,
    runtime::{certificates::CertificateEnvironment, certificates::CertificateError},
};

use super::{
    api::{
        CloudflareRecord, CloudflareRecordDelete, CloudflareResponse, CloudflareZone,
        MAX_REQUEST_BODY_BYTES, RECORDS_PER_PAGE, map_provider_error,
    },
    config::{DnsProviderConfig, endpoint_for_environment},
    models::{DnsRecordHandle, DnsRecordIntent},
    validation::{
        bare_authorization_name, dns_names_equal, domain_is_in_zone, is_safe_record_id,
        validate_sans_against_zone,
    },
};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_LIST_PAGES: u32 = 10;
const MAX_INTENTS: usize = 256;

#[derive(Clone)]
pub(crate) struct DnsProvider {
    pub(super) config: DnsProviderConfig,
    pub(super) client: Client,
    pub(super) base_url: Url,
    pub(super) cached_zone_name: Arc<OnceCell<String>>,
}

impl fmt::Debug for DnsProvider {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("DnsProvider")
            .field("config", &self.config)
            .field("base_url", &self.base_url)
            .finish()
    }
}

impl DnsProvider {
    pub(crate) fn from_config(
        config: DnsProviderConfig,
        environment: CertificateEnvironment,
    ) -> Result<Self, CertificateError> {
        config.validate()?;
        let base_url = endpoint_for_environment(environment)?;
        Self::new(config, base_url)
    }

    #[cfg(test)]
    pub(super) fn with_endpoint_for_test(
        config: DnsProviderConfig,
        endpoint: &str,
    ) -> Result<Self, CertificateError> {
        config.validate()?;
        let base_url = super::config::parse_api_endpoint(endpoint, true)?;
        Self::new(config, base_url)
    }

    fn new(config: DnsProviderConfig, base_url: Url) -> Result<Self, CertificateError> {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let client = Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .redirect(Policy::none())
            .build()
            .map_err(|_| CertificateError::DnsProviderUnavailable)?;
        Ok(Self {
            config,
            client,
            base_url,
            cached_zone_name: Arc::new(OnceCell::new()),
        })
    }

    pub(crate) async fn zone_name(&self) -> Result<String, CertificateError> {
        if let Some(name) = self.cached_zone_name.get() {
            return Ok(name.clone());
        }
        let url = self.api_path(&format!("zones/{}", self.config.zone_id()))?;
        let response = self
            .call::<CloudflareZone>(Method::GET, url, None)
            .await
            .map_err(map_provider_error)?;
        let zone = response
            .result
            .ok_or(CertificateError::DnsProviderUnavailable)?;
        if zone.id != self.config.zone_id() || !is_canonical_domain(&zone.name) {
            return Err(CertificateError::DnsProviderInvalid);
        }
        let name = zone.name;
        let _ = self.cached_zone_name.set(name.clone());
        Ok(name)
    }

    pub(crate) async fn validate_sans(
        &self,
        sans: &[String],
    ) -> Result<Vec<String>, CertificateError> {
        let zone = self.zone_name().await?;
        validate_sans_against_zone(sans, &zone)
    }

    pub(crate) async fn present(
        &self,
        intent: &DnsRecordIntent,
    ) -> Result<DnsRecordHandle, CertificateError> {
        intent.validate()?;
        let owner_name = self.validate_intent(intent).await?;
        let existing = self
            .find_owned_records_for_owner(intent, &owner_name)
            .await?;
        if let Some(handle) = existing.into_iter().next() {
            return Ok(handle);
        }

        let body = serde_json::to_vec(&json!({
            "type": "TXT",
            "name": owner_name,
            "content": intent.value,
            "ttl": 60,
            "comment": intent.marker,
        }))
        .map_err(|_| CertificateError::DnsProviderInvalid)?;
        if body.len() > MAX_REQUEST_BODY_BYTES {
            return Err(CertificateError::DnsProviderInvalid);
        }
        let url = self.api_path(&format!("zones/{}/dns_records", self.config.zone_id()))?;
        match self
            .call::<CloudflareRecord>(Method::POST, url, Some(body))
            .await
        {
            Ok(response) => {
                let record = response
                    .result
                    .ok_or(CertificateError::DnsProviderUnavailable)?;
                self.handle_for_record(record, intent, &owner_name)
            }
            Err(error) if error.is_ambiguous() => {
                match self.find_owned_records_for_owner(intent, &owner_name).await {
                    Ok(mut records) => records
                        .drain(..)
                        .next()
                        .ok_or_else(|| map_provider_error(error)),
                    Err(_) => Err(map_provider_error(error)),
                }
            }
            Err(error) => Err(map_provider_error(error)),
        }
    }

    pub(crate) async fn find_owned_records(
        &self,
        intent: &DnsRecordIntent,
    ) -> Result<Vec<DnsRecordHandle>, CertificateError> {
        intent.validate()?;
        let owner_name = self.validate_intent(intent).await?;
        self.find_owned_records_for_owner(intent, &owner_name).await
    }

    pub(crate) async fn cleanup_intents(
        &self,
        intents: &[DnsRecordIntent],
    ) -> Result<(), CertificateError> {
        if intents.len() > MAX_INTENTS {
            return Err(CertificateError::DnsCleanupFailed);
        }
        let mut deleted_ids = BTreeSet::new();
        let mut failed = false;
        for intent in intents {
            let records = match self.find_owned_records(intent).await {
                Ok(records) => records,
                Err(_) => {
                    failed = true;
                    continue;
                }
            };
            for record in records {
                if !deleted_ids.insert(record.id.clone()) {
                    continue;
                }
                if self.delete_record(&record.id).await.is_err() {
                    failed = true;
                }
            }
        }
        if failed {
            Err(CertificateError::DnsCleanupFailed)
        } else {
            Ok(())
        }
    }

    async fn validate_intent(&self, intent: &DnsRecordIntent) -> Result<String, CertificateError> {
        let zone = self.zone_name().await?;
        let bare_name =
            bare_authorization_name(&intent.name).ok_or(CertificateError::DnsProviderInvalid)?;
        if !domain_is_in_zone(&bare_name, &zone) {
            return Err(CertificateError::DnsProviderInvalid);
        }
        Ok(format!("_acme-challenge.{bare_name}"))
    }

    async fn find_owned_records_for_owner(
        &self,
        intent: &DnsRecordIntent,
        owner_name: &str,
    ) -> Result<Vec<DnsRecordHandle>, CertificateError> {
        let mut page = 1;
        let mut handles = Vec::new();
        loop {
            let mut url = self.api_path(&format!("zones/{}/dns_records", self.config.zone_id()))?;
            url.query_pairs_mut()
                .append_pair("type", "TXT")
                .append_pair("name", owner_name)
                .append_pair("page", &page.to_string())
                .append_pair("per_page", &RECORDS_PER_PAGE.to_string());
            let response = self
                .call::<Vec<CloudflareRecord>>(Method::GET, url, None)
                .await
                .map_err(map_provider_error)?;
            let records = response
                .result
                .ok_or(CertificateError::DnsProviderUnavailable)?;
            let records_len = records.len();
            for record in records {
                if record.record_type == "TXT"
                    && dns_names_equal(&record.name, owner_name)
                    && record.content == intent.value
                    && record.comment.as_deref() == Some(intent.marker.as_str())
                {
                    handles.push(self.handle_for_record(record, intent, owner_name)?);
                    if handles.len() > MAX_INTENTS {
                        return Err(CertificateError::DnsProviderUnavailable);
                    }
                }
            }
            let more_pages = response
                .result_info
                .as_ref()
                .map(|info| info.has_more(page, records_len))
                .unwrap_or(records_len == RECORDS_PER_PAGE as usize);
            if !more_pages {
                return Ok(handles);
            }
            if page >= MAX_LIST_PAGES {
                return Err(CertificateError::DnsProviderUnavailable);
            }
            page += 1;
        }
    }

    fn handle_for_record(
        &self,
        record: CloudflareRecord,
        intent: &DnsRecordIntent,
        owner_name: &str,
    ) -> Result<DnsRecordHandle, CertificateError> {
        if !is_safe_record_id(&record.id)
            || record.record_type != "TXT"
            || !dns_names_equal(&record.name, owner_name)
            || record.content != intent.value
            || record.comment.as_deref() != Some(intent.marker.as_str())
        {
            return Err(CertificateError::DnsProviderInvalid);
        }
        Ok(DnsRecordHandle {
            id: record.id,
            intent: intent.clone(),
        })
    }

    async fn delete_record(&self, id: &str) -> Result<(), CertificateError> {
        if !is_safe_record_id(id) {
            return Err(CertificateError::DnsCleanupFailed);
        }
        let url = self.api_path(&format!("zones/{}/dns_records/{id}", self.config.zone_id()))?;
        let (status, body) = self
            .send(Method::DELETE, url, None)
            .await
            .map_err(|_| CertificateError::DnsCleanupFailed)?;
        if status == StatusCode::NOT_FOUND {
            return Ok(());
        }
        if !status.is_success() {
            return Err(CertificateError::DnsCleanupFailed);
        }
        let response: CloudflareResponse<CloudflareRecordDelete> =
            serde_json::from_slice(&body).map_err(|_| CertificateError::DnsCleanupFailed)?;
        if response.success {
            Ok(())
        } else {
            Err(CertificateError::DnsCleanupFailed)
        }
    }
}
