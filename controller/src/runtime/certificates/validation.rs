use super::operations;
use super::recovery::candidate_is_valid;
use super::{
    AcmeChallengeType, BTreeSet, CertificateEnvironment, CertificateError, CertificateIndex,
    CertificateSource, DnsRecordIntent, ErrorKind, MAX_CERTIFICATES, OffsetDateTime, Rfc3339,
    SafeDir, is_canonical_domain, is_canonical_uuid_v7, valid_timestamp,
};

pub(super) fn environment_name(environment: CertificateEnvironment) -> &'static str {
    match environment {
        CertificateEnvironment::Staging => "staging",
        CertificateEnvironment::Production => "production",
    }
}

pub(super) fn canonical_domains(domains: &[String]) -> Vec<String> {
    let mut result = domains.to_vec();
    result.sort_unstable();
    result.dedup();
    result
}

pub(super) fn has_duplicate_domains(domains: &[String]) -> bool {
    let mut seen = BTreeSet::new();
    domains.iter().any(|domain| !seen.insert(domain.as_str()))
}

pub(super) fn dns_intent_belongs_to(intent: &DnsRecordIntent, certificate_id: &str) -> bool {
    intent.validate().is_ok() && intent.marker == format!("rentnerproxy-acme:{certificate_id}")
}

pub(super) fn certificate_covers(names: &[String], domain: &str) -> bool {
    let domain = domain.to_ascii_lowercase();
    names
        .iter()
        .any(|name| name == &domain || wildcard_covers(name, &domain))
}

pub(super) fn wildcard_covers(pattern: &str, domain: &str) -> bool {
    let Some(suffix) = pattern.strip_prefix("*.") else {
        return false;
    };
    domain.strip_suffix(suffix).is_some_and(|prefix| {
        prefix.ends_with('.') && prefix.len() > 1 && !prefix[..prefix.len() - 1].contains('.')
    })
}

pub(super) fn is_certificate_domain(value: &str) -> bool {
    if is_canonical_domain(value) {
        return value.contains('.');
    }
    value.strip_prefix("*.").is_some_and(|suffix| {
        value.len() <= 253
            && suffix.contains('.')
            && suffix.parse::<std::net::Ipv4Addr>().is_err()
            && is_canonical_domain(suffix)
    })
}

pub(super) fn is_acme_request_domain(
    value: &str,
    challenge_type: AcmeChallengeType,
    environment: CertificateEnvironment,
) -> bool {
    let (name, wildcard) = match value.strip_prefix("*.") {
        Some(suffix) => (suffix, true),
        None => (value, false),
    };
    if challenge_type == AcmeChallengeType::Dns01 && "_acme-challenge.".len() + name.len() > 253 {
        return false;
    }
    if wildcard
        && (challenge_type != AcmeChallengeType::Dns01 || value.len() > 253 || name.contains('*'))
    {
        return false;
    }
    is_public_acme_domain(
        name,
        challenge_type == AcmeChallengeType::Http01
            && environment == CertificateEnvironment::Staging
            && test_acme_directory_configured(),
    )
}

pub(super) fn is_public_acme_domain(value: &str, allow_invalid: bool) -> bool {
    if !is_canonical_domain(value) || !value.contains('.') {
        return false;
    }
    match value.rsplit('.').next() {
        Some("invalid") => allow_invalid,
        Some(
            "test" | "localhost" | "example" | "local" | "internal" | "onion" | "home" | "lan",
        ) => false,
        Some(_) => true,
        None => false,
    }
}

pub(super) fn test_acme_directory_configured() -> bool {
    std::env::var_os("RENTNERPROXY_ACME_TEST_DIRECTORY_URL").is_some()
        && std::env::var_os("RENTNERPROXY_ACME_TEST_ROOT_CERT").is_some()
}

pub(super) fn is_valid_email(value: &str) -> bool {
    value.len() <= 320
        && value == value.trim()
        && value
            .split_once('@')
            .is_some_and(|(local, domain)| !local.is_empty() && is_canonical_domain(domain))
}

pub(super) fn format_timestamp(timestamp: i64) -> Result<String, CertificateError> {
    OffsetDateTime::from_unix_timestamp(timestamp)
        .map_err(|_| CertificateError::InvalidCertificate)?
        .format(&Rfc3339)
        .map_err(|_| CertificateError::InvalidCertificate)
}

pub(super) fn utc_now() -> Result<String, CertificateError> {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .map_err(|_| CertificateError::StoreUnavailable)
}
pub(super) fn truncate(mut value: String, maximum: usize) -> String {
    if value.len() <= maximum {
        return value;
    }
    let mut end = maximum;
    while end > 0 && !value.is_char_boundary(end) {
        end -= 1;
    }
    value.truncate(end);
    value
}

pub(super) fn has_only_pem_blocks(value: &str, labels: &[&str], exactly_one: bool) -> bool {
    let mut remainder = value.trim();
    let mut count = 0;
    while !remainder.is_empty() {
        let Some(label) = labels
            .iter()
            .find(|label| remainder.starts_with(&format!("-----BEGIN {label}-----")))
        else {
            return false;
        };
        let begin = format!("-----BEGIN {label}-----");
        let end = format!("-----END {label}-----");
        let after_begin = &remainder[begin.len()..];
        let Some(end_index) = after_begin.find(&end) else {
            return false;
        };
        let body = &after_begin[..end_index];
        if body.is_empty()
            || !body.bytes().all(|byte| {
                byte.is_ascii_alphanumeric()
                    || matches!(byte, b'+' | b'/' | b'=' | b'\r' | b'\n' | b' ' | b'\t')
            })
        {
            return false;
        }
        count += 1;
        remainder = after_begin[end_index + end.len()..].trim();
    }
    count > 0 && (!exactly_one || count == 1)
}

pub(super) fn write_private_file(
    directory: &SafeDir,
    component: &str,
    bytes: &[u8],
) -> Result<(), CertificateError> {
    #[cfg(test)]
    if crate::tests::fixtures::should_fail_private_key_write(
        &directory
            .child_path(component)
            .map_err(|_| CertificateError::StoreUnavailable)?,
    ) {
        return Err(CertificateError::StoreUnavailable);
    }
    directory
        .atomic_write(component, bytes)
        .map_err(|_| CertificateError::StoreUnavailable)
}

pub(super) fn read_regular_private_file(
    directory: &SafeDir,
    component: &str,
    maximum_bytes: usize,
) -> Result<Option<Vec<u8>>, CertificateError> {
    match directory.read_file(component, maximum_bytes) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(_) => Err(CertificateError::StoreUnavailable),
    }
}
pub(super) fn index_is_valid(index: &CertificateIndex) -> bool {
    operations::journal_is_valid(index)
        && index.certificates.len() <= MAX_CERTIFICATES
        && index.pending_candidates.len() <= MAX_CERTIFICATES
        && index.pending_candidates.iter().all(|(id, candidate)| {
            index.certificates.contains_key(id) && candidate_is_valid(id, candidate)
        })
        && index
            .acme_retry_until
            .values()
            .all(|timestamp| valid_timestamp(timestamp))
        && index.certificates.iter().all(|(id, entry)| {
            is_canonical_uuid_v7(id)
                && entry.metadata.id == *id
                && (entry.metadata.source != CertificateSource::Acme || entry.acme.is_some())
                && (1..=100).contains(&entry.metadata.domains.len())
                && entry
                    .metadata
                    .domains
                    .iter()
                    .all(|domain| is_certificate_domain(domain))
                && entry
                    .metadata
                    .issuer
                    .as_ref()
                    .is_none_or(|issuer| issuer.len() <= 512)
                && entry
                    .metadata
                    .fingerprint
                    .as_ref()
                    .is_none_or(|fingerprint| {
                        fingerprint.len() == 71
                            && fingerprint.starts_with("sha256:")
                            && fingerprint[7..]
                                .bytes()
                                .all(|byte| byte.is_ascii_hexdigit())
                    })
                && entry
                    .metadata
                    .issued_at
                    .as_ref()
                    .is_none_or(|timestamp| valid_timestamp(timestamp))
                && entry
                    .metadata
                    .expires_at
                    .as_ref()
                    .is_none_or(|timestamp| valid_timestamp(timestamp))
                && valid_timestamp(&entry.metadata.updated_at)
                && entry
                    .metadata
                    .current_operation
                    .as_ref()
                    .is_none_or(operations::current_operation_is_valid)
                && entry
                    .metadata
                    .last_activated_at
                    .as_ref()
                    .is_none_or(|timestamp| valid_timestamp(timestamp))
                && entry
                    .metadata
                    .last_error_at
                    .as_ref()
                    .is_none_or(|timestamp| valid_timestamp(timestamp))
                && entry.material_id.as_ref().is_none_or(|material_id| {
                    material_id.len() == 64
                        && material_id.bytes().all(|byte| byte.is_ascii_hexdigit())
                })
                && entry
                    .next_attempt_at
                    .as_ref()
                    .is_none_or(|timestamp| valid_timestamp(timestamp))
                && entry
                    .metadata
                    .last_attempt_at
                    .as_ref()
                    .is_none_or(|timestamp| valid_timestamp(timestamp))
                && entry
                    .metadata
                    .last_success_at
                    .as_ref()
                    .is_none_or(|timestamp| valid_timestamp(timestamp))
                && entry
                    .retry_delay_seconds
                    .is_none_or(|delay| (1_800..=21_600).contains(&delay))
                && entry.acme.as_ref().is_none_or(|acme| {
                    let provider_is_valid = match acme.challenge_type {
                        AcmeChallengeType::Http01 => acme.dns_provider.is_none(),
                        AcmeChallengeType::Dns01 => {
                            acme.dns_provider.as_ref().is_some_and(|config| {
                                config.version == 1
                                    && config.nonce.len() == 12
                                    && (16..=8 * 1024).contains(&config.ciphertext.len())
                            })
                        }
                    };
                    provider_is_valid
                        && acme.pending_dns_records.len() <= 256
                        && acme
                            .pending_dns_records
                            .iter()
                            .all(|intent| dns_intent_belongs_to(intent, id))
                        && (acme.challenge_type == AcmeChallengeType::Dns01
                            || acme.pending_dns_records.is_empty())
                })
        })
}
