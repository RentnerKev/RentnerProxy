use rustls::pki_types::{CertificateDer, pem::PemObject};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use x509_parser::parse_x509_certificate;

use crate::models::TrustedCa;

pub(crate) const MAX_TRUSTED_CA_PEM_BYTES: usize = 256 * 1024;
const MAX_TRUSTED_CA_CERTIFICATES: usize = 100;
const MAX_TRUSTED_CA_METADATA_BYTES: usize = 512;

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct TrustedCaValidationRequest {
    pub(crate) pem: String,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum TrustedCaValidationError {
    InvalidTrustedCa,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ValidatedTrustedCa {
    pub(crate) pem: String,
    pub(crate) fingerprint_sha256: String,
    pub(crate) subject: String,
    pub(crate) issuer: String,
    pub(crate) not_before: String,
    pub(crate) not_after: String,
}

pub(crate) fn validate_trusted_ca(
    trusted_ca: &TrustedCa,
) -> Result<ValidatedTrustedCa, TrustedCaValidationError> {
    let validated = validate_trusted_ca_pem(&trusted_ca.pem)?;
    (trusted_ca.fingerprint_sha256 == validated.fingerprint_sha256)
        .then_some(validated)
        .ok_or(TrustedCaValidationError::InvalidTrustedCa)
}

pub(crate) fn validate_trusted_ca_pem(
    pem: &str,
) -> Result<ValidatedTrustedCa, TrustedCaValidationError> {
    if pem.len() > MAX_TRUSTED_CA_PEM_BYTES || !has_only_certificate_pem_blocks(pem) {
        return Err(TrustedCaValidationError::InvalidTrustedCa);
    }

    let certificates: Vec<CertificateDer<'static>> = CertificateDer::pem_slice_iter(pem.as_bytes())
        .collect::<Result<_, _>>()
        .map_err(|_| TrustedCaValidationError::InvalidTrustedCa)?;
    if certificates.is_empty() || certificates.len() > MAX_TRUSTED_CA_CERTIFICATES {
        return Err(TrustedCaValidationError::InvalidTrustedCa);
    }

    let now = OffsetDateTime::now_utc().unix_timestamp();
    let mut first_metadata = None;
    let mut bundle_not_before = i64::MIN;
    let mut bundle_not_after = i64::MAX;
    for der in &certificates {
        let (remainder, certificate) = parse_x509_certificate(der.as_ref())
            .map_err(|_| TrustedCaValidationError::InvalidTrustedCa)?;
        if !remainder.is_empty() {
            return Err(TrustedCaValidationError::InvalidTrustedCa);
        }
        let basic_constraints = certificate
            .basic_constraints()
            .map_err(|_| TrustedCaValidationError::InvalidTrustedCa)?
            .ok_or(TrustedCaValidationError::InvalidTrustedCa)?;
        if !basic_constraints.value.ca {
            return Err(TrustedCaValidationError::InvalidTrustedCa);
        }
        if certificate
            .key_usage()
            .map_err(|_| TrustedCaValidationError::InvalidTrustedCa)?
            .is_some_and(|usage| !usage.value.key_cert_sign())
        {
            return Err(TrustedCaValidationError::InvalidTrustedCa);
        }

        let not_before = certificate.validity().not_before.timestamp();
        let not_after = certificate.validity().not_after.timestamp();
        if not_before > now || not_after <= now {
            return Err(TrustedCaValidationError::InvalidTrustedCa);
        }
        bundle_not_before = bundle_not_before.max(not_before);
        bundle_not_after = bundle_not_after.min(not_after);
        if first_metadata.is_none() {
            first_metadata = Some((
                truncate(certificate.subject().to_string()),
                truncate(certificate.issuer().to_string()),
            ));
        }
    }

    let (subject, issuer) = first_metadata.ok_or(TrustedCaValidationError::InvalidTrustedCa)?;
    let canonical_pem = canonical_pem(&certificates);
    if canonical_pem.len() > MAX_TRUSTED_CA_PEM_BYTES {
        return Err(TrustedCaValidationError::InvalidTrustedCa);
    }
    let not_before = format_timestamp(bundle_not_before)?;
    let not_after = format_timestamp(bundle_not_after)?;
    Ok(ValidatedTrustedCa {
        pem: canonical_pem,
        fingerprint_sha256: bundle_fingerprint(&certificates),
        subject,
        issuer,
        not_before,
        not_after,
    })
}

fn bundle_fingerprint(certificates: &[CertificateDer<'_>]) -> String {
    let mut digest = Sha256::new();
    for certificate in certificates {
        digest.update((certificate.as_ref().len() as u64).to_be_bytes());
        digest.update(certificate.as_ref());
    }
    format!("sha256:{}", digest.finalize().as_ref().iter().map(|byte| format!("{byte:02x}")).collect::<String>())
}

fn canonical_pem(certificates: &[CertificateDer<'_>]) -> String {
    let mut pem = String::new();
    for certificate in certificates {
        pem.push_str("-----BEGIN CERTIFICATE-----\n");
        let encoded = base64_encode(certificate.as_ref());
        for line in encoded.as_bytes().chunks(64) {
            pem.push_str(std::str::from_utf8(line).expect("base64 is ASCII"));
            pem.push('\n');
        }
        pem.push_str("-----END CERTIFICATE-----\n");
    }
    pem
}

fn base64_encode(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut output = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let first = chunk[0];
        let second = *chunk.get(1).unwrap_or(&0);
        let third = *chunk.get(2).unwrap_or(&0);
        output.push(char::from(TABLE[usize::from(first >> 2)]));
        output.push(char::from(
            TABLE[usize::from(((first & 0b0000_0011) << 4) | (second >> 4))],
        ));
        output.push(if chunk.len() > 1 {
            char::from(TABLE[usize::from(((second & 0b0000_1111) << 2) | (third >> 6))])
        } else {
            '='
        });
        output.push(if chunk.len() > 2 {
            char::from(TABLE[usize::from(third & 0b0011_1111)])
        } else {
            '='
        });
    }
    output
}

fn has_only_certificate_pem_blocks(value: &str) -> bool {
    let mut remainder = value.trim();
    let mut count = 0;
    const BEGIN: &str = "-----BEGIN CERTIFICATE-----";
    const END: &str = "-----END CERTIFICATE-----";
    while !remainder.is_empty() {
        let Some(after_begin) = remainder.strip_prefix(BEGIN) else {
            return false;
        };
        let Some(end_index) = after_begin.find(END) else {
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
        remainder = after_begin[end_index + END.len()..].trim();
    }
    count > 0
}

fn format_timestamp(timestamp: i64) -> Result<String, TrustedCaValidationError> {
    OffsetDateTime::from_unix_timestamp(timestamp)
        .map_err(|_| TrustedCaValidationError::InvalidTrustedCa)?
        .format(&Rfc3339)
        .map_err(|_| TrustedCaValidationError::InvalidTrustedCa)
}

fn truncate(mut value: String) -> String {
    if value.len() <= MAX_TRUSTED_CA_METADATA_BYTES {
        return value;
    }
    let mut end = MAX_TRUSTED_CA_METADATA_BYTES;
    while end > 0 && !value.is_char_boundary(end) {
        end -= 1;
    }
    value.truncate(end);
    value
}
