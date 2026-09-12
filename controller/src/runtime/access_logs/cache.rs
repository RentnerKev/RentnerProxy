use std::{
    collections::{HashMap, VecDeque},
    mem::size_of,
    sync::Mutex,
    time::{Duration as StdDuration, Instant},
};

use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use ring::rand::{SecureRandom, SystemRandom};
use time::{Duration, OffsetDateTime, format_description::well_known::Rfc3339};

use super::reader::{CapturedLogs, ReadError};
use super::{
    AccessLogEntry, AccessLogResponse, MAX_SINGLE_SNAPSHOT_BYTES, MAX_SNAPSHOT_BYTES,
    MAX_SNAPSHOTS, SnapshotQuery, ValidatedAccessLogQuery,
};

const SNAPSHOT_TTL: StdDuration = StdDuration::from_secs(120);
const SNAPSHOT_ID_BYTES: usize = 32;
const SNAPSHOT_FIXED_BYTES: usize = 1024;

#[derive(Clone, Debug)]
struct CachedSnapshot {
    query: SnapshotQuery,
    entries: Vec<AccessLogEntry>,
    total: usize,
    truncated: bool,
    expires_at: Instant,
    expires_at_utc: String,
    bytes: usize,
}

#[derive(Default)]
struct SnapshotCacheState {
    snapshots: HashMap<String, CachedSnapshot>,
    lru: VecDeque<String>,
    bytes: usize,
}

pub(crate) struct SnapshotCache {
    state: Mutex<SnapshotCacheState>,
}

impl SnapshotCache {
    pub(crate) fn new() -> Self {
        Self {
            state: Mutex::new(SnapshotCacheState::default()),
        }
    }

    pub(super) fn lookup(
        &self,
        snapshot_id: &str,
        query: &ValidatedAccessLogQuery,
        now: Instant,
    ) -> Result<Option<AccessLogResponse>, ReadError> {
        let mut state = self.state.lock().map_err(|_| ReadError::Failed)?;
        remove_expired(&mut state, now);
        let Some(snapshot) = state.snapshots.get(snapshot_id) else {
            return Ok(None);
        };
        if !snapshot.query.matches(query) {
            return Ok(None);
        }
        let response = page_response(snapshot_id, snapshot, query, false);
        touch_snapshot(&mut state, snapshot_id);
        Ok(Some(response))
    }

    pub(super) fn insert(
        &self,
        capture_query: &ValidatedAccessLogQuery,
        page_query: &ValidatedAccessLogQuery,
        capture: CapturedLogs,
        reset: bool,
        now: Instant,
    ) -> Result<AccessLogResponse, ReadError> {
        let expires_at = now + SNAPSHOT_TTL;
        let expires_at_utc = (OffsetDateTime::now_utc() + Duration::seconds(120))
            .format(&Rfc3339)
            .map_err(|_| ReadError::Failed)?;
        let mut state = self.state.lock().map_err(|_| ReadError::Failed)?;
        remove_expired(&mut state, now);
        let mut snapshot_id = new_snapshot_id().ok_or(ReadError::Failed)?;
        while state.snapshots.contains_key(&snapshot_id) {
            snapshot_id = new_snapshot_id().ok_or(ReadError::Failed)?;
        }
        let bytes = snapshot_memory_bytes(
            capture_query,
            &capture.entries,
            snapshot_id.capacity(),
            expires_at_utc.capacity(),
        );
        if bytes > MAX_SINGLE_SNAPSHOT_BYTES {
            return Err(ReadError::Failed);
        }
        while state.snapshots.len() >= MAX_SNAPSHOTS
            || state.bytes.saturating_add(bytes) > MAX_SNAPSHOT_BYTES
        {
            let Some(oldest) = state.lru.pop_front() else {
                break;
            };
            if let Some(removed) = state.snapshots.remove(&oldest) {
                state.bytes = state.bytes.saturating_sub(removed.bytes);
            }
        }
        state.bytes = state.bytes.saturating_add(bytes);
        state.lru.push_back(snapshot_id.clone());
        let snapshot = CachedSnapshot {
            query: SnapshotQuery::from_query(capture_query),
            total: capture.entries.len(),
            entries: capture.entries,
            truncated: capture.truncated,
            expires_at,
            expires_at_utc,
            bytes,
        };
        state.snapshots.insert(snapshot_id.clone(), snapshot);
        let snapshot = state.snapshots.get(&snapshot_id).ok_or(ReadError::Failed)?;
        Ok(page_response(&snapshot_id, snapshot, page_query, reset))
    }

    #[cfg(test)]
    pub(super) fn len(&self) -> usize {
        self.state
            .lock()
            .map(|state| state.snapshots.len())
            .unwrap_or_default()
    }
}

fn touch_snapshot(state: &mut SnapshotCacheState, snapshot_id: &str) {
    if let Some(index) = state.lru.iter().position(|id| id == snapshot_id) {
        state.lru.remove(index);
    }
    state.lru.push_back(snapshot_id.to_owned());
}

fn remove_expired(state: &mut SnapshotCacheState, now: Instant) {
    let expired = state
        .lru
        .iter()
        .filter(|id| {
            state
                .snapshots
                .get(*id)
                .is_some_and(|snapshot| snapshot.expires_at <= now)
        })
        .cloned()
        .collect::<Vec<_>>();
    for id in expired {
        if let Some(snapshot) = state.snapshots.remove(&id) {
            state.bytes = state.bytes.saturating_sub(snapshot.bytes);
        }
        if let Some(index) = state.lru.iter().position(|current| current == &id) {
            state.lru.remove(index);
        }
    }
}

fn new_snapshot_id() -> Option<String> {
    let mut bytes = [0_u8; SNAPSHOT_ID_BYTES];
    SystemRandom::new().fill(&mut bytes).ok()?;
    Some(URL_SAFE_NO_PAD.encode(bytes))
}

fn page_response(
    snapshot_id: &str,
    snapshot: &CachedSnapshot,
    query: &ValidatedAccessLogQuery,
    snapshot_reset: bool,
) -> AccessLogResponse {
    let entries = snapshot
        .entries
        .iter()
        .skip(query.offset)
        .take(query.limit)
        .cloned()
        .collect::<Vec<_>>();
    let has_more = query.offset.saturating_add(entries.len()) < snapshot.total;
    AccessLogResponse {
        entries,
        limit: query.limit,
        offset: query.offset,
        total: snapshot.total,
        has_more,
        truncated: snapshot.truncated,
        snapshot: snapshot_id.to_owned(),
        snapshot_expires_at: snapshot.expires_at_utc.clone(),
        snapshot_reset,
    }
}

fn snapshot_memory_bytes(
    query: &ValidatedAccessLogQuery,
    entries: &Vec<AccessLogEntry>,
    snapshot_id_capacity: usize,
    expires_at_capacity: usize,
) -> usize {
    SNAPSHOT_FIXED_BYTES
        .saturating_add(snapshot_id_capacity)
        .saturating_add(snapshot_id_capacity)
        .saturating_add(expires_at_capacity)
        .saturating_add(query_memory_bytes(query))
        .saturating_add(
            entries
                .capacity()
                .saturating_mul(size_of::<AccessLogEntry>()),
        )
        .saturating_add(
            entries
                .iter()
                .map(access_log_entry_heap_bytes)
                .sum::<usize>(),
        )
}

fn query_memory_bytes(query: &ValidatedAccessLogQuery) -> usize {
    query.host.as_ref().map_or(0, String::capacity)
        + query.search.as_ref().map_or(0, String::capacity)
        + size_of::<SnapshotQuery>()
}

fn access_log_entry_memory_bytes(entry: &AccessLogEntry) -> usize {
    size_of::<AccessLogEntry>() + access_log_entry_heap_bytes(entry)
}

fn access_log_entry_heap_bytes(entry: &AccessLogEntry) -> usize {
    entry.timestamp.capacity()
        + entry.host.capacity()
        + entry.method.capacity()
        + entry.path.capacity()
        + entry.client_ip.capacity()
        + entry.upstream.as_ref().map_or(0, String::capacity)
        + entry.protocol.capacity()
}

pub(super) fn cap_snapshot_entries(
    entries: Vec<AccessLogEntry>,
    query: &ValidatedAccessLogQuery,
    mut truncated: bool,
) -> (Vec<AccessLogEntry>, bool) {
    let base = SNAPSHOT_FIXED_BYTES
        .saturating_add(query_memory_bytes(query))
        .saturating_add(SNAPSHOT_ID_BYTES * 2)
        .saturating_add(64);
    let mut used = base;
    let mut keep = 0;
    for entry in &entries {
        let entry_bytes = access_log_entry_memory_bytes(entry);
        if used.saturating_add(entry_bytes) > MAX_SINGLE_SNAPSHOT_BYTES {
            truncated = true;
            break;
        }
        used = used.saturating_add(entry_bytes);
        keep += 1;
    }
    if keep < entries.len() {
        truncated = true;
    }
    let mut bounded = Vec::with_capacity(keep);
    bounded.extend(entries.into_iter().take(keep));
    bounded.shrink_to_fit();
    while snapshot_memory_bytes(query, &bounded, 64, 64) > MAX_SINGLE_SNAPSHOT_BYTES
        && !bounded.is_empty()
    {
        let next_len = bounded.len().saturating_sub(1);
        bounded = bounded.into_iter().take(next_len).collect();
        truncated = true;
    }
    (bounded, truncated)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn query() -> ValidatedAccessLogQuery {
        ValidatedAccessLogQuery {
            snapshot: None,
            host: None,
            status: None,
            search: None,
            limit: 15,
            offset: 0,
        }
    }

    #[test]
    fn vector_spare_capacity_is_counted_and_released_before_caching() {
        let query = query();
        let mut entries =
            Vec::with_capacity(MAX_SINGLE_SNAPSHOT_BYTES / size_of::<AccessLogEntry>());
        entries.push(AccessLogEntry {
            timestamp: "2026-09-12T12:00:00Z".into(),
            host: "example.com".into(),
            method: "GET".into(),
            path: "/".into(),
            status: 200,
            duration_ms: 1,
            client_ip: "192.0.2.1".into(),
            upstream: None,
            bytes: 0,
            protocol: "HTTP/2".into(),
        });
        assert!(snapshot_memory_bytes(&query, &entries, 64, 64) > MAX_SINGLE_SNAPSHOT_BYTES);
        let (bounded, truncated) = cap_snapshot_entries(entries, &query, false);
        assert!(!truncated);
        assert_eq!(bounded.len(), 1);
        assert!(snapshot_memory_bytes(&query, &bounded, 64, 64) < 4096);
    }

    #[test]
    fn aggregate_memory_bound_evicts_before_the_count_limit() {
        let cache = SnapshotCache::new();
        let query = query();
        for _ in 0..8 {
            let entries = Vec::with_capacity(3 * 1024 * 1024 / size_of::<AccessLogEntry>());
            cache
                .insert(
                    &query,
                    &query,
                    CapturedLogs {
                        entries,
                        truncated: false,
                    },
                    false,
                    Instant::now(),
                )
                .unwrap();
        }
        let state = cache.state.lock().unwrap();
        assert!(state.bytes <= MAX_SNAPSHOT_BYTES);
        assert!(state.snapshots.len() < MAX_SNAPSHOTS);
    }
}
