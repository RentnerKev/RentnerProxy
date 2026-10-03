use super::{
    ActiveProvider, CrowdSecError, DesiredProvider, MAX_LAPI_RESPONSE_BYTES, ProxyRuntime,
    normalize_api_url, validate_api_key,
};
use crate::models::{CrowdSecConfigRequest, CrowdSecMode, SecretString};
use reqwest::{StatusCode, Url, redirect::Policy};
use std::time::Duration;

impl ProxyRuntime {
    pub(super) async fn prepare_provider(
        &self,
        desired: &DesiredProvider,
        provider: &ActiveProvider,
    ) -> Result<ActiveProvider, CrowdSecError> {
        match provider {
            ActiveProvider::Managed { .. } => {
                let managed = self.prepare_managed_provider(desired).await?;
                Ok(managed)
            }
            ActiveProvider::External { api_url, api_key } => {
                self.probe_lapi(api_url, api_key).await?;
                Ok(provider.clone())
            }
            ActiveProvider::Disabled => Ok(provider.clone()),
        }
    }

    pub(super) fn validate_request(
        &self,
        request: CrowdSecConfigRequest,
    ) -> Result<(DesiredProvider, ActiveProvider), CrowdSecError> {
        match request.mode {
            CrowdSecMode::Disabled
                if !request.community_enabled
                    && request.api_url.is_none()
                    && request.api_key.is_none() =>
            {
                Ok((DesiredProvider::Disabled, ActiveProvider::Disabled))
            }
            CrowdSecMode::Managed if request.api_url.is_none() && request.api_key.is_none() => {
                Ok((
                    DesiredProvider::Managed {
                        community_enabled: request.community_enabled,
                    },
                    ActiveProvider::Managed {
                        api_key: SecretString::new(String::new()),
                    },
                ))
            }
            CrowdSecMode::External if !request.community_enabled => {
                let api_url = normalize_api_url(
                    request
                        .api_url
                        .as_deref()
                        .ok_or(CrowdSecError::InvalidConfiguration)?,
                )?;
                let api_key = request.api_key.ok_or(CrowdSecError::InvalidConfiguration)?;
                validate_api_key(&api_key)?;
                Ok((
                    DesiredProvider::External {
                        api_url: api_url.clone(),
                    },
                    ActiveProvider::External { api_url, api_key },
                ))
            }
            CrowdSecMode::Disabled | CrowdSecMode::Managed | CrowdSecMode::External => {
                Err(CrowdSecError::InvalidConfiguration)
            }
        }
    }

    pub(super) async fn probe_lapi(
        &self,
        api_url: &str,
        api_key: &SecretString,
    ) -> Result<(), CrowdSecError> {
        let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
        let endpoint = Url::parse(api_url)
            .and_then(|url| url.join("v1/decisions?ip=192.0.2.1"))
            .map_err(|_| CrowdSecError::InvalidConfiguration)?;
        let client = reqwest::Client::builder()
            .redirect(Policy::none())
            .no_proxy()
            .connect_timeout(Duration::from_secs(2))
            .timeout(Duration::from_secs(3))
            .build()
            .map_err(|_| CrowdSecError::ConnectionFailed)?;
        let mut response = client
            .get(endpoint)
            .header("X-Api-Key", api_key.expose())
            .header("Accept", "application/json")
            .send()
            .await
            .map_err(|_| CrowdSecError::ConnectionFailed)?;
        if response.status() != StatusCode::OK
            || response
                .content_length()
                .is_some_and(|length| length > MAX_LAPI_RESPONSE_BYTES as u64)
        {
            return Err(CrowdSecError::ConnectionFailed);
        }
        let mut body = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| CrowdSecError::ConnectionFailed)?
        {
            if body.len().saturating_add(chunk.len()) > MAX_LAPI_RESPONSE_BYTES {
                return Err(CrowdSecError::ConnectionFailed);
            }
            body.extend_from_slice(&chunk);
        }
        serde_json::from_slice::<serde_json::Value>(&body)
            .map(|_| ())
            .map_err(|_| CrowdSecError::ConnectionFailed)
    }
}
