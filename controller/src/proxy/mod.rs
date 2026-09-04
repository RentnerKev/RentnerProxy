mod revision;
mod trusted_ca;

use std::{
    collections::HashSet,
    net::{Ipv4Addr, Ipv6Addr},
};

use crate::models::{ProxyConfigRequest, ProxyHttpSettings, TrustedCa, ValidatedProxyConfig};

#[cfg(test)]
pub(crate) use revision::revision_for_configuration;
#[cfg(test)]
pub(crate) use revision::revision_for_configuration_with_trusted_cas;
#[cfg(test)]
pub(crate) use revision::revision_for_hosts;
use revision::{canonical_hosts, canonical_redirect_hosts, canonical_trusted_cas, is_revision};
pub(crate) use revision::{revision_for_configuration_with_redirects, revision_from_config};
pub(crate) use trusted_ca::{
    MAX_TRUSTED_CA_PEM_BYTES, TrustedCaValidationRequest, validate_trusted_ca,
    validate_trusted_ca_pem,
};

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
    if !matches!(request.version, 1..=6) || !is_revision(&request.revision) {
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
    let has_https_upstream = request
        .proxy_hosts
        .iter()
        .any(|host| host.forward_scheme == "https");
    let has_upstream_tls_configuration = request
        .proxy_hosts
        .iter()
        .any(|host| host.upstream_tls.is_some());
    let has_redirect_hosts = !request.redirect_hosts.is_empty();
    if (request.version <= 5 && has_redirect_hosts)
        || (request.version == 6 && !has_redirect_hosts)
        || (request.version <= 4
            && (has_upstream_tls_configuration || !request.trusted_cas.is_empty()))
        || (request.version == 1
            && (!request.http_settings.is_empty()
                || has_host_configuration
                || has_tls_configuration))
        || (request.version == 2
            && (request.http_settings.is_empty()
                || has_host_configuration
                || has_tls_configuration))
        || (request.version == 3 && (!has_host_configuration || has_tls_configuration))
        || (request.version == 4 && !has_tls_configuration)
        || (request.version == 5 && (!has_https_upstream || !has_upstream_tls_configuration))
    {
        return Err(ProxyValidationError::InvalidConfiguration);
    }

    if !has_valid_http_settings(&request.http_settings) {
        return Err(ProxyValidationError::ValidationFailed);
    }

    if request
        .proxy_hosts
        .len()
        .saturating_add(request.redirect_hosts.len())
        > MAX_PROXY_HOSTS
    {
        return Err(ProxyValidationError::ValidationFailed);
    }

    let mut ids = HashSet::with_capacity(request.proxy_hosts.len() + request.redirect_hosts.len());
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
            || !has_valid_upstream_tls(host)
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

    for host in &request.redirect_hosts {
        if !is_canonical_uuid(&host.id)
            || !ids.insert(host.id.as_str())
            || host.domains.is_empty()
            || host.domains.len() > MAX_DOMAINS_PER_HOST
            || !has_valid_redirect_destination(&host.destination, host.preserve_request_uri)
            || !matches!(host.status_code, 301 | 302 | 307 | 308)
            || host
                .certificate_id
                .as_deref()
                .is_some_and(|id| !is_canonical_uuid_v7(id))
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

    if matches!(request.version, 5 | 6) {
        if request
            .proxy_hosts
            .iter()
            .any(|host| (host.forward_scheme == "https") != host.upstream_tls.is_some())
        {
            return Err(ProxyValidationError::ValidationFailed);
        }
        validate_and_canonicalize_trusted_cas(&mut request.trusted_cas)?;
        let trusted_ca_ids = request
            .trusted_cas
            .iter()
            .map(|trusted_ca| trusted_ca.id.as_str())
            .collect::<HashSet<_>>();
        let referenced_ca_ids = request
            .proxy_hosts
            .iter()
            .filter_map(|host| host.upstream_tls.as_ref()?.trusted_ca_id.as_deref())
            .collect::<HashSet<_>>();
        if referenced_ca_ids
            .iter()
            .any(|id| !trusted_ca_ids.contains(id))
            || trusted_ca_ids
                .iter()
                .any(|id| !referenced_ca_ids.contains(id))
        {
            return Err(ProxyValidationError::ValidationFailed);
        }
    }

    let canonical_hosts = canonical_hosts(&request.proxy_hosts);
    let canonical_redirect_hosts = canonical_redirect_hosts(&request.redirect_hosts);
    let canonical_trusted_cas = canonical_trusted_cas(&request.trusted_cas);
    let actual_revision = revision_for_configuration_with_redirects(
        &canonical_hosts,
        &canonical_redirect_hosts,
        &request.http_settings,
        &canonical_trusted_cas,
    );
    if request.revision != actual_revision {
        return Err(ProxyValidationError::ValidationFailed);
    }

    Ok(ValidatedProxyConfig {
        revision: request.revision,
        proxy_hosts: canonical_hosts,
        redirect_hosts: canonical_redirect_hosts,
        http_settings: request.http_settings,
        trusted_cas: canonical_trusted_cas,
    })
}

fn has_valid_upstream_tls(host: &crate::models::ProxyHost) -> bool {
    let Some(upstream_tls) = host.upstream_tls.as_ref() else {
        // HTTPS always needs an explicit policy, including old snapshot versions.
        return host.forward_scheme != "https";
    };
    if host.forward_scheme != "https"
        || upstream_tls
            .server_name
            .as_deref()
            .is_some_and(|server_name| !is_canonical_domain(server_name))
        || upstream_tls
            .trusted_ca_id
            .as_deref()
            .is_some_and(|id| !is_canonical_uuid_v7(id))
        || (!upstream_tls.verify && upstream_tls.trusted_ca_id.is_some())
    {
        return false;
    }
    if upstream_tls.verify
        && is_ip_address(&host.forward_host)
        && upstream_tls.server_name.is_none()
    {
        return false;
    }
    true
}

fn has_valid_redirect_destination(value: &str, preserve_request_uri: bool) -> bool {
    if value.len() > 2_048 {
        return false;
    }
    let authority_and_suffix = value
        .strip_prefix("http://")
        .or_else(|| value.strip_prefix("https://"));
    let Some(authority_and_suffix) = authority_and_suffix else {
        return false;
    };

    if value.bytes().any(|byte| {
        byte.is_ascii_whitespace()
            || byte.is_ascii_control()
            || matches!(byte, b'$' | b'"' | b'\'' | b'\\' | b'{' | b'}')
    }) {
        return false;
    }

    let authority_end = authority_and_suffix
        .bytes()
        .position(|byte| matches!(byte, b'/' | b'?' | b'#'))
        .unwrap_or(authority_and_suffix.len());
    let authority = &authority_and_suffix[..authority_end];
    if !has_valid_redirect_authority(authority) {
        return false;
    }

    let bytes = value.as_bytes();
    let mut index = 0;
    let mut decoded = Vec::with_capacity(bytes.len());
    while index < bytes.len() {
        if bytes[index] == b'%' {
            if index + 2 >= bytes.len()
                || !bytes[index + 1].is_ascii_hexdigit()
                || !bytes[index + 2].is_ascii_hexdigit()
            {
                return false;
            }
            decoded.push(hex_value(bytes[index + 1]) * 16 + hex_value(bytes[index + 2]));
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }
    let Ok(decoded) = std::str::from_utf8(&decoded) else {
        return false;
    };
    if decoded.chars().any(|character| character.is_control()) {
        return false;
    }

    !preserve_request_uri
        || (!authority_and_suffix.contains('?')
            && !authority_and_suffix.contains('#')
            && !value.ends_with('/'))
}

fn has_valid_redirect_authority(authority: &str) -> bool {
    if authority.is_empty() || authority.contains('@') {
        return false;
    }
    if let Some(bracketed) = authority.strip_prefix('[') {
        let Some(end) = bracketed.find(']') else {
            return false;
        };
        if bracketed[..end].parse::<Ipv6Addr>().is_err() {
            return false;
        }
        return has_valid_redirect_port(&bracketed[end + 1..]);
    }
    if authority.matches(':').count() > 1 {
        return false;
    }
    match authority.split_once(':') {
        Some((host, port)) => {
            is_valid_forward_host(host) && port.parse::<u16>().is_ok_and(|port| port != 0)
        }
        None => is_valid_forward_host(authority),
    }
}

fn has_valid_redirect_port(value: &str) -> bool {
    value.is_empty()
        || value
            .strip_prefix(':')
            .is_some_and(|port| port.parse::<u16>().is_ok_and(|port| port != 0))
}

fn hex_value(byte: u8) -> u8 {
    match byte {
        b'0'..=b'9' => byte - b'0',
        b'a'..=b'f' => byte - b'a' + 10,
        b'A'..=b'F' => byte - b'A' + 10,
        _ => 0,
    }
}

fn validate_and_canonicalize_trusted_cas(
    trusted_cas: &mut [TrustedCa],
) -> Result<(), ProxyValidationError> {
    let mut ids = HashSet::with_capacity(trusted_cas.len());
    for trusted_ca in trusted_cas {
        if !is_canonical_uuid_v7(&trusted_ca.id) || !ids.insert(trusted_ca.id.as_str()) {
            return Err(ProxyValidationError::ValidationFailed);
        }
        let validated = trusted_ca::validate_trusted_ca(trusted_ca)
            .map_err(|_| ProxyValidationError::ValidationFailed)?;
        trusted_ca.pem = validated.pem;
        trusted_ca.fingerprint_sha256 = validated.fingerprint_sha256;
    }
    Ok(())
}

fn is_ip_address(value: &str) -> bool {
    value.parse::<Ipv4Addr>().is_ok() || value.parse::<Ipv6Addr>().is_ok()
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
