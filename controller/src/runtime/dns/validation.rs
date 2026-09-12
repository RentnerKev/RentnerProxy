use crate::{proxy::is_canonical_domain, runtime::certificates::CertificateError};

pub(super) const DNS_RECORD_COMMENT_PREFIX: &str = "rentnerproxy-acme:";
const MAX_CERTIFICATE_ID_BYTES: usize = 128;

pub(super) fn is_cloudflare_zone_id(value: &str) -> bool {
    value.len() == 32
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
}

pub(super) fn is_safe_secret(value: &str, maximum_bytes: usize) -> bool {
    !value.is_empty()
        && value.len() <= maximum_bytes
        && value
            .bytes()
            .all(|byte| byte.is_ascii() && !byte.is_ascii_whitespace() && !byte.is_ascii_control())
}

pub(super) fn is_safe_certificate_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_CERTIFICATE_ID_BYTES
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

pub(super) fn is_safe_record_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 32
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

pub(super) fn dns_record_marker(certificate_id: &str) -> Result<String, CertificateError> {
    if !is_safe_certificate_id(certificate_id) {
        return Err(CertificateError::DnsProviderInvalid);
    }
    Ok(format!("{DNS_RECORD_COMMENT_PREFIX}{certificate_id}"))
}

pub(super) fn is_owned_marker(value: &str) -> bool {
    value
        .strip_prefix(DNS_RECORD_COMMENT_PREFIX)
        .is_some_and(is_safe_certificate_id)
}

pub(super) fn bare_authorization_name(value: &str) -> Option<String> {
    let value = value.strip_suffix('.').unwrap_or(value);
    let value = value.strip_prefix("_acme-challenge.").unwrap_or(value);
    let value = value.strip_prefix("*.").unwrap_or(value);
    (is_canonical_domain(value) && "_acme-challenge.".len() + value.len() <= 253)
        .then(|| value.to_owned())
}

pub(super) fn domain_is_in_zone(domain: &str, zone: &str) -> bool {
    domain == zone
        || domain
            .strip_suffix(zone)
            .is_some_and(|prefix| prefix.ends_with('.'))
}

pub(super) fn dns_names_equal(left: &str, right: &str) -> bool {
    left.trim_end_matches('.') == right.trim_end_matches('.')
}

pub(super) fn validate_sans_against_zone(
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
