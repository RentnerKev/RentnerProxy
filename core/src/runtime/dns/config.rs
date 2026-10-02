use std::env;
use std::fmt;

use reqwest::Url;
use serde::{Deserialize, Deserializer, Serialize};

use crate::runtime::{certificates::CertificateEnvironment, certificates::CertificateError};

use super::validation::{is_cloudflare_zone_id, is_safe_secret};

pub(super) const CLOUDFLARE_API_BASE: &str = "https://api.cloudflare.com/client/v4/";
const DNS_TEST_API_URL_ENV: &str = "RENTNERPROXY_DNS_TEST_API_URL";
const ACME_TEST_DIRECTORY_ENV: &str = "RENTNERPROXY_ACME_TEST_DIRECTORY_URL";
const ACME_TEST_ROOT_ENV: &str = "RENTNERPROXY_ACME_TEST_ROOT_CERT";

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

    pub(super) fn zone_id(&self) -> &str {
        match self {
            Self::Cloudflare { zone_id, .. } => zone_id,
        }
    }

    pub(super) fn api_token(&self) -> &str {
        match self {
            Self::Cloudflare { api_token, .. } => api_token,
        }
    }
}

pub(super) fn endpoint_for_environment(
    environment: CertificateEnvironment,
) -> Result<Url, CertificateError> {
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

pub(super) fn parse_api_endpoint(value: &str, allow_http: bool) -> Result<Url, CertificateError> {
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
