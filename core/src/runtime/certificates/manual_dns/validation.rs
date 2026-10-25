use super::super::{
    AcmeChallengeType, DnsValidationMode, MAX_PRIVATE_KEY_PEM_BYTES, StoredCertificate,
};
use super::{ManualDnsOrder, ManualDnsPhase};
use crate::proxy::{is_canonical_domain, is_canonical_uuid_v7};
use rcgen::PublicKeyData;
use std::collections::BTreeSet;
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use x509_parser::prelude::FromDer;

pub(in crate::runtime::certificates) fn manual_order_is_valid(
    entry: &StoredCertificate,
    order: &ManualDnsOrder,
) -> bool {
    let Some(acme) = &entry.acme else {
        return false;
    };
    let Some(operation) = &entry.metadata.current_operation else {
        return false;
    };
    let Some(expires) = timestamp(&order.expires_at) else {
        return false;
    };
    let Ok(url) = order.order_url.parse::<reqwest::Url>() else {
        return false;
    };
    if acme.dns_mode != DnsValidationMode::Manual
        || acme.challenge_type != AcmeChallengeType::Dns01
        || acme.dns_provider.is_some()
        || !acme.pending_dns_records.is_empty()
        || order.version != 1
        || operation.id != order.operation_id
        || !is_canonical_uuid_v7(&order.operation_id)
        || !is_canonical_uuid_v7(&order.challenge_set_id)
        || order.account_identity.len() != 64
        || !order
            .account_identity
            .bytes()
            .all(|b| b.is_ascii_digit() || matches!(b, b'a'..=b'f'))
        || order.order_url.len() > 2048
        || url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || order.records.len() > 100
        || (order.phase == ManualDnsPhase::AwaitingInput && order.records.is_empty())
        || order
            .last_checked_at
            .as_deref()
            .is_some_and(|value| timestamp(value).is_none())
        || order.last_error_code.as_deref().is_some_and(|value| {
            !matches!(
                value,
                "manual_dns_not_propagated"
                    | "manual_dns_lookup_failed"
                    | "manual_dns_expired"
                    | "manual_dns_cancelled"
                    | "manual_dns_order_invalid"
                    | "acme_failed"
                    | "certificate_store_unavailable"
                    | "runtime_apply_failed"
            )
        })
    {
        return false;
    }
    let mut identifiers = BTreeSet::new();
    for record in &order.records {
        let bare = record
            .identifier
            .strip_prefix("*.")
            .unwrap_or(&record.identifier);
        if !entry.metadata.domains.contains(&record.identifier)
            || !is_canonical_domain(bare)
            || record.owner != format!("_acme-challenge.{bare}")
            || record.owner.len() > 253
            || record.value.len() != 43
            || !record
                .value
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-'))
            || !identifiers.insert(&record.identifier)
            || timestamp(&record.expires_at).is_none_or(|deadline| deadline < expires)
        {
            return false;
        }
    }
    match (&order.private_key_pem, &order.csr_der) {
        (None, None) => true,
        (Some(key), Some(csr)) => {
            if key.len() > MAX_PRIVATE_KEY_PEM_BYTES
                || csr.len() > MAX_PRIVATE_KEY_PEM_BYTES
                || key.is_empty()
                || csr.is_empty()
                || order.phase.is_terminal()
            {
                return false;
            }
            let Ok(key) = rcgen::KeyPair::from_pem(key) else {
                return false;
            };
            let Ok((rest, csr)) =
                x509_parser::certification_request::X509CertificationRequest::from_der(csr)
            else {
                return false;
            };
            rest.is_empty()
                && key.subject_public_key_info() == csr.certification_request_info.subject_pki.raw
                && csr_names_match(&csr, &entry.metadata.domains)
        }
        _ => false,
    }
}

fn csr_names_match(
    csr: &x509_parser::certification_request::X509CertificationRequest<'_>,
    expected: &[String],
) -> bool {
    let mut names = BTreeSet::new();
    let mut found = false;
    for extension in csr.requested_extensions().into_iter().flatten() {
        if let x509_parser::extensions::ParsedExtension::SubjectAlternativeName(san) = extension {
            if found {
                return false;
            }
            found = true;
            for name in &san.general_names {
                let x509_parser::extensions::GeneralName::DNSName(name) = name else {
                    return false;
                };
                if !expected.iter().any(|expected| expected == name) || !names.insert(*name) {
                    return false;
                }
            }
        }
    }
    found && names.len() == expected.len()
}

fn timestamp(value: &str) -> Option<OffsetDateTime> {
    (value.len() <= 40)
        .then(|| OffsetDateTime::parse(value, &Rfc3339).ok())
        .flatten()
}
