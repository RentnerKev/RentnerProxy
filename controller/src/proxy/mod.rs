mod revision;

use std::{
    collections::HashSet,
    net::{Ipv4Addr, Ipv6Addr},
};

use crate::models::{ProxyConfigRequest, ProxyHttpSettings, ValidatedProxyConfig};

#[cfg(test)]
pub(crate) use revision::revision_for_hosts;
use revision::{canonical_hosts, is_revision};
pub(crate) use revision::{revision_for_configuration, revision_from_config};

pub(crate) const MAX_PROXY_HOSTS: usize = 1_000;
pub(crate) const MAX_ADVANCED_CONFIG_BYTES: usize = 64 * 1024;
const MAX_DOMAINS_PER_HOST: usize = 50;
const MAX_TOTAL_DOMAINS: usize = 50_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ProxyValidationError {
    InvalidConfiguration,
    ValidationFailed,
}

pub(crate) fn validate_proxy_config(
    mut request: ProxyConfigRequest,
) -> Result<ValidatedProxyConfig, ProxyValidationError> {
    if !matches!(request.version, 1..=4) || !is_revision(&request.revision) {
        return Err(ProxyValidationError::InvalidConfiguration);
    }

    for host in &mut request.proxy_hosts {
        host.advanced_config = normalize_advanced_config(&host.advanced_config);
    }
    let has_host_configuration = request
        .proxy_hosts
        .iter()
        .any(|host| !host.http_settings.is_empty() || !host.advanced_config.is_empty());
    let has_tls_configuration = request
        .proxy_hosts
        .iter()
        .any(|host| host.certificate_id.is_some());
    if (request.version == 1
        && (!request.http_settings.is_empty() || has_host_configuration || has_tls_configuration))
        || (request.version == 2
            && (request.http_settings.is_empty()
                || has_host_configuration
                || has_tls_configuration))
        || (request.version == 3 && (!has_host_configuration || has_tls_configuration))
        || (request.version == 4 && !has_tls_configuration)
    {
        return Err(ProxyValidationError::InvalidConfiguration);
    }

    if !has_valid_http_settings(&request.http_settings) {
        return Err(ProxyValidationError::ValidationFailed);
    }

    if request.proxy_hosts.len() > MAX_PROXY_HOSTS {
        return Err(ProxyValidationError::ValidationFailed);
    }

    let mut ids = HashSet::with_capacity(request.proxy_hosts.len());
    let mut domains = HashSet::new();
    let mut total_domains = 0usize;

    for host in &request.proxy_hosts {
        if !is_canonical_uuid(&host.id)
            || !ids.insert(host.id.as_str())
            || host.domains.is_empty()
            || host.domains.len() > MAX_DOMAINS_PER_HOST
            || !matches!(host.forward_scheme.as_str(), "http" | "https")
            || !is_valid_forward_host(&host.forward_host)
            || host.forward_port == 0
            || !has_valid_http_settings(&host.http_settings)
            || !has_valid_advanced_config(&host.advanced_config)
            || host
                .certificate_id
                .as_deref()
                .is_some_and(|id| !is_canonical_uuid_v7(id))
            || (host.force_https && host.certificate_id.is_none())
        {
            return Err(ProxyValidationError::ValidationFailed);
        }

        total_domains = total_domains.saturating_add(host.domains.len());
        if total_domains > MAX_TOTAL_DOMAINS {
            return Err(ProxyValidationError::ValidationFailed);
        }

        for domain in &host.domains {
            if !is_canonical_domain(domain) || !domains.insert(domain.as_str()) {
                return Err(ProxyValidationError::ValidationFailed);
            }
        }
    }

    let canonical_hosts = canonical_hosts(&request.proxy_hosts);
    let actual_revision = revision_for_configuration(&canonical_hosts, &request.http_settings);
    if request.revision != actual_revision {
        return Err(ProxyValidationError::ValidationFailed);
    }

    Ok(ValidatedProxyConfig {
        revision: request.revision,
        proxy_hosts: canonical_hosts,
        http_settings: request.http_settings,
    })
}

fn has_valid_http_settings(settings: &ProxyHttpSettings) -> bool {
    option_in_range(settings.client_max_body_size_bytes, 1_024, 1_073_741_824)
        && option_in_range(settings.proxy_connect_timeout_seconds, 1, 60)
        && option_in_range(settings.proxy_read_timeout_seconds, 1, 3_600)
        && option_in_range(settings.proxy_send_timeout_seconds, 1, 3_600)
        && option_in_range(settings.send_timeout_seconds, 1, 300)
        && option_in_range(settings.keepalive_timeout_seconds, 1, 300)
}

fn option_in_range(value: Option<u32>, minimum: u32, maximum: u32) -> bool {
    value.is_none_or(|value| (minimum..=maximum).contains(&value))
}

fn has_valid_advanced_config(value: &str) -> bool {
    value.len() <= MAX_ADVANCED_CONFIG_BYTES && !value.as_bytes().contains(&0)
}

pub(crate) fn normalize_advanced_config(value: &str) -> String {
    value.replace("\r\n", "\n")
}

pub(crate) fn is_canonical_uuid(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(index, byte)| {
            if matches!(index, 8 | 13 | 18 | 23) {
                byte == b'-'
            } else {
                byte.is_ascii_digit() || matches!(byte, b'a'..=b'f')
            }
        })
}

pub(crate) fn is_canonical_uuid_v7(value: &str) -> bool {
    is_canonical_uuid(value)
        && value.as_bytes().get(14) == Some(&b'7')
        && matches!(value.as_bytes().get(19), Some(b'8' | b'9' | b'a' | b'b'))
}

pub(crate) fn is_canonical_domain(value: &str) -> bool {
    value.len() <= 253
        && !value.is_empty()
        && value == value.to_ascii_lowercase()
        && value.parse::<Ipv4Addr>().is_err()
        && value.split('.').all(is_dns_label)
}

fn is_valid_forward_host(value: &str) -> bool {
    if value.is_empty() || value.len() > 253 || value != value.trim() {
        return false;
    }
    if value.parse::<Ipv4Addr>().is_ok() {
        return true;
    }
    if value.contains(':') {
        return !value.starts_with('[')
            && !value.ends_with(']')
            && value.parse::<Ipv6Addr>().is_ok();
    }
    is_canonical_domain(value)
}

fn is_dns_label(label: &str) -> bool {
    let bytes = label.as_bytes();
    (1..=63).contains(&bytes.len())
        && bytes.first().is_some_and(u8::is_ascii_alphanumeric)
        && bytes.last().is_some_and(u8::is_ascii_alphanumeric)
        && bytes
            .iter()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || *byte == b'-')
}
