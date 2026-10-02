use reqwest::{Method, StatusCode, Url};
use serde::{Deserialize, de::DeserializeOwned};

use crate::runtime::certificates::CertificateError;

use super::provider::DnsProvider;

pub(super) const MAX_RESPONSE_BODY_BYTES: usize = 64 * 1024;
pub(super) const MAX_REQUEST_BODY_BYTES: usize = 16 * 1024;
pub(super) const RECORDS_PER_PAGE: u32 = 100;

#[derive(Clone, Debug, Deserialize)]
pub(super) struct CloudflareResponse<T> {
    pub(super) success: bool,
    #[serde(default)]
    pub(super) errors: Vec<CloudflareError>,
    pub(super) result: Option<T>,
    #[serde(default)]
    pub(super) result_info: Option<CloudflareResultInfo>,
}

#[derive(Clone, Copy, Debug, Deserialize)]
pub(super) struct CloudflareError {
    #[serde(default)]
    pub(super) code: Option<u64>,
}

impl CloudflareError {
    fn is_unauthorized(self) -> bool {
        matches!(self.code, Some(10_000 | 9_109 | 9_106 | 9_107))
    }
}

#[derive(Clone, Copy, Debug, Deserialize)]
pub(super) struct CloudflareResultInfo {
    #[serde(default)]
    pub(super) page: Option<u32>,
    #[serde(default)]
    pub(super) total_pages: Option<u32>,
    #[serde(default)]
    pub(super) per_page: Option<u32>,
}

impl CloudflareResultInfo {
    pub(super) fn has_more(&self, requested_page: u32, records_len: usize) -> bool {
        if let Some(total_pages) = self.total_pages {
            return self.page.unwrap_or(requested_page) < total_pages;
        }
        records_len >= self.per_page.unwrap_or(RECORDS_PER_PAGE) as usize
    }
}

#[derive(Clone, Debug, Deserialize)]
pub(super) struct CloudflareZone {
    pub(super) id: String,
    pub(super) name: String,
}

#[derive(Clone, Debug, Deserialize)]
pub(super) struct CloudflareRecord {
    pub(super) id: String,
    pub(super) name: String,
    #[serde(rename = "type")]
    pub(super) record_type: String,
    pub(super) content: String,
    #[serde(default)]
    pub(super) comment: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
pub(super) struct CloudflareRecordDelete {
    #[allow(dead_code)]
    pub(super) id: Option<String>,
}

#[derive(Clone, Copy, Debug)]
pub(super) enum ProviderRequestError {
    Network,
    BodyTooLarge,
    Unauthorized,
    Status(StatusCode),
    InvalidResponse,
    Api,
    InvalidRequest,
}

impl ProviderRequestError {
    pub(super) fn status(status: StatusCode) -> Self {
        if matches!(status, StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN) {
            Self::Unauthorized
        } else {
            Self::Status(status)
        }
    }

    pub(super) fn from_reqwest(error: &reqwest::Error) -> Self {
        if error.is_timeout() || error.is_connect() || error.is_request() {
            Self::Network
        } else {
            Self::InvalidResponse
        }
    }

    pub(super) fn is_ambiguous(self) -> bool {
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

pub(super) fn map_provider_error(error: ProviderRequestError) -> CertificateError {
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

impl DnsProvider {
    pub(super) fn api_path(&self, path: &str) -> Result<Url, CertificateError> {
        self.base_url
            .join(path)
            .map_err(|_| CertificateError::DnsProviderInvalid)
    }

    pub(super) async fn call<T: DeserializeOwned>(
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

    pub(super) async fn send(
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
