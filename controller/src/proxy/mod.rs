mod revision;

use std::{
    collections::HashSet,
    net::{Ipv4Addr, Ipv6Addr},
};

use crate::models::{ProxyConfigRequest, ValidatedProxyConfig};

use revision::{canonical_hosts, is_revision};
pub(crate) use revision::{revision_for_hosts, revision_from_config};

pub(crate) const MAX_PROXY_HOSTS: usize = 1_000;
const MAX_DOMAINS_PER_HOST: usize = 50;
const MAX_TOTAL_DOMAINS: usize = 50_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ProxyValidationError {
    InvalidConfiguration,
    ValidationFailed,
}

pub(crate) fn validate_proxy_config(
    request: ProxyConfigRequest,
) -> Result<ValidatedProxyConfig, ProxyValidationError> {
    if request.version != 1 || !is_revision(&request.revision) {
        return Err(ProxyValidationError::InvalidConfiguration);
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
    let actual_revision = revision_for_hosts(&canonical_hosts);
    if request.revision != actual_revision {
        return Err(ProxyValidationError::ValidationFailed);
    }

    Ok(ValidatedProxyConfig {
        revision: request.revision,
        proxy_hosts: canonical_hosts,
    })
}

fn is_canonical_uuid(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(index, byte)| {
            if matches!(index, 8 | 13 | 18 | 23) {
                byte == b'-'
            } else {
                byte.is_ascii_digit() || matches!(byte, b'a'..=b'f')
            }
        })
}

fn is_canonical_domain(value: &str) -> bool {
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
