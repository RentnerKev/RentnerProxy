//! Bounded DNS-01 provider support.
//!
//! The browser only supplies a provider configuration.  The controller owns the
//! provider client and all network requests.  In particular, the Cloudflare API
//! origin is fixed in production; the test endpoint can only be enabled by the
//! operator for the staging ACME fixture.

use std::{
    collections::BTreeSet, env, fmt, fs, io::Read, path::PathBuf, sync::Arc, time::Duration,
};

use base64::{Engine as _, engine::general_purpose::STANDARD};
use reqwest::{Client, Method, StatusCode, Url, redirect::Policy};
use ring::{
    aead,
    rand::{SecureRandom, SystemRandom},
};
use serde::{Deserialize, Deserializer, Serialize, de::DeserializeOwned};
use serde_json::json;
use tokio::sync::OnceCell;

use crate::{proxy::is_canonical_domain, runtime::certificates::CertificateError};

use super::certificates::CertificateEnvironment;

const CLOUDFLARE_API_BASE: &str = "https://api.cloudflare.com/client/v4/";
const DNS_TEST_API_URL_ENV: &str = "RENTNERPROXY_DNS_TEST_API_URL";
const ACME_TEST_DIRECTORY_ENV: &str = "RENTNERPROXY_ACME_TEST_DIRECTORY_URL";
const ACME_TEST_ROOT_ENV: &str = "RENTNERPROXY_ACME_TEST_ROOT_CERT";
const APP_ENCRYPTION_KEY_ENV: &str = "APP_ENCRYPTION_KEY";
const APP_ENCRYPTION_KEY_FILE_ENV: &str = "APP_ENCRYPTION_KEY_FILE";
const DNS_RECORD_COMMENT_PREFIX: &str = "rentnerproxy-acme:";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_RESPONSE_BODY_BYTES: usize = 64 * 1024;
const MAX_REQUEST_BODY_BYTES: usize = 16 * 1024;
const MAX_LIST_PAGES: u32 = 10;
const RECORDS_PER_PAGE: u32 = 100;
const MAX_INTENTS: usize = 256;
const MAX_CERTIFICATE_ID_BYTES: usize = 128;
const MAX_ENCRYPTED_CIPHERTEXT_BYTES: usize = 8 * 1024;
const AES_GCM_NONCE_BYTES: usize = 12;
const ENCRYPTED_DNS_CONFIG_VERSION: u8 = 1;
const MAX_KEY_FILE_BYTES: u64 = 4 * 1024;

/// Controller-owned DNS provider credentials.
///
/// The token is deliberately present in the serializable configuration because
/// the value is encrypted before it is persisted.  The custom `Debug`
/// implementation never prints it.
#[derive(Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "type")]
pub(crate) enum DnsProviderConfig {
    #[serde(rename = "cloudflare")]
    Cloudflare {
        #[serde(rename = "zoneId")]
        zone_id: String,
        #[serde(rename = "apiToken")]
        api_token: String,
    },
}

#[derive(Deserialize)]
#[serde(tag = "type", deny_unknown_fields)]
enum DnsProviderConfigWire {
    #[serde(rename = "cloudflare")]
    Cloudflare {
        #[serde(rename = "zoneId")]
        zone_id: String,
        #[serde(rename = "apiToken")]
        api_token: String,
    },
}

impl<'de> Deserialize<'de> for DnsProviderConfig {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let wire = DnsProviderConfigWire::deserialize(deserializer)?;
        let config = match wire {
            DnsProviderConfigWire::Cloudflare { zone_id, api_token } => {
                Self::Cloudflare { zone_id, api_token }
            }
        };
        config
            .validate()
            .map_err(|_| serde::de::Error::custom("invalid DNS provider configuration"))?;
        Ok(config)
    }
}

impl fmt::Debug for DnsProviderConfig {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Cloudflare { zone_id, .. } => formatter
                .debug_struct("Cloudflare")
                .field("zone_id", zone_id)
                .field("api_token", &"REDACTED")
                .finish(),
        }
    }
}

impl DnsProviderConfig {
    #[cfg(test)]
    pub(crate) fn cloudflare(
        zone_id: impl Into<String>,
        api_token: impl Into<String>,
    ) -> Result<Self, CertificateError> {
        let config = Self::Cloudflare {
            zone_id: zone_id.into(),
            api_token: api_token.into(),
        };
        config.validate()?;
        Ok(config)
    }

    pub(crate) fn validate(&self) -> Result<(), CertificateError> {
        match self {
            Self::Cloudflare { zone_id, api_token } => {
                if !is_cloudflare_zone_id(zone_id) || !is_safe_secret(api_token, 512) {
                    return Err(CertificateError::DnsProviderInvalid);
                }
            }
        }
        Ok(())
    }

    fn zone_id(&self) -> &str {
        match self {
            Self::Cloudflare { zone_id, .. } => zone_id,
        }
    }

    fn api_token(&self) -> &str {
        match self {
            Self::Cloudflare { api_token, .. } => api_token,
        }
    }
}

/// Encrypted provider configuration stored in certificate state.
///
/// It intentionally contains no key material.  The process environment or its
/// protected key file is the only key source.
#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct EncryptedDnsConfig {
    pub(crate) version: u8,
    pub(crate) nonce: Vec<u8>,
    pub(crate) ciphertext: Vec<u8>,
}

impl fmt::Debug for EncryptedDnsConfig {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("EncryptedDnsConfig")
            .field("version", &self.version)
            .field("nonce", &"REDACTED")
            .field("ciphertext_bytes", &self.ciphertext.len())
            .finish()
    }
}

/// A journal entry for one TXT record mutation.
///
/// `name` is the bare ACME authorization name (for example, `example.com`),
/// not the `_acme-challenge.` owner name.  The provider accepts the owner form
/// too when recovering old journal entries, which keeps interrupted upgrades
/// recoverable.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct DnsRecordIntent {
    pub(crate) name: String,
    pub(crate) value: String,
    pub(crate) marker: String,
}

impl DnsRecordIntent {
    pub(crate) fn new(
        certificate_id: &str,
        authorization_name: &str,
        value: &str,
    ) -> Result<Self, CertificateError> {
        let marker = dns_record_marker(certificate_id)?;
        let name = bare_authorization_name(authorization_name)
            .ok_or(CertificateError::DnsProviderInvalid)?;
        let intent = Self {
            name,
            value: value.to_owned(),
            marker,
        };
        intent.validate()?;
        Ok(intent)
    }

    pub(crate) fn validate(&self) -> Result<(), CertificateError> {
        if bare_authorization_name(&self.name).is_none()
            || !is_safe_secret(&self.value, 2_048)
            || !is_owned_marker(&self.marker)
        {
            return Err(CertificateError::DnsProviderInvalid);
        }
        Ok(())
    }
}

/// The Cloudflare record ID plus the exact intent used to create it.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct DnsRecordHandle {
    pub(crate) id: String,
    pub(crate) intent: DnsRecordIntent,
}

/// Cloudflare DNS API client used by the controller ACME boundary.
#[derive(Clone)]
pub(crate) struct DnsProvider {
    config: DnsProviderConfig,
    client: Client,
    base_url: Url,
    cached_zone_name: Arc<OnceCell<String>>,
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
    /// Build a provider.  The test endpoint is accepted only for staging when
    /// the ACME test directory and root certificate are also operator-configured.
    pub(crate) fn from_config(
        config: DnsProviderConfig,
        environment: CertificateEnvironment,
    ) -> Result<Self, CertificateError> {
        config.validate()?;
        let base_url = endpoint_for_environment(environment)?;
        Self::new(config, base_url)
    }

    #[cfg(test)]
    fn with_endpoint_for_test(
        config: DnsProviderConfig,
        endpoint: &str,
    ) -> Result<Self, CertificateError> {
        config.validate()?;
        let base_url = parse_api_endpoint(endpoint, true)?;
        Self::new(config, base_url)
    }

    fn new(config: DnsProviderConfig, base_url: Url) -> Result<Self, CertificateError> {
        // reqwest is built with `rustls-no-provider`; installing ring here keeps
        // the controller library usable from both the binary and test entrypoints.
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

    /// Validate every SAN against the fetched Cloudflare zone and return its
    /// bare authorization names.  A wildcard strips exactly one `*.` label.
    pub(crate) async fn validate_sans(
        &self,
        sans: &[String],
    ) -> Result<Vec<String>, CertificateError> {
        let zone = self.zone_name().await?;
        validate_sans_against_zone(sans, &zone)
    }

    /// Create one TXT record for an ACME authorization.
    ///
    /// The intent is expected to be journaled by the caller before invoking
    /// this method.  A preflight exact lookup makes retries after an ambiguous
    /// POST idempotent without merging values for simultaneous authorizations.
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
                // Never blindly retry a POST.  If Cloudflare accepted it but
                // the response was lost, recover the exact own record by the
                // journal marker, owner name, and TXT content.
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

    /// Find only TXT records that match all three journal-owned fields.
    pub(crate) async fn find_owned_records(
        &self,
        intent: &DnsRecordIntent,
    ) -> Result<Vec<DnsRecordHandle>, CertificateError> {
        intent.validate()?;
        let owner_name = self.validate_intent(intent).await?;
        self.find_owned_records_for_owner(intent, &owner_name).await
    }

    /// Delete records belonging to the supplied journal intents.  The list
    /// response is filtered locally and only matching record IDs are sent to
    /// DELETE, so a stale or forged ID cannot remove an unrelated record.
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
        // A missing record is already cleaned up and is therefore idempotent.
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

    fn api_path(&self, path: &str) -> Result<Url, CertificateError> {
        self.base_url
            .join(path)
            .map_err(|_| CertificateError::DnsProviderInvalid)
    }

    async fn call<T: DeserializeOwned>(
        &self,
        method: Method,
        url: Url,
        body: Option<Vec<u8>>,
    ) -> Result<CloudflareResponse<T>, ProviderRequestError> {
        let (status, bytes) = self.send(method, url, body).await?;
        if !status.is_success() {
            return Err(ProviderRequestError::status(status));
        }
        let response = serde_json::from_slice::<CloudflareResponse<T>>(&bytes)
            .map_err(|_| ProviderRequestError::InvalidResponse)?;
        if !response.success {
            if response.errors.iter().any(|error| error.is_unauthorized()) {
                return Err(ProviderRequestError::Unauthorized);
            }
            return Err(ProviderRequestError::Api);
        }
        Ok(response)
    }

    async fn send(
        &self,
        method: Method,
        url: Url,
        body: Option<Vec<u8>>,
    ) -> Result<(StatusCode, Vec<u8>), ProviderRequestError> {
        let mut request = self
            .client
            .request(method, url)
            .header(reqwest::header::ACCEPT, "application/json")
            .header(
                reqwest::header::AUTHORIZATION,
                format!("Bearer {}", self.config.api_token()),
            );
        if let Some(body) = body {
            if body.len() > MAX_REQUEST_BODY_BYTES {
                return Err(ProviderRequestError::InvalidRequest);
            }
            request = request
                .header(reqwest::header::CONTENT_TYPE, "application/json")
                .body(body);
        }
        let response = request
            .send()
            .await
            .map_err(|error| ProviderRequestError::from_reqwest(&error))?;
        let status = response.status();
        if response
            .content_length()
            .is_some_and(|length| length > MAX_RESPONSE_BODY_BYTES as u64)
        {
            return Err(ProviderRequestError::BodyTooLarge);
        }
        let mut bytes = Vec::new();
        let mut response = response;
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| ProviderRequestError::Network)?
        {
            if bytes.len().saturating_add(chunk.len()) > MAX_RESPONSE_BODY_BYTES {
                return Err(ProviderRequestError::BodyTooLarge);
            }
            bytes.extend_from_slice(&chunk);
        }
        Ok((status, bytes))
    }
}

#[derive(Clone, Debug, Deserialize)]
struct CloudflareResponse<T> {
    success: bool,
    #[serde(default)]
    errors: Vec<CloudflareError>,
    result: Option<T>,
    #[serde(default)]
    result_info: Option<CloudflareResultInfo>,
}

#[derive(Clone, Copy, Debug, Deserialize)]
struct CloudflareError {
    #[serde(default)]
    code: Option<u64>,
}

impl CloudflareError {
    fn is_unauthorized(self) -> bool {
        matches!(self.code, Some(10_000 | 9_109 | 9_106 | 9_107))
    }
}

#[derive(Clone, Copy, Debug, Deserialize)]
struct CloudflareResultInfo {
    #[serde(default)]
    page: Option<u32>,
    #[serde(default)]
    total_pages: Option<u32>,
    #[serde(default)]
    per_page: Option<u32>,
}

impl CloudflareResultInfo {
    fn has_more(&self, requested_page: u32, records_len: usize) -> bool {
        if let Some(total_pages) = self.total_pages {
            return self.page.unwrap_or(requested_page) < total_pages;
        }
        records_len >= self.per_page.unwrap_or(RECORDS_PER_PAGE) as usize
    }
}

#[derive(Clone, Debug, Deserialize)]
struct CloudflareZone {
    id: String,
    name: String,
}

#[derive(Clone, Debug, Deserialize)]
struct CloudflareRecord {
    id: String,
    name: String,
    #[serde(rename = "type")]
    record_type: String,
    content: String,
    #[serde(default)]
    comment: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
struct CloudflareRecordDelete {
    #[allow(dead_code)]
    id: Option<String>,
}

#[derive(Clone, Copy, Debug)]
enum ProviderRequestError {
    Network,
    BodyTooLarge,
    Unauthorized,
    Status(StatusCode),
    InvalidResponse,
    Api,
    InvalidRequest,
}

impl ProviderRequestError {
    fn status(status: StatusCode) -> Self {
        if matches!(status, StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN) {
            Self::Unauthorized
        } else {
            Self::Status(status)
        }
    }

    fn from_reqwest(error: &reqwest::Error) -> Self {
        if error.is_timeout() || error.is_connect() || error.is_request() {
            Self::Network
        } else {
            Self::InvalidResponse
        }
    }

    fn is_ambiguous(self) -> bool {
        match self {
            Self::Network | Self::BodyTooLarge | Self::InvalidResponse | Self::Api => true,
            Self::Status(status) => {
                status == StatusCode::REQUEST_TIMEOUT
                    || status == StatusCode::TOO_MANY_REQUESTS
                    || status.is_server_error()
            }
            Self::Unauthorized | Self::InvalidRequest => false,
        }
    }
}

fn map_provider_error(error: ProviderRequestError) -> CertificateError {
    match error {
        ProviderRequestError::Unauthorized => CertificateError::DnsProviderUnauthorized,
        ProviderRequestError::InvalidRequest => CertificateError::DnsProviderInvalid,
        ProviderRequestError::Status(
            StatusCode::BAD_REQUEST | StatusCode::UNPROCESSABLE_ENTITY,
        ) => CertificateError::DnsProviderInvalid,
        ProviderRequestError::Network
        | ProviderRequestError::BodyTooLarge
        | ProviderRequestError::Status(_)
        | ProviderRequestError::InvalidResponse
        | ProviderRequestError::Api => CertificateError::DnsProviderUnavailable,
    }
}

fn endpoint_for_environment(environment: CertificateEnvironment) -> Result<Url, CertificateError> {
    let test_endpoint = read_optional_env(DNS_TEST_API_URL_ENV)?;
    let test_directory = read_optional_env(ACME_TEST_DIRECTORY_ENV)?;
    let test_root = read_optional_env(ACME_TEST_ROOT_ENV)?;
    if test_endpoint.is_some() {
        if environment != CertificateEnvironment::Staging
            || test_directory.as_deref().is_none_or(str::is_empty)
            || test_root.as_deref().is_none_or(str::is_empty)
        {
            return Err(CertificateError::DnsProviderInvalid);
        }
        return parse_api_endpoint(
            test_endpoint
                .as_deref()
                .ok_or(CertificateError::DnsProviderInvalid)?,
            true,
        );
    }
    if environment == CertificateEnvironment::Production
        && (test_directory.is_some() || test_root.is_some())
    {
        return Err(CertificateError::DnsProviderInvalid);
    }
    Url::parse(CLOUDFLARE_API_BASE).map_err(|_| CertificateError::DnsProviderInvalid)
}

fn parse_api_endpoint(value: &str, allow_http: bool) -> Result<Url, CertificateError> {
    if value.is_empty() || value != value.trim() || value.len() > 2_048 {
        return Err(CertificateError::DnsProviderInvalid);
    }
    let mut url = Url::parse(value).map_err(|_| CertificateError::DnsProviderInvalid)?;
    if (!allow_http && url.scheme() != "https")
        || (allow_http && !matches!(url.scheme(), "http" | "https"))
    {
        return Err(CertificateError::DnsProviderInvalid);
    }
    if url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(CertificateError::DnsProviderInvalid);
    }
    let mut path = url.path().trim_end_matches('/').to_owned();
    if !path.ends_with("/client/v4") {
        path.push_str("/client/v4");
    }
    path.push('/');
    url.set_path(&path);
    Ok(url)
}

fn read_optional_env(name: &str) -> Result<Option<String>, CertificateError> {
    match env::var(name) {
        Ok(value) => Ok(Some(value)),
        Err(env::VarError::NotPresent) => Ok(None),
        Err(env::VarError::NotUnicode(_)) => Err(CertificateError::DnsProviderInvalid),
    }
}

fn is_cloudflare_zone_id(value: &str) -> bool {
    value.len() == 32
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
}

fn is_safe_secret(value: &str, maximum_bytes: usize) -> bool {
    !value.is_empty()
        && value.len() <= maximum_bytes
        && value
            .bytes()
            .all(|byte| byte.is_ascii() && !byte.is_ascii_whitespace() && !byte.is_ascii_control())
}

fn is_safe_certificate_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_CERTIFICATE_ID_BYTES
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn is_safe_record_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 32
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn dns_record_marker(certificate_id: &str) -> Result<String, CertificateError> {
    if !is_safe_certificate_id(certificate_id) {
        return Err(CertificateError::DnsProviderInvalid);
    }
    Ok(format!("{DNS_RECORD_COMMENT_PREFIX}{certificate_id}"))
}

fn is_owned_marker(value: &str) -> bool {
    value
        .strip_prefix(DNS_RECORD_COMMENT_PREFIX)
        .is_some_and(is_safe_certificate_id)
}

fn bare_authorization_name(value: &str) -> Option<String> {
    let value = value.strip_suffix('.').unwrap_or(value);
    let value = value.strip_prefix("_acme-challenge.").unwrap_or(value);
    let value = value.strip_prefix("*.").unwrap_or(value);
    (is_canonical_domain(value) && "_acme-challenge.".len() + value.len() <= 253)
        .then(|| value.to_owned())
}

fn domain_is_in_zone(domain: &str, zone: &str) -> bool {
    domain == zone
        || domain
            .strip_suffix(zone)
            .is_some_and(|prefix| prefix.ends_with('.'))
}

fn dns_names_equal(left: &str, right: &str) -> bool {
    left.trim_end_matches('.') == right.trim_end_matches('.')
}

fn validate_sans_against_zone(
    sans: &[String],
    zone: &str,
) -> Result<Vec<String>, CertificateError> {
    if sans.is_empty() || !is_canonical_domain(zone) {
        return Err(CertificateError::DnsProviderInvalid);
    }
    let mut names = Vec::with_capacity(sans.len());
    for san in sans {
        let bare = bare_authorization_name(san).ok_or(CertificateError::DnsProviderInvalid)?;
        if !domain_is_in_zone(&bare, zone) {
            return Err(CertificateError::DnsProviderInvalid);
        }
        names.push(bare);
    }
    Ok(names)
}

fn encryption_key_from_environment() -> Result<[u8; 32], CertificateError> {
    let direct = env::var_os(APP_ENCRYPTION_KEY_ENV);
    let file = env::var_os(APP_ENCRYPTION_KEY_FILE_ENV);
    if direct.is_some() && file.is_some() {
        return Err(CertificateError::DnsCredentialsUnavailable);
    }
    let value = if let Some(value) = direct {
        value
            .into_string()
            .map_err(|_| CertificateError::DnsCredentialsUnavailable)?
    } else if let Some(path) = file {
        let path = path
            .into_string()
            .map_err(|_| CertificateError::DnsCredentialsUnavailable)?;
        read_key_file(PathBuf::from(path))?
    } else {
        return Err(CertificateError::DnsCredentialsUnavailable);
    };
    decode_encryption_key(value.trim())
}

fn read_key_file(path: PathBuf) -> Result<String, CertificateError> {
    if !path.is_absolute() {
        return Err(CertificateError::DnsCredentialsUnavailable);
    }
    let metadata =
        fs::symlink_metadata(&path).map_err(|_| CertificateError::DnsCredentialsUnavailable)?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(CertificateError::DnsCredentialsUnavailable);
    }
    let file = fs::File::open(path).map_err(|_| CertificateError::DnsCredentialsUnavailable)?;
    let mut bytes = Vec::with_capacity((MAX_KEY_FILE_BYTES + 1) as usize);
    file.take(MAX_KEY_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| CertificateError::DnsCredentialsUnavailable)?;
    if bytes.len() as u64 > MAX_KEY_FILE_BYTES || bytes.contains(&0) {
        return Err(CertificateError::DnsCredentialsUnavailable);
    }
    String::from_utf8(bytes).map_err(|_| CertificateError::DnsCredentialsUnavailable)
}

fn decode_encryption_key(value: &str) -> Result<[u8; 32], CertificateError> {
    let decoded = STANDARD
        .decode(value.as_bytes())
        .map_err(|_| CertificateError::DnsCredentialsUnavailable)?;
    if decoded.len() != 32 || STANDARD.encode(&decoded) != value {
        return Err(CertificateError::DnsCredentialsUnavailable);
    }
    let mut key = [0_u8; 32];
    key.copy_from_slice(&decoded);
    Ok(key)
}

pub(crate) fn encrypt(
    config: &DnsProviderConfig,
    certificate_id: &str,
) -> Result<EncryptedDnsConfig, CertificateError> {
    config.validate()?;
    validate_aad(certificate_id)?;
    let key = encryption_key_from_environment()?;
    encrypt_with_key(config, certificate_id, &key)
}

pub(crate) fn decrypt(
    encrypted: &EncryptedDnsConfig,
    certificate_id: &str,
) -> Result<DnsProviderConfig, CertificateError> {
    validate_aad(certificate_id)?;
    validate_encrypted_config(encrypted)?;
    let key = encryption_key_from_environment()?;
    decrypt_with_key(encrypted, certificate_id, &key)
}

fn encrypt_with_key(
    config: &DnsProviderConfig,
    certificate_id: &str,
    key_bytes: &[u8; 32],
) -> Result<EncryptedDnsConfig, CertificateError> {
    let plaintext = serde_json::to_vec(config).map_err(|_| CertificateError::DnsProviderInvalid)?;
    let mut ciphertext = plaintext;
    let mut nonce_bytes = [0_u8; AES_GCM_NONCE_BYTES];
    SystemRandom::new()
        .fill(&mut nonce_bytes)
        .map_err(|_| CertificateError::DnsCredentialsUnavailable)?;
    let key = aead::LessSafeKey::new(
        aead::UnboundKey::new(&aead::AES_256_GCM, key_bytes)
            .map_err(|_| CertificateError::DnsCredentialsUnavailable)?,
    );
    key.seal_in_place_append_tag(
        aead::Nonce::assume_unique_for_key(nonce_bytes),
        aead::Aad::from(certificate_id.as_bytes()),
        &mut ciphertext,
    )
    .map_err(|_| CertificateError::DnsCredentialsUnavailable)?;
    if ciphertext.len() > MAX_ENCRYPTED_CIPHERTEXT_BYTES {
        return Err(CertificateError::DnsProviderInvalid);
    }
    Ok(EncryptedDnsConfig {
        version: ENCRYPTED_DNS_CONFIG_VERSION,
        nonce: nonce_bytes.to_vec(),
        ciphertext,
    })
}

fn decrypt_with_key(
    encrypted: &EncryptedDnsConfig,
    certificate_id: &str,
    key_bytes: &[u8; 32],
) -> Result<DnsProviderConfig, CertificateError> {
    let key = aead::LessSafeKey::new(
        aead::UnboundKey::new(&aead::AES_256_GCM, key_bytes)
            .map_err(|_| CertificateError::DnsCredentialsUnavailable)?,
    );
    let mut ciphertext = encrypted.ciphertext.clone();
    let plaintext = key
        .open_in_place(
            aead::Nonce::try_assume_unique_for_key(&encrypted.nonce)
                .map_err(|_| CertificateError::DnsProviderInvalid)?,
            aead::Aad::from(certificate_id.as_bytes()),
            &mut ciphertext,
        )
        .map_err(|_| CertificateError::DnsCredentialsUnavailable)?;
    serde_json::from_slice(plaintext).map_err(|_| CertificateError::DnsProviderInvalid)
}

fn validate_aad(certificate_id: &str) -> Result<(), CertificateError> {
    is_safe_certificate_id(certificate_id)
        .then_some(())
        .ok_or(CertificateError::DnsProviderInvalid)
}

fn validate_encrypted_config(encrypted: &EncryptedDnsConfig) -> Result<(), CertificateError> {
    if encrypted.version != ENCRYPTED_DNS_CONFIG_VERSION
        || encrypted.nonce.len() != AES_GCM_NONCE_BYTES
        || encrypted.ciphertext.len() < 16
        || encrypted.ciphertext.len() > MAX_ENCRYPTED_CIPHERTEXT_BYTES
    {
        return Err(CertificateError::DnsProviderInvalid);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::net::SocketAddr;

    use axum::{
        Json, Router,
        extract::{Path, State},
        http::Uri,
        routing::{delete as delete_route, get},
    };
    use tokio::{
        net::TcpListener,
        sync::{Mutex, oneshot},
        task::JoinHandle,
    };

    use super::*;

    const ZONE_ID: &str = "0123456789abcdef0123456789abcdef";

    #[derive(Clone, Debug)]
    struct MockRecord {
        id: String,
        name: String,
        content: String,
        comment: String,
    }

    #[derive(Debug)]
    struct MockState {
        records: Vec<MockRecord>,
        next_id: u32,
        post_count: u32,
        zone_status: Option<StatusCode>,
        list_status: Option<StatusCode>,
        post_status: Option<StatusCode>,
        ambiguous_post: bool,
        delete_failures: u32,
    }

    impl Default for MockState {
        fn default() -> Self {
            Self {
                records: Vec::new(),
                next_id: 1,
                post_count: 0,
                zone_status: None,
                list_status: None,
                post_status: None,
                ambiguous_post: false,
                delete_failures: 0,
            }
        }
    }

    #[derive(Deserialize)]
    struct MockCreateRecord {
        name: String,
        content: String,
        comment: String,
    }

    fn mock_record_json(record: &MockRecord) -> serde_json::Value {
        json!({
            "id": record.id,
            "name": record.name,
            "type": "TXT",
            "content": record.content,
            "comment": record.comment,
        })
    }

    fn mock_error(status: StatusCode) -> (StatusCode, Json<serde_json::Value>) {
        (
            status,
            Json(json!({
                "success": false,
                "errors": [{"code": 10000}],
            })),
        )
    }

    async fn mock_zone(
        State(state): State<Arc<Mutex<MockState>>>,
        Path(_zone_id): Path<String>,
    ) -> (StatusCode, Json<serde_json::Value>) {
        let state = state.lock().await;
        if let Some(status) = state.zone_status {
            return mock_error(status);
        }
        (
            StatusCode::OK,
            Json(json!({
                "success": true,
                "result": {"id": ZONE_ID, "name": "example.com"},
            })),
        )
    }

    async fn mock_list(
        State(state): State<Arc<Mutex<MockState>>>,
        Path(_zone_id): Path<String>,
        uri: Uri,
    ) -> (StatusCode, Json<serde_json::Value>) {
        let state = state.lock().await;
        if let Some(status) = state.list_status {
            return mock_error(status);
        }
        let query = uri.query().unwrap_or_default();
        let query_value = |key: &str| {
            query.split('&').find_map(|pair| {
                let (candidate, value) = pair.split_once('=')?;
                (candidate == key).then(|| value.to_owned())
            })
        };
        let name = query_value("name");
        let page = query_value("page")
            .and_then(|value| value.parse::<u32>().ok())
            .unwrap_or(1)
            .max(1);
        let per_page = query_value("per_page")
            .and_then(|value| value.parse::<u32>().ok())
            .unwrap_or(100)
            .clamp(1, 100);
        let filtered = state
            .records
            .iter()
            .filter(|record| name.as_deref().is_none_or(|name| record.name == name))
            .cloned()
            .collect::<Vec<_>>();
        let total_pages = filtered.len().div_ceil(per_page as usize).max(1);
        let start = (page.saturating_sub(1) as usize).saturating_mul(per_page as usize);
        let result = filtered
            .iter()
            .skip(start)
            .take(per_page as usize)
            .map(mock_record_json)
            .collect::<Vec<_>>();
        (
            StatusCode::OK,
            Json(json!({
                "success": true,
                "result": result,
                "result_info": {
                    "page": page,
                    "per_page": per_page,
                    "total_pages": total_pages,
                },
            })),
        )
    }

    async fn mock_post(
        State(state): State<Arc<Mutex<MockState>>>,
        Path(_zone_id): Path<String>,
        Json(body): Json<MockCreateRecord>,
    ) -> (StatusCode, Json<serde_json::Value>) {
        let mut state = state.lock().await;
        if let Some(status) = state.post_status {
            return mock_error(status);
        }
        state.post_count += 1;
        let record = MockRecord {
            id: format!("record-{}", state.next_id),
            name: body.name,
            content: body.content,
            comment: body.comment,
        };
        state.next_id += 1;
        state.records.push(record.clone());
        if state.ambiguous_post {
            state.ambiguous_post = false;
            return mock_error(StatusCode::BAD_GATEWAY);
        }
        (
            StatusCode::OK,
            Json(json!({"success": true, "result": mock_record_json(&record)})),
        )
    }

    async fn mock_delete(
        State(state): State<Arc<Mutex<MockState>>>,
        Path((_zone_id, record_id)): Path<(String, String)>,
    ) -> (StatusCode, Json<serde_json::Value>) {
        let mut state = state.lock().await;
        if state.delete_failures > 0 {
            state.delete_failures -= 1;
            return mock_error(StatusCode::SERVICE_UNAVAILABLE);
        }
        let Some(index) = state
            .records
            .iter()
            .position(|record| record.id == record_id)
        else {
            return mock_error(StatusCode::NOT_FOUND);
        };
        state.records.remove(index);
        (
            StatusCode::OK,
            Json(json!({"success": true, "result": {"id": record_id}})),
        )
    }

    async fn fixture(
        state: Arc<Mutex<MockState>>,
    ) -> (
        DnsProvider,
        Arc<Mutex<MockState>>,
        oneshot::Sender<()>,
        JoinHandle<()>,
    ) {
        let app = Router::new()
            .route("/client/v4/zones/{zone_id}", get(mock_zone))
            .route(
                "/client/v4/zones/{zone_id}/dns_records",
                get(mock_list).post(mock_post),
            )
            .route(
                "/client/v4/zones/{zone_id}/dns_records/{record_id}",
                delete_route(mock_delete),
            )
            .with_state(state.clone());
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address: SocketAddr = listener.local_addr().unwrap();
        let (shutdown, receiver) = oneshot::channel();
        let task = tokio::spawn(async move {
            axum::serve(listener, app)
                .with_graceful_shutdown(async {
                    let _ = receiver.await;
                })
                .await
                .unwrap();
        });
        let provider =
            DnsProvider::with_endpoint_for_test(config(), &format!("http://{address}")).unwrap();
        (provider, state, shutdown, task)
    }

    fn config() -> DnsProviderConfig {
        DnsProviderConfig::cloudflare(
            "0123456789abcdef0123456789abcdef",
            "token-without-whitespace",
        )
        .unwrap()
    }

    #[test]
    fn config_json_is_tagged_and_debug_redacts_token() {
        let config = config();
        let value = serde_json::to_value(&config).unwrap();
        assert_eq!(value["type"], "cloudflare");
        assert_eq!(value["zoneId"], "0123456789abcdef0123456789abcdef");
        assert_eq!(value["apiToken"], "token-without-whitespace");
        let debug = format!("{config:?}");
        assert!(!debug.contains("token-without-whitespace"));
        assert!(debug.contains("REDACTED"));
    }

    #[test]
    fn config_deserialization_rejects_bad_zone_and_token() {
        for value in [
            json!({"type":"cloudflare","zoneId":"0123456789ABCDEF0123456789abcdef","apiToken":"x"}),
            json!({"type":"cloudflare","zoneId":"0123456789abcdef0123456789abcde","apiToken":"x"}),
            json!({"type":"cloudflare","zoneId":"0123456789abcdef0123456789abcdef","apiToken":"x y"}),
            json!({"type":"cloudflare","zoneId":"0123456789abcdef0123456789abcdef","apiToken":""}),
        ] {
            assert!(serde_json::from_value::<DnsProviderConfig>(value).is_err());
        }
    }

    #[test]
    fn encrypt_decrypt_uses_aad_and_never_persists_plaintext() {
        let config = config();
        let key = [7_u8; 32];
        let encrypted = encrypt_with_key(&config, "certificate-1", &key).unwrap();
        let encoded = serde_json::to_string(&encrypted).unwrap();
        assert!(!encoded.contains("token-without-whitespace"));
        assert_eq!(
            decrypt_with_key(&encrypted, "certificate-1", &key).unwrap(),
            config
        );
        assert_eq!(
            decrypt_with_key(&encrypted, "certificate-2", &key),
            Err(CertificateError::DnsCredentialsUnavailable)
        );
        let mut tampered = encrypted.clone();
        tampered.ciphertext[0] ^= 1;
        assert_eq!(
            decrypt_with_key(&tampered, "certificate-1", &key),
            Err(CertificateError::DnsCredentialsUnavailable)
        );
    }

    #[test]
    fn authorization_names_enforce_zone_boundaries_and_wildcards() {
        let zone = "example.com";
        let names = validate_sans_against_zone(
            &[
                "example.com".to_owned(),
                "*.example.com".to_owned(),
                "api.child.example.com".to_owned(),
            ],
            zone,
        )
        .unwrap();
        assert_eq!(
            names,
            vec![
                "example.com".to_owned(),
                "example.com".to_owned(),
                "api.child.example.com".to_owned(),
            ]
        );
        assert!(validate_sans_against_zone(&["example.com.evil".to_owned()], zone).is_err());
        assert!(validate_sans_against_zone(&["badexample.com".to_owned()], zone).is_err());
    }

    #[test]
    fn intent_marker_and_owner_name_are_stable_for_apex_and_wildcard() {
        let apex = DnsRecordIntent::new("certificate-1", "example.com", "digest-apex").unwrap();
        let wildcard =
            DnsRecordIntent::new("certificate-1", "*.example.com", "digest-wildcard").unwrap();
        assert_eq!(apex.name, wildcard.name);
        assert_ne!(apex.value, wildcard.value);
        assert_eq!(apex.marker, wildcard.marker);
        assert_eq!(
            bare_authorization_name("_acme-challenge.example.com"),
            Some("example.com".to_owned())
        );
    }

    #[test]
    fn endpoint_is_pinned_and_test_path_is_normalized() {
        let production = parse_api_endpoint(CLOUDFLARE_API_BASE, false).unwrap();
        assert_eq!(production.as_str(), CLOUDFLARE_API_BASE);
        let test = parse_api_endpoint("http://127.0.0.1:1234", true).unwrap();
        assert_eq!(test.as_str(), "http://127.0.0.1:1234/client/v4/");
        assert!(parse_api_endpoint("http://user@127.0.0.1:1234", true).is_err());
        assert!(parse_api_endpoint("https://api.cloudflare.com?token=secret", false).is_err());
    }

    #[tokio::test]
    async fn provider_presents_and_cleans_only_exact_owned_values() {
        let state = Arc::new(Mutex::new(MockState::default()));
        state.lock().await.records.push(MockRecord {
            id: "foreign".to_owned(),
            name: "_acme-challenge.example.com".to_owned(),
            content: "foreign-value".to_owned(),
            comment: "operator-owned".to_owned(),
        });
        let (provider, state, shutdown, task) = fixture(state).await;
        let apex = DnsRecordIntent::new("certificate-1", "example.com", "digest-apex").unwrap();
        let wildcard =
            DnsRecordIntent::new("certificate-1", "*.example.com", "digest-wildcard").unwrap();
        let first = provider.present(&apex).await.unwrap();
        let second = provider.present(&wildcard).await.unwrap();
        assert_ne!(first.id, second.id);
        assert_eq!(state.lock().await.records.len(), 3);
        provider.cleanup_intents(&[apex, wildcard]).await.unwrap();
        let records = state.lock().await.records.clone();
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].id, "foreign");
        let _ = shutdown.send(());
        task.await.unwrap();
    }

    #[tokio::test]
    async fn provider_recovers_owned_record_after_ambiguous_create() {
        let state = Arc::new(Mutex::new(MockState {
            ambiguous_post: true,
            ..MockState::default()
        }));
        let (provider, state, shutdown, task) = fixture(state).await;
        let intent = DnsRecordIntent::new("certificate-1", "example.com", "digest").unwrap();
        let handle = provider.present(&intent).await.unwrap();
        assert_eq!(state.lock().await.post_count, 1);
        assert_eq!(handle.intent, intent);
        provider.cleanup_intents(&[intent]).await.unwrap();
        assert!(state.lock().await.records.is_empty());
        let _ = shutdown.send(());
        task.await.unwrap();
    }

    #[tokio::test]
    async fn provider_lists_bounded_pages_and_maps_auth_and_cleanup_failures() {
        let mut initial = MockState::default();
        for index in 0..100 {
            initial.records.push(MockRecord {
                id: format!("foreign-{index}"),
                name: "_acme-challenge.example.com".to_owned(),
                content: format!("foreign-{index}"),
                comment: "operator-owned".to_owned(),
            });
        }
        let intent = DnsRecordIntent::new("certificate-1", "example.com", "digest").unwrap();
        initial.records.push(MockRecord {
            id: "owned-page-two".to_owned(),
            name: "_acme-challenge.example.com".to_owned(),
            content: intent.value.clone(),
            comment: intent.marker.clone(),
        });
        let state = Arc::new(Mutex::new(initial));
        let (provider, state, shutdown, task) = fixture(state).await;
        state.lock().await.zone_status = Some(StatusCode::FORBIDDEN);
        assert_eq!(
            provider.zone_name().await,
            Err(CertificateError::DnsProviderUnauthorized)
        );
        state.lock().await.zone_status = None;
        let records = provider.find_owned_records(&intent).await.unwrap();
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].id, "owned-page-two");
        let handle = provider.present(&intent).await.unwrap();
        state.lock().await.delete_failures = 1;
        assert_eq!(
            provider
                .cleanup_intents(std::slice::from_ref(&intent))
                .await,
            Err(CertificateError::DnsCleanupFailed)
        );
        assert!(
            state
                .lock()
                .await
                .records
                .iter()
                .any(|record| record.id == handle.id)
        );
        provider.cleanup_intents(&[intent]).await.unwrap();
        assert!(
            !state
                .lock()
                .await
                .records
                .iter()
                .any(|record| record.id == handle.id)
        );
        let _ = shutdown.send(());
        task.await.unwrap();
    }
}
