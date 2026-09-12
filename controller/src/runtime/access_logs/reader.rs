use std::{
    cmp::{Ordering, Reverse},
    fs::{self, File},
    io::{ErrorKind, Read, Seek, SeekFrom},
    path::Path,
    sync::{Arc, OnceLock},
    time::Instant,
};

use time::{Duration, OffsetDateTime, format_description::well_known::Rfc3339};
use tokio::sync::Semaphore;

use super::super::state::state_dir;
use super::cache::cap_snapshot_entries;
use super::{
    AccessLogEntry, AccessLogResponse, MAX_LOG_BYTES, MAX_LOG_FILES, MAX_RECORDS, SnapshotCache,
    ValidatedAccessLogQuery, matches_query, parse_entry,
};

static READ_SLOTS: OnceLock<Arc<Semaphore>> = OnceLock::new();

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ReadError {
    Busy,
    Failed,
}

pub(crate) struct CapturedLogs {
    pub(crate) entries: Vec<AccessLogEntry>,
    pub(crate) truncated: bool,
}

struct IndexedEntry {
    timestamp_nanos: i128,
    entry: AccessLogEntry,
    file_identity: String,
    line_offset: usize,
}

pub(crate) async fn read(
    state_root: &Path,
    query: ValidatedAccessLogQuery,
    snapshots: &SnapshotCache,
) -> Result<AccessLogResponse, ReadError> {
    let now = Instant::now();
    if let Some(snapshot_id) = query.snapshot.as_deref()
        && let Some(response) = snapshots.lookup(snapshot_id, &query, now)?
    {
        return Ok(response);
    }
    let reset = query.snapshot.is_some();
    let mut capture_query = query.clone();
    capture_query.snapshot = None;
    capture_query.offset = 0;
    let mut page_query = capture_query.clone();
    if !reset {
        page_query.offset = query.offset;
    }
    let slots = READ_SLOTS
        .get_or_init(|| Arc::new(Semaphore::new(4)))
        .clone();
    let permit = slots.try_acquire_owned().map_err(|_| ReadError::Busy)?;
    let root = state_root.to_owned();
    let blocking_query = capture_query.clone();
    let capture = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        read_snapshot_blocking(&root, &blocking_query)
    })
    .await
    .map_err(|_| ReadError::Failed)??;
    snapshots.insert(&capture_query, &page_query, capture, reset, Instant::now())
}

#[cfg(test)]
pub(crate) fn read_blocking(
    root: &Path,
    query: &ValidatedAccessLogQuery,
) -> Result<AccessLogResponse, ReadError> {
    let capture = read_snapshot_blocking(root, query)?;
    let entries = capture
        .entries
        .iter()
        .skip(query.offset)
        .take(query.limit)
        .cloned()
        .collect::<Vec<_>>();
    let page_len = entries.len();
    let total = capture.entries.len();
    Ok(AccessLogResponse {
        entries,
        limit: query.limit,
        offset: query.offset,
        total,
        has_more: query.offset.saturating_add(page_len) < total,
        truncated: capture.truncated,
        snapshot: String::new(),
        snapshot_expires_at: String::new(),
        snapshot_reset: false,
    })
}

fn empty_capture() -> CapturedLogs {
    CapturedLogs {
        entries: Vec::new(),
        truncated: false,
    }
}

fn read_snapshot_blocking(
    root: &Path,
    query: &ValidatedAccessLogQuery,
) -> Result<CapturedLogs, ReadError> {
    let root = match state_dir(root) {
        Ok(root) => root,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(empty_capture()),
        Err(_) => return Err(ReadError::Failed),
    };
    let logs = match root.open_dir("logs") {
        Ok(logs) => logs,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(empty_capture()),
        Err(_) => return Err(ReadError::Failed),
    };
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
        for (line_offset, line) in data
            .rsplit(|b| *b == b'\n')
            .filter(|line| !line.is_empty())
            .enumerate()
        {
            if scanned >= MAX_RECORDS {
                truncated = true;
                break;
            }
            scanned += 1;
            let Ok(value) = serde_json::from_slice::<serde_json::Value>(line) else {
                continue;
            };
            let Some(entry) = parse_entry(&value, cutoff) else {
                continue;
            };
            if matches_query(&entry, query) {
                matches.push(IndexedEntry {
                    timestamp_nanos: OffsetDateTime::parse(&entry.timestamp, &Rfc3339)
                        .expect("validated access-log timestamp")
                        .unix_timestamp_nanos(),
                    entry,
                    file_identity: name.clone(),
                    line_offset,
                });
            }
        }
    }
    matches.sort_by(compare_indexed_entries);
    let matches = matches.into_iter().map(|indexed| indexed.entry).collect();
    let (entries, truncated) = cap_snapshot_entries(matches, query, truncated);
    Ok(CapturedLogs { entries, truncated })
}

fn compare_indexed_entries(left: &IndexedEntry, right: &IndexedEntry) -> Ordering {
    let left_file_rank = usize::from(left.file_identity != "access.log");
    let right_file_rank = usize::from(right.file_identity != "access.log");
    right
        .timestamp_nanos
        .cmp(&left.timestamp_nanos)
        .then_with(|| compare_entry_fields(&left.entry, &right.entry))
        .then_with(|| left_file_rank.cmp(&right_file_rank))
        .then_with(|| left.file_identity.cmp(&right.file_identity))
        .then_with(|| left.line_offset.cmp(&right.line_offset))
}

fn compare_entry_fields(left: &AccessLogEntry, right: &AccessLogEntry) -> Ordering {
    left.host
        .cmp(&right.host)
        .then_with(|| left.path.cmp(&right.path))
        .then_with(|| left.method.cmp(&right.method))
        .then_with(|| left.status.cmp(&right.status))
        .then_with(|| left.duration_ms.cmp(&right.duration_ms))
        .then_with(|| left.client_ip.cmp(&right.client_ip))
        .then_with(|| left.upstream.cmp(&right.upstream))
        .then_with(|| left.bytes.cmp(&right.bytes))
        .then_with(|| left.protocol.cmp(&right.protocol))
}

fn read_tail(file: &mut File, maximum: usize) -> std::io::Result<(usize, Vec<u8>, bool)> {
    let len = file.metadata()?.len();
    let take = len.min(maximum as u64) as usize;
    if take == 0 {
        return Ok((0, Vec::new(), false));
    }
    let start = len - take as u64;
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
