use std::{
    cmp::Reverse,
    fs::{self, File},
    io::{ErrorKind, Read, Seek, SeekFrom},
    path::Path,
    sync::{Arc, OnceLock},
};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use time::{Duration, OffsetDateTime, format_description::well_known::Rfc3339};
use tokio::sync::Semaphore;

use super::state::state_dir;

pub(crate) const MAX_LOG_BYTES: usize = 4 * 1024 * 1024;
pub(crate) const MAX_LOG_FILES: usize = 5;
pub(crate) const MAX_RECORDS: usize = 10_000;
static READ_SLOTS: OnceLock<Arc<Semaphore>> = OnceLock::new();
const MAX_PATH: usize = 2048;
const MAX_HOST: usize = 253;
const MAX_METHOD: usize = 32;
const MAX_PROTOCOL: usize = 32;
const MAX_UPSTREAM: usize = 512;
const MAX_CLIENT_IP: usize = 64;

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct AccessLogQuery {
    pub host: Option<String>,
    pub status: Option<String>,
    pub search: Option<String>,
    pub limit: Option<String>,
    pub offset: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ValidatedAccessLogQuery {
    pub host: Option<String>,
    pub status: Option<u16>,
    pub search: Option<String>,
    pub limit: usize,
    pub offset: usize,
}

impl AccessLogQuery {
    pub(crate) fn validate(self) -> Result<ValidatedAccessLogQuery, ()> {
        let host = self
            .host
            .map(|host| {
                if host.len() > MAX_HOST || !crate::proxy::is_canonical_domain(&host) {
                    Err(())
                } else {
                    Ok(host)
                }
            })
            .transpose()?;
        let status = self
            .status
            .map(|v| v.parse::<u16>().map_err(|_| ()))
            .transpose()?;
        if status.is_some_and(|v| !(100..=599).contains(&v)) {
            return Err(());
        }
        let search = self
            .search
            .map(|v| {
                if v.len() > 128 || v.chars().any(char::is_control) {
                    Err(())
                } else {
                    Ok(v)
                }
            })
            .transpose()?;
        let limit = self
            .limit
            .map(|v| v.parse::<usize>().map_err(|_| ()))
            .transpose()?
            .unwrap_or(100);
        if !(1..=200).contains(&limit) {
            return Err(());
        }
        let offset = self
            .offset
            .map(|v| v.parse::<usize>().map_err(|_| ()))
            .transpose()?
            .unwrap_or(0);
        if offset > 10_000 {
            return Err(());
        }
        Ok(ValidatedAccessLogQuery {
            host,
            status,
            search,
            limit,
            offset,
        })
    }
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub(crate) struct AccessLogResponse {
    pub entries: Vec<AccessLogEntry>,
    pub limit: usize,
    pub offset: usize,
    pub total: usize,
    #[serde(rename = "hasMore")]
    pub has_more: bool,
    pub truncated: bool,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
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

pub(crate) async fn read(
    state_root: &Path,
    query: ValidatedAccessLogQuery,
) -> Result<AccessLogResponse, ReadError> {
    let slots = READ_SLOTS
        .get_or_init(|| Arc::new(Semaphore::new(4)))
        .clone();
    let permit = slots.try_acquire_owned().map_err(|_| ReadError::Busy)?;
    let root = state_root.to_owned();
    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        read_blocking(&root, &query)
    })
    .await
    .map_err(|_| ReadError::Failed)?
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ReadError {
    Busy,
    Failed,
}

fn empty_response(query: &ValidatedAccessLogQuery) -> AccessLogResponse {
    AccessLogResponse {
        entries: Vec::new(),
        limit: query.limit,
        offset: query.offset,
        total: 0,
        has_more: false,
        truncated: false,
    }
}

fn read_blocking(
    root: &Path,
    query: &ValidatedAccessLogQuery,
) -> Result<AccessLogResponse, ReadError> {
    let root = match state_dir(root) {
        Ok(root) => root,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(empty_response(query)),
        Err(_) => return Err(ReadError::Failed),
    };
    let logs = match root.open_dir("logs") {
        Ok(logs) => logs,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(empty_response(query)),
        Err(_) => return Err(ReadError::Failed),
    };
    // Always consider the active file, even if a directory inventory is clipped.
    let mut files = vec![(Reverse(None), "access.log".to_owned())];
    let entries = fs::read_dir(logs.path()).map_err(|_| ReadError::Failed)?;
    let mut inventory_truncated = false;
    for (index, entry) in entries.enumerate() {
        if index >= 128 {
            inventory_truncated = true;
            break;
        }
        let entry = entry.map_err(|_| ReadError::Failed)?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if !(name.starts_with("access-") && name.ends_with(".log")) {
            continue;
        }
        let modified = match entry.metadata().and_then(|m| m.modified()) {
            Ok(modified) => Some(modified),
            Err(error) if error.kind() == ErrorKind::NotFound => continue,
            Err(_) => return Err(ReadError::Failed),
        };
        files.push((Reverse(modified), name));
    }
    files.sort_by(|a, b| match (a.1 == "access.log", b.1 == "access.log") {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.cmp(b),
    });
    let file_limit_truncated = files.len() > MAX_LOG_FILES;
    files.truncate(MAX_LOG_FILES);

    let cutoff = OffsetDateTime::now_utc() - Duration::days(7);
    let mut remaining = MAX_LOG_BYTES;
    let mut scanned = 0usize;
    let mut truncated = inventory_truncated || file_limit_truncated;
    let mut matches = Vec::new();
    for (_, name) in files {
        if remaining == 0 || scanned >= MAX_RECORDS {
            truncated = true;
            break;
        }
        let mut file = match logs.open_file(&name) {
            Ok(file) => file,
            Err(error) if error.kind() == ErrorKind::NotFound => {
                match fs::symlink_metadata(logs.path().join(&name)) {
                    Err(error) if error.kind() == ErrorKind::NotFound => continue,
                    _ => return Err(ReadError::Failed),
                }
            }
            Err(_) => return Err(ReadError::Failed),
        };
        let (bytes, data, partial_tail) =
            read_tail(&mut file, remaining).map_err(|_| ReadError::Failed)?;
        truncated |= partial_tail;
        remaining = remaining.saturating_sub(bytes);
        for line in data.rsplit(|b| *b == b'\n').filter(|line| !line.is_empty()) {
            if scanned >= MAX_RECORDS {
                truncated = true;
                break;
            }
            scanned += 1;
            let Ok(value) = serde_json::from_slice::<Value>(line) else {
                continue;
            };
            let Some(entry) = parse_entry(&value, cutoff) else {
                continue;
            };
            if matches_query(&entry, query) {
                matches.push(entry);
            }
        }
    }
    matches.sort_by_cached_key(|entry| {
        Reverse(
            OffsetDateTime::parse(&entry.timestamp, &Rfc3339)
                .expect("parsed log timestamps always have a valid RFC3339 representation")
                .unix_timestamp_nanos(),
        )
    });
    let total = matches.len();
    let entries = matches
        .into_iter()
        .skip(query.offset)
        .take(query.limit)
        .collect::<Vec<_>>();
    let has_more = query.offset.saturating_add(entries.len()) < total;
    Ok(AccessLogResponse {
        entries,
        limit: query.limit,
        offset: query.offset,
        total,
        has_more,
        truncated,
    })
}

fn read_tail(file: &mut File, maximum: usize) -> std::io::Result<(usize, Vec<u8>, bool)> {
    let len = file.metadata()?.len();
    let take = len.min(maximum as u64) as usize;
    if take == 0 {
        return Ok((0, Vec::new(), false));
    }
    let start = len - take as u64;
    // Anchor to the captured length, so concurrent appends do not shift this window.
    file.seek(SeekFrom::Start(start))?;
    let mut buf = vec![0; take];
    file.read_exact(&mut buf)?;
    let partial = start > 0 || !buf.ends_with(b"\n");
    if start > 0 {
        if let Some(end) = buf.iter().position(|byte| *byte == b'\n') {
            buf.drain(..=end);
        } else {
            buf.clear();
        }
    }
    if !buf.ends_with(b"\n") {
        let complete_end = buf
            .iter()
            .rposition(|byte| *byte == b'\n')
            .map_or(0, |end| end + 1);
        buf.truncate(complete_end);
    }
    Ok((take, buf, partial))
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
        .map(|s| {
            bounded(
                s.split_once('?').map_or(s, |(address, _)| address),
                MAX_UPSTREAM,
            )
        })
        .filter(|s| !s.is_empty());
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
