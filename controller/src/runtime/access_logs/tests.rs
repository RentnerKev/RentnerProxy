use super::reader::CapturedLogs;
use super::*;
use std::{
    fs::{self, File},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{Duration as StdDuration, Instant},
};
use time::{Duration, OffsetDateTime};

static READ_TEST_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

mod snapshots;

struct TempState(PathBuf);

impl TempState {
    fn new(with_logs: bool) -> Self {
        let id = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "rentnerproxy-access-logs-{}-{id}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&path);
        if with_logs {
            fs::create_dir_all(path.join("logs")).unwrap();
        } else {
            fs::create_dir_all(&path).unwrap();
        }
        Self(path)
    }
    fn path(&self) -> &Path {
        &self.0
    }
    fn write(&self, name: &str, contents: &str) {
        fs::write(self.0.join("logs").join(name), contents).unwrap();
    }
}

impl Drop for TempState {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn query(limit: usize, offset: usize) -> ValidatedAccessLogQuery {
    ValidatedAccessLogQuery {
        snapshot: None,
        host: None,
        status: None,
        search: None,
        limit,
        offset,
    }
}

fn line(ts: f64, host: &str, path: &str, status: u64, marker: &str) -> String {
    serde_json::json!({
        "ts": ts,
        "request": {"host": host, "method": "GET", "uri": format!("{path}?token={marker}"), "proto": "HTTP/1.1", "remote_ip": "192.0.2.1"},
        "status": status,
        "duration": 0.004,
        "size": 10,
        "upstream": format!("tcp/{marker}")
    }).to_string()
}

#[test]
fn tail_budget_includes_latest_record_and_reports_truncated() {
    let state = TempState::new(true);
    let now = OffsetDateTime::now_utc().unix_timestamp() as f64;
    let mut contents = "x".repeat(MAX_LOG_BYTES + 128);
    contents.push('\n');
    contents.push_str(&line(now, "a.example", "/tail", 200, "tail-marker"));
    contents.push('\n');
    state.write("access.log", &contents);
    let response = read_blocking(state.path(), &query(20, 0)).unwrap();
    assert!(response.truncated);
    assert!(response.entries.iter().any(|entry| entry.path == "/tail"));
}

#[test]
fn record_budget_is_hard_and_newest_records_are_returned() {
    let state = TempState::new(true);
    let now = OffsetDateTime::now_utc().unix_timestamp() as f64;
    let mut contents = String::new();
    for index in 0..(MAX_RECORDS + 1) {
        contents.push_str(&line(
            now + index as f64,
            "a.example",
            &format!("/r{index}"),
            200,
            &index.to_string(),
        ));
        contents.push('\n');
    }
    state.write("access.log", &contents);
    let response = read_blocking(state.path(), &query(1, 0)).unwrap();
    assert!(response.truncated);
    assert_eq!(response.total, MAX_RECORDS);
    assert_eq!(response.entries[0].path, format!("/r{}", MAX_RECORDS));
}

#[test]
fn active_log_is_prioritized_over_newer_archive() {
    let state = TempState::new(true);
    let now = OffsetDateTime::now_utc().unix_timestamp() as f64;
    state.write(
        "access-2099-01-01T00-00-00.000-size.log",
        &format!("{}\n", line(now, "a.example", "/archive", 200, "archive")),
    );
    state.write(
        "access.log",
        &format!("{}\n", line(now, "a.example", "/active", 200, "active")),
    );
    File::options()
        .write(true)
        .open(
            state
                .path()
                .join("logs/access-2099-01-01T00-00-00.000-size.log"),
        )
        .unwrap()
        .set_modified(std::time::SystemTime::now() + std::time::Duration::from_secs(60))
        .unwrap();
    let response = read_blocking(state.path(), &query(20, 0)).unwrap();
    assert_eq!(response.entries[0].path, "/active");
}

#[test]
fn filters_and_pagination_report_filtered_indexes() {
    let state = TempState::new(true);
    let now = OffsetDateTime::now_utc().unix_timestamp() as f64;
    state.write(
        "access.log",
        &format!(
            "{}\n{}\n{}\n",
            line(now, "a.example", "/one", 200, "hit"),
            line(now, "a.example", "/two", 201, "hit"),
            line(now, "b.example", "/three", 200, "miss")
        ),
    );
    let mut page = query(1, 0);
    page.host = Some("a.example".into());
    page.search = Some("hit".into());
    let response = read_blocking(state.path(), &page).unwrap();
    assert_eq!(response.total, 2);
    assert!(response.has_more);
    assert_eq!(response.entries[0].path, "/one");

    let mut filtered = query(1, 1);
    filtered.host = Some("a.example".into());
    filtered.status = Some(201);
    filtered.search = Some("/two".into());
    let response = read_blocking(state.path(), &filtered).unwrap();
    assert_eq!(response.total, 1);
    assert_eq!(response.offset, 1);
    assert_eq!(response.entries.len(), 0);
    assert!(!response.has_more);
    filtered.offset = 0;
    let response = read_blocking(state.path(), &filtered).unwrap();
    assert_eq!(response.entries[0].path, "/two");
}

#[test]
fn malformed_and_partial_lines_are_ignored() {
    let state = TempState::new(true);
    let now = OffsetDateTime::now_utc().unix_timestamp() as f64;
    let prefix = "x".repeat(MAX_LOG_BYTES + 32);
    state.write(
        "access.log",
        &format!(
            "{prefix}\n{}\n{}",
            line(now, "a.example", "/valid", 200, "valid"),
            line(now, "a.example", "/partial", 200, "partial")
        ),
    );
    let response = read_blocking(state.path(), &query(20, 0)).unwrap();
    assert_eq!(response.entries.len(), 1);
    assert_eq!(response.entries[0].path, "/valid");
}

#[test]
fn entries_older_than_seven_days_are_excluded() {
    let state = TempState::new(true);
    let now = OffsetDateTime::now_utc().unix_timestamp() as f64;
    state.write(
        "access.log",
        &format!(
            "{}\n{}\n",
            line(
                now - Duration::days(8).whole_seconds() as f64,
                "a.example",
                "/old",
                200,
                "old"
            ),
            line(now, "a.example", "/new", 200, "new")
        ),
    );
    let response = read_blocking(state.path(), &query(20, 0)).unwrap();
    assert_eq!(response.entries.len(), 1);
    assert_eq!(response.entries[0].path, "/new");
}

#[test]
fn fields_are_utf8_bounded_and_control_free() {
    assert_eq!(bounded("aéz", 2), "a");
    assert_eq!(bounded("A\u{009f}B\n", 2), "AB");
    let long = "é".repeat(1500);
    let value = serde_json::json!({"ts": OffsetDateTime::now_utc().unix_timestamp() as f64, "request": {"host": format!("{long}.example"), "method": long, "uri": format!("/{long}?secret=x"), "proto": long, "remote_ip": long}, "status": 200, "duration": 0.1, "size": 1, "upstream": long});
    let entry = parse_entry(&value, OffsetDateTime::now_utc() - Duration::days(7)).unwrap();
    for (field, maximum) in [
        (&entry.host, 253),
        (&entry.method, 32),
        (&entry.path, 2048),
        (&entry.protocol, 32),
        (&entry.client_ip, 64),
    ] {
        assert!(field.len() <= maximum);
        assert!(field.chars().all(|c| !c.is_control()));
    }
    assert!(entry.path.ends_with('é') || entry.path == "/");
    assert!(entry.upstream.as_ref().unwrap().len() <= 512);
}

#[test]
fn unsafe_numeric_values_are_skipped() {
    let mut value = serde_json::json!({"ts": OffsetDateTime::now_utc().unix_timestamp() as f64, "request": {"host":"a.example","method":"GET","uri":"/","proto":"HTTP/1.1","remote_ip":"192.0.2.1"}, "status": 200, "duration": 0.1, "size": 9007199254740992_u64});
    assert!(parse_entry(&value, OffsetDateTime::now_utc() - Duration::days(7)).is_none());
    value["size"] = serde_json::json!(1);
    value["duration"] = serde_json::json!(9_007_199_254_741_f64);
    assert!(parse_entry(&value, OffsetDateTime::now_utc() - Duration::days(7)).is_none());
}

#[test]
fn missing_directory_is_empty_but_bad_file_is_failed() {
    let missing = TempState::new(false);
    assert_eq!(
        read_blocking(missing.path(), &query(10, 0)).unwrap().total,
        0
    );
    let state = TempState::new(true);
    fs::create_dir(state.path().join("logs").join("access.log")).unwrap();
    assert!(read_blocking(state.path(), &query(10, 0)).is_err());
}

#[cfg(unix)]
#[test]
fn symlink_log_is_rejected() {
    use std::os::unix::fs::symlink;
    let state = TempState::new(true);
    let target = state.path().join("target.log");
    fs::write(&target, "").unwrap();
    symlink(&target, state.path().join("logs/access.log")).unwrap();
    assert!(read_blocking(state.path(), &query(10, 0)).is_err());
    fs::remove_file(&target).unwrap();
    assert!(read_blocking(state.path(), &query(10, 0)).is_err());
}

#[test]
fn file_limit_is_reported() {
    let state = TempState::new(true);
    let now = OffsetDateTime::now_utc().unix_timestamp() as f64;
    state.write(
        "access.log",
        &format!("{}\n", line(now, "a.example", "/active", 200, "active")),
    );
    for index in 0..MAX_LOG_FILES {
        state.write(
            &format!("access-2099-01-01T00-00-{:02}.000-size.log", index),
            &format!(
                "{}\n",
                line(
                    now,
                    "a.example",
                    &format!("/archive{index}"),
                    200,
                    "archive"
                )
            ),
        );
    }
    let response = read_blocking(state.path(), &query(20, 0)).unwrap();
    assert!(response.truncated);
    assert!(response.total <= MAX_LOG_FILES);
}

#[tokio::test]
async fn snapshot_pages_survive_appends_and_rotation() {
    let _read_guard = READ_TEST_LOCK.lock().await;
    let state = TempState::new(true);
    let now = OffsetDateTime::now_utc().unix_timestamp() as f64;
    state.write(
        "access.log",
        &format!(
            "{}\n{}\n",
            line(now, "a.example", "/oldest", 200, "oldest"),
            line(now + 1.0, "a.example", "/middle", 200, "middle")
        ),
    );
    let cache = SnapshotCache::new();
    let first = read(state.path(), query(1, 0), &cache).await.unwrap();
    assert_eq!(first.entries[0].path, "/middle");
    assert!(!first.snapshot_reset);
    assert_eq!(first.snapshot.len(), 43);

    state.write(
        "access.log",
        &format!(
            "{}\n{}\n",
            line(now + 2.0, "a.example", "/new", 200, "new"),
            line(now + 3.0, "a.example", "/newest", 200, "newest")
        ),
    );
    let mut continuation = query(1, 1);
    continuation.snapshot = Some(first.snapshot.clone());
    let second = read(state.path(), continuation, &cache).await.unwrap();
    assert_eq!(second.total, 2);
    assert_eq!(second.entries[0].path, "/oldest");
    assert_eq!(second.snapshot, first.snapshot);
    assert_eq!(second.snapshot_expires_at, first.snapshot_expires_at);
}

#[test]
fn snapshot_cache_expiry_is_fixed_and_evicts_lru_entries() {
    let cache = SnapshotCache::new();
    let query = query(15, 0);
    let now = Instant::now();
    let first = cache
        .insert(
            &query,
            &query,
            CapturedLogs {
                entries: Vec::new(),
                truncated: false,
            },
            false,
            now,
        )
        .unwrap();
    let mut continuation = query.clone();
    continuation.snapshot = Some(first.snapshot.clone());
    assert!(
        cache
            .lookup(
                &first.snapshot,
                &continuation,
                now + StdDuration::from_secs(119)
            )
            .unwrap()
            .is_some()
    );
    assert!(
        cache
            .lookup(
                &first.snapshot,
                &continuation,
                now + StdDuration::from_secs(120)
            )
            .unwrap()
            .is_none()
    );

    let mut ids = Vec::new();
    for _ in 0..MAX_SNAPSHOTS {
        ids.push(
            cache
                .insert(
                    &query,
                    &query,
                    CapturedLogs {
                        entries: Vec::new(),
                        truncated: false,
                    },
                    false,
                    now,
                )
                .unwrap()
                .snapshot,
        );
    }
    let mut touched = query.clone();
    touched.snapshot = Some(ids[0].clone());
    assert!(cache.lookup(&ids[0], &touched, now).unwrap().is_some());
    let newest = cache
        .insert(
            &query,
            &query,
            CapturedLogs {
                entries: Vec::new(),
                truncated: false,
            },
            false,
            now,
        )
        .unwrap();
    assert_eq!(cache.len(), MAX_SNAPSHOTS);
    assert!(cache.lookup(&ids[0], &touched, now).unwrap().is_some());
    let mut evicted = query;
    evicted.snapshot = Some(ids[1].clone());
    assert!(cache.lookup(&ids[1], &evicted, now).unwrap().is_none());
    assert!(!newest.snapshot.is_empty());
}

#[tokio::test]
async fn unknown_or_mismatched_snapshot_resets_to_a_new_page() {
    let _read_guard = READ_TEST_LOCK.lock().await;
    let state = TempState::new(true);
    let now = OffsetDateTime::now_utc().unix_timestamp() as f64;
    state.write(
        "access.log",
        &format!(
            "{}\n{}\n",
            line(now, "a.example", "/one", 200, "one"),
            line(now + 1.0, "b.example", "/two", 200, "two")
        ),
    );
    let cache = SnapshotCache::new();
    let first = read(state.path(), query(1, 0), &cache).await.unwrap();
    let mut mismatched = query(1, 1);
    mismatched.host = Some("a.example".to_owned());
    mismatched.snapshot = Some(first.snapshot);
    let reset = read(state.path(), mismatched, &cache).await.unwrap();
    assert!(reset.snapshot_reset);
    assert_eq!(reset.offset, 0);
    assert_eq!(reset.entries[0].path, "/one");

    let mut unknown = query(1, 9);
    unknown.snapshot = Some("A".repeat(16));
    let reset = read(state.path(), unknown, &cache).await.unwrap();
    assert!(reset.snapshot_reset);
    assert_eq!(reset.offset, 0);
}

#[test]
fn access_log_query_keeps_default_limit_and_rejects_malformed_snapshot() {
    let validated = AccessLogQuery::default().validate().unwrap();
    assert_eq!(validated.limit, 15);
    assert_eq!(validated.offset, 0);
    let invalid = AccessLogQuery {
        snapshot: Some("bad!".to_owned()),
        ..AccessLogQuery::default()
    };
    assert_eq!(
        invalid.validate(),
        Err(AccessLogQueryError::MalformedSnapshot)
    );
}
