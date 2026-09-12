use serde::{Deserialize, Serialize};
use serde_json::Value;
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

mod cache;
mod reader;

pub(crate) use cache::SnapshotCache;
#[cfg(test)]
pub(super) use reader::read_blocking;
pub(crate) use reader::{ReadError, read};

pub(crate) const MAX_LOG_BYTES: usize = 4 * 1024 * 1024;
pub(crate) const MAX_LOG_FILES: usize = 5;
pub(crate) const MAX_RECORDS: usize = 10_000;
pub(crate) const MAX_SNAPSHOTS: usize = 8;
pub(crate) const MAX_SNAPSHOT_BYTES: usize = 16 * 1024 * 1024;
pub(crate) const MAX_SINGLE_SNAPSHOT_BYTES: usize = MAX_LOG_BYTES;
const MAX_SNAPSHOT_ID: usize = 64;
const MAX_PATH: usize = 2048;
const MAX_HOST: usize = 253;
const MAX_METHOD: usize = 32;
const MAX_PROTOCOL: usize = 32;
const MAX_UPSTREAM: usize = 512;
const MAX_CLIENT_IP: usize = 64;

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct AccessLogQuery {
    pub snapshot: Option<String>,
    pub host: Option<String>,
    pub status: Option<String>,
    pub search: Option<String>,
    pub limit: Option<String>,
    pub offset: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum AccessLogQueryError {
    Invalid,
    MalformedSnapshot,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ValidatedAccessLogQuery {
    pub snapshot: Option<String>,
    pub host: Option<String>,
    pub status: Option<u16>,
    pub search: Option<String>,
    pub limit: usize,
    pub offset: usize,
}

impl AccessLogQuery {
    pub(crate) fn validate(self) -> Result<ValidatedAccessLogQuery, AccessLogQueryError> {
        let snapshot = self
            .snapshot
            .map(|snapshot| {
                if !(16..=MAX_SNAPSHOT_ID).contains(&snapshot.len())
                    || !snapshot
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
                {
                    Err(AccessLogQueryError::MalformedSnapshot)
                } else {
                    Ok(snapshot)
                }
            })
            .transpose()?;
        let host = self
            .host
            .map(|host| {
                if host.len() > MAX_HOST || !crate::proxy::is_canonical_domain(&host) {
                    Err(AccessLogQueryError::Invalid)
                } else {
                    Ok(host)
                }
            })
            .transpose()?;
        let status = self
            .status
            .map(|value| {
                value
                    .parse::<u16>()
                    .map_err(|_| AccessLogQueryError::Invalid)
            })
            .transpose()?;
        if status.is_some_and(|value| !(100..=599).contains(&value)) {
            return Err(AccessLogQueryError::Invalid);
        }
        let search = self
            .search
            .map(|value| {
                if value.len() > 128 || value.chars().any(char::is_control) {
                    Err(AccessLogQueryError::Invalid)
                } else {
                    Ok(value)
                }
            })
            .transpose()?;
        let limit = self
            .limit
            .map(|value| {
                value
                    .parse::<usize>()
                    .map_err(|_| AccessLogQueryError::Invalid)
            })
            .transpose()?
            .unwrap_or(15);
        if !(1..=200).contains(&limit) {
            return Err(AccessLogQueryError::Invalid);
        }
        let offset = self
            .offset
            .map(|value| {
                value
                    .parse::<usize>()
                    .map_err(|_| AccessLogQueryError::Invalid)
            })
            .transpose()?
            .unwrap_or(0);
        if offset > 10_000 {
            return Err(AccessLogQueryError::Invalid);
        }
        Ok(ValidatedAccessLogQuery {
            snapshot,
            host,
            status,
            search,
            limit,
            offset,
        })
    }
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub(crate) struct AccessLogResponse {
    pub entries: Vec<AccessLogEntry>,
    pub limit: usize,
    pub offset: usize,
    pub total: usize,
    #[serde(rename = "hasMore")]
    pub has_more: bool,
    pub truncated: bool,
    pub snapshot: String,
    #[serde(rename = "snapshotExpiresAt")]
    pub snapshot_expires_at: String,
    #[serde(rename = "snapshotReset")]
    pub snapshot_reset: bool,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub(crate) struct AccessLogEntry {
    pub timestamp: String,
    pub host: String,
    pub method: String,
    pub path: String,
    pub status: u16,
    #[serde(rename = "durationMs")]
    pub duration_ms: u64,
    #[serde(rename = "clientIp")]
    pub client_ip: String,
    pub upstream: Option<String>,
    pub bytes: u64,
    pub protocol: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct SnapshotQuery {
    host: Option<String>,
    status: Option<u16>,
    search: Option<String>,
    limit: usize,
}

impl SnapshotQuery {
    fn from_query(query: &ValidatedAccessLogQuery) -> Self {
        Self {
            host: query.host.clone(),
            status: query.status,
            search: query.search.clone(),
            limit: query.limit,
        }
    }

    fn matches(&self, query: &ValidatedAccessLogQuery) -> bool {
        self.host == query.host
            && self.status == query.status
            && self.search == query.search
            && self.limit == query.limit
    }
}

fn parse_entry(value: &Value, cutoff: OffsetDateTime) -> Option<AccessLogEntry> {
    let ts = value.get("ts")?.as_f64()?;
    if !ts.is_finite() || ts < 0.0 {
        return None;
    }
    let timestamp =
        OffsetDateTime::from_unix_timestamp_nanos((ts * 1_000_000_000.0) as i128).ok()?;
    if timestamp < cutoff {
        return None;
    }
    let request = value.get("request")?.as_object()?;
    let host = bounded(&strip_host_port(request.get("host")?.as_str()?), MAX_HOST);
    let method = bounded(request.get("method")?.as_str()?, MAX_METHOD);
    let uri = request.get("uri")?.as_str()?;
    let path = bounded(uri.split_once('?').map_or(uri, |(path, _)| path), MAX_PATH);
    let protocol = bounded(request.get("proto")?.as_str()?, MAX_PROTOCOL);
    let client_ip = bounded(
        request
            .get("remote_ip")
            .or_else(|| request.get("remote_addr"))?
            .as_str()?,
        MAX_CLIENT_IP,
    );
    if [&host, &method, &path, &protocol, &client_ip]
        .iter()
        .any(|field| field.is_empty())
    {
        return None;
    }
    let status = value.get("status")?.as_u64()?.try_into().ok()?;
    if !(100..=599).contains(&status) {
        return None;
    }
    let duration = value.get("duration")?.as_f64()?;
    if !duration.is_finite() || duration < 0.0 {
        return None;
    }
    const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
    let milliseconds = (duration * 1000.0).round();
    if !milliseconds.is_finite() || milliseconds > MAX_SAFE_INTEGER as f64 {
        return None;
    }
    let duration_ms = milliseconds as u64;
    let bytes = value.get("size")?.as_u64()?;
    if bytes > MAX_SAFE_INTEGER {
        return None;
    }
    let upstream = value
        .get("upstream")
        .and_then(Value::as_str)
        .map(|value| {
            bounded(
                value.split_once('?').map_or(value, |(address, _)| address),
                MAX_UPSTREAM,
            )
        })
        .filter(|value| !value.is_empty());
    Some(AccessLogEntry {
        timestamp: timestamp.format(&Rfc3339).ok()?,
        host,
        method,
        path,
        status,
        duration_ms,
        client_ip,
        upstream,
        bytes,
        protocol,
    })
}

fn matches_query(entry: &AccessLogEntry, query: &ValidatedAccessLogQuery) -> bool {
    query
        .host
        .as_ref()
        .is_none_or(|host| entry.host.eq_ignore_ascii_case(host))
        && query.status.is_none_or(|status| entry.status == status)
        && query.search.as_ref().is_none_or(|search| {
            [
                entry.host.as_str(),
                entry.method.as_str(),
                entry.path.as_str(),
                entry.client_ip.as_str(),
                entry.protocol.as_str(),
                entry.upstream.as_deref().unwrap_or(""),
            ]
            .into_iter()
            .any(|field| field.contains(search))
        })
}

fn bounded(value: &str, maximum: usize) -> String {
    let mut result = String::with_capacity(value.len().min(maximum));
    for character in value.chars().filter(|character| !character.is_control()) {
        if result.len() + character.len_utf8() > maximum {
            break;
        }
        result.push(character);
    }
    result
}

fn strip_host_port(value: &str) -> String {
    if let Some((host, _)) = value.strip_prefix('[').and_then(|v| v.split_once(']')) {
        return host.to_ascii_lowercase();
    }
    if value.matches(':').count() == 1 {
        return value.split_once(':').map_or_else(
            || value.to_ascii_lowercase(),
            |(host, _)| host.to_ascii_lowercase(),
        );
    }
    value.to_ascii_lowercase()
}

#[cfg(test)]
mod tests;
