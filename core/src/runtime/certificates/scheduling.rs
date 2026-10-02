use super::{
    CertificateEnvironment, CertificateIndex, CertificateSource, MAX_ACME_RETRY_DELAY_SECONDS,
    MAX_CANDIDATE_RETRY_DELAY_SECONDS, MIN_ACME_RETRY_DELAY_SECONDS,
    MIN_CANDIDATE_RETRY_DELAY_SECONDS, OffsetDateTime, Rfc3339, StoredCertificate,
};

pub(super) fn retry_deadline(delay_seconds: u32) -> Option<OffsetDateTime> {
    OffsetDateTime::now_utc().checked_add(time::Duration::seconds(i64::from(delay_seconds)))
}

pub(super) fn max_retry_deadline(
    existing: Option<&str>,
    candidate: OffsetDateTime,
) -> Option<String> {
    let candidate = candidate.format(&Rfc3339).ok()?;
    max_retry_deadline_string(existing, &candidate).or(Some(candidate))
}

pub(super) fn max_retry_deadline_string(existing: Option<&str>, candidate: &str) -> Option<String> {
    match existing {
        Some(existing)
            if OffsetDateTime::parse(existing, &Rfc3339)
                .ok()
                .zip(OffsetDateTime::parse(candidate, &Rfc3339).ok())
                .is_some_and(|(existing, candidate)| existing >= candidate) =>
        {
            Some(existing.to_owned())
        }
        _ => Some(candidate.to_owned()),
    }
}

pub(super) fn retry_is_blocking(entry: &StoredCertificate, now: OffsetDateTime) -> bool {
    entry
        .next_attempt_at
        .as_deref()
        .and_then(|deadline| OffsetDateTime::parse(deadline, &Rfc3339).ok())
        .is_some_and(|deadline| deadline > now)
}

pub(super) fn account_retry_is_blocking(
    index: &CertificateIndex,
    environment: CertificateEnvironment,
    now: OffsetDateTime,
) -> bool {
    index
        .acme_retry_until
        .get(&environment)
        .and_then(|deadline| OffsetDateTime::parse(deadline, &Rfc3339).ok())
        .is_some_and(|deadline| deadline > now)
}

pub(super) fn next_retry_delay(id: &str, attempt_count: u32, previous: Option<u32>) -> u32 {
    let exponent = attempt_count.saturating_sub(1).min(4);
    let base = u64::from(MIN_ACME_RETRY_DELAY_SECONDS)
        .saturating_mul(1_u64 << exponent)
        .min(u64::from(MAX_ACME_RETRY_DELAY_SECONDS));
    let previous = previous
        .unwrap_or(base as u32)
        .clamp(MIN_ACME_RETRY_DELAY_SECONDS, MAX_ACME_RETRY_DELAY_SECONDS);
    let base = base.max(u64::from(previous));
    let jitter_max = (base / 4).min(u64::from(MAX_ACME_RETRY_DELAY_SECONDS).saturating_sub(base));
    let entropy = OffsetDateTime::now_utc()
        .unix_timestamp_nanos()
        .unsigned_abs() as u64
        ^ id.bytes().fold(0_u64, |hash, byte| {
            hash.wrapping_mul(16777619).wrapping_add(u64::from(byte))
        });
    base.saturating_add(if jitter_max == 0 {
        0
    } else {
        entropy % (jitter_max + 1)
    })
    .min(u64::from(MAX_ACME_RETRY_DELAY_SECONDS)) as u32
}

pub(super) fn next_candidate_retry_delay(
    id: &str,
    attempt_count: u32,
    previous: Option<u32>,
) -> u32 {
    let exponent = attempt_count.saturating_sub(1).min(3);
    let base = u64::from(MIN_CANDIDATE_RETRY_DELAY_SECONDS)
        .saturating_mul(1_u64 << exponent)
        .min(u64::from(MAX_CANDIDATE_RETRY_DELAY_SECONDS));
    let previous = previous.unwrap_or(base as u32).clamp(
        MIN_CANDIDATE_RETRY_DELAY_SECONDS,
        MAX_CANDIDATE_RETRY_DELAY_SECONDS,
    );
    let base = base.max(u64::from(previous));
    let jitter_max =
        (base / 4).min(u64::from(MAX_CANDIDATE_RETRY_DELAY_SECONDS).saturating_sub(base));
    let entropy = OffsetDateTime::now_utc()
        .unix_timestamp_nanos()
        .unsigned_abs() as u64
        ^ id.bytes().fold(0_u64, |hash, byte| {
            hash.wrapping_mul(16777619).wrapping_add(u64::from(byte))
        });
    base.saturating_add(if jitter_max == 0 {
        0
    } else {
        entropy % (jitter_max + 1)
    })
    .min(u64::from(MAX_CANDIDATE_RETRY_DELAY_SECONDS)) as u32
}

pub(super) fn candidate_retry_deadline(delay_seconds: u32) -> Option<String> {
    OffsetDateTime::now_utc()
        .checked_add(time::Duration::seconds(i64::from(delay_seconds)))
        .and_then(|deadline| deadline.format(&Rfc3339).ok())
}

pub(super) fn next_renewal_at(stored: &StoredCertificate) -> Option<String> {
    if stored.metadata.source != CertificateSource::Acme {
        return None;
    }
    let issued = stored
        .metadata
        .issued_at
        .as_deref()
        .and_then(|value| OffsetDateTime::parse(value, &Rfc3339).ok())?;
    let expires = stored
        .metadata
        .expires_at
        .as_deref()
        .and_then(|value| OffsetDateTime::parse(value, &Rfc3339).ok())?;
    let due = renewal_timestamp(issued, expires)?;
    due.format(&Rfc3339).ok()
}

pub(crate) fn renewal_timestamp(
    issued: OffsetDateTime,
    expires: OffsetDateTime,
) -> Option<OffsetDateTime> {
    let lifetime = expires - issued;
    if lifetime <= time::Duration::ZERO {
        return None;
    }
    let elapsed =
        time::Duration::nanoseconds_i128(lifetime.whole_nanoseconds().saturating_mul(2) / 3);
    issued.checked_add(elapsed)
}

pub(super) fn valid_timestamp(value: &str) -> bool {
    value.len() <= 40 && OffsetDateTime::parse(value, &Rfc3339).is_ok()
}

pub(super) fn valid_fingerprint(value: &str) -> bool {
    value.len() == 71
        && value.starts_with("sha256:")
        && value[7..].bytes().all(|byte| byte.is_ascii_hexdigit())
}
