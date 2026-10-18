use std::time::{Duration, SystemTime, UNIX_EPOCH};

use time::{OffsetDateTime, format_description::well_known::Rfc3339};

pub(super) fn elapsed_millis(started_at: SystemTime) -> u128 {
    started_at
        .elapsed()
        .map_or(0, |duration| duration.as_millis())
}

pub(crate) fn utc_now() -> String {
    format_utc_time(SystemTime::now())
}

fn format_utc_time(value: SystemTime) -> String {
    let duration = value.duration_since(UNIX_EPOCH).unwrap_or(Duration::ZERO);
    let timestamp = i64::try_from(duration.as_secs())
        .ok()
        .and_then(|seconds| OffsetDateTime::from_unix_timestamp(seconds).ok())
        .unwrap_or(OffsetDateTime::UNIX_EPOCH);
    timestamp
        .format(&Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_owned())
}

#[cfg(test)]
#[path = "../../tests/private/clock.rs"]
mod tests;
