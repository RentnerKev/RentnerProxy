use super::super::{SnapshotCache, read};
use super::{TempState, line, query};
use std::fs;
use time::OffsetDateTime;

async fn assert_snapshot_pages(state: &TempState, total: usize, limit: usize) {
    let cache = SnapshotCache::new();
    let mut offset = 0;
    let mut snapshot = None;
    let mut received = 0;
    loop {
        let mut page_query = query(limit, offset);
        page_query.snapshot = snapshot.clone();
        let response = read(state.path(), page_query, &cache).await.unwrap();
        let expected_len = total.saturating_sub(offset).min(limit);
        assert_eq!(response.total, total);
        assert_eq!(response.offset, offset);
        assert_eq!(response.entries.len(), expected_len);
        assert_eq!(response.has_more, offset + expected_len < total);
        if let Some(snapshot_id) = snapshot.as_ref() {
            assert_eq!(&response.snapshot, snapshot_id);
        } else {
            assert!(!response.snapshot.is_empty());
            snapshot = Some(response.snapshot.clone());
        }
        received += response.entries.len();
        if !response.has_more {
            break;
        }
        offset += expected_len;
    }
    assert_eq!(received, total);
}

fn write_paginated_entries(state: &TempState, total: usize) {
    let now = OffsetDateTime::now_utc().unix_timestamp() as f64;
    let mut contents = (0..total)
        .map(|index| {
            line(
                now + index as f64,
                "a.example",
                &format!("/entry{index}"),
                200,
                &index.to_string(),
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    if !contents.is_empty() {
        contents.push('\n');
    }
    state.write("access.log", &contents);
}

#[tokio::test]
async fn snapshot_pages_cover_boundary_totals_and_page_sizes() {
    let _read_guard = super::READ_TEST_LOCK.lock().await;
    for total in [0, 1, 15, 16, 30, 31] {
        let state = TempState::new(true);
        write_paginated_entries(&state, total);
        for limit in [15, 25, 50, 100] {
            assert_snapshot_pages(&state, total, limit).await;
        }
    }
}

#[tokio::test]
async fn equal_timestamps_keep_field_order_after_archive_rename_and_line_reordering() {
    let _read_guard = super::READ_TEST_LOCK.lock().await;
    let state = TempState::new(true);
    let now = OffsetDateTime::now_utc().unix_timestamp() as f64;
    let archive = "access-2099-01-01T00-00-00.000-size.log";
    let renamed_archive = "access-2099-01-01T00-00-01.000-size.log";
    state.write(
        "access.log",
        &format!(
            "{}\n{}\n",
            line(now, "a.example", "/zulu", 200, "zulu"),
            line(now, "a.example", "/alpha", 200, "alpha")
        ),
    );
    state.write(
        archive,
        &format!(
            "{}\n{}\n",
            line(now, "a.example", "/delta", 200, "delta"),
            line(now, "a.example", "/bravo", 200, "bravo")
        ),
    );
    let cache = SnapshotCache::new();
    let first = read(state.path(), query(20, 0), &cache).await.unwrap();
    let first_paths = first
        .entries
        .iter()
        .map(|entry| entry.path.as_str())
        .collect::<Vec<_>>();
    assert_eq!(first_paths, ["/alpha", "/bravo", "/delta", "/zulu"]);

    fs::rename(
        state.path().join("logs").join(archive),
        state.path().join("logs").join(renamed_archive),
    )
    .unwrap();
    state.write(
        "access.log",
        &format!(
            "{}\n{}\n",
            line(now, "a.example", "/alpha", 200, "alpha"),
            line(now, "a.example", "/zulu", 200, "zulu")
        ),
    );
    state.write(
        renamed_archive,
        &format!(
            "{}\n{}\n",
            line(now, "a.example", "/bravo", 200, "bravo"),
            line(now, "a.example", "/delta", 200, "delta")
        ),
    );
    let second = read(state.path(), query(20, 0), &cache).await.unwrap();
    let second_paths = second
        .entries
        .iter()
        .map(|entry| entry.path.as_str())
        .collect::<Vec<_>>();
    assert!(!second.snapshot_reset);
    assert_ne!(second.snapshot, first.snapshot);
    assert_eq!(second_paths, first_paths);
}

#[tokio::test]
async fn snapshot_tokens_are_isolated_between_cache_instances() {
    let _read_guard = super::READ_TEST_LOCK.lock().await;
    let state = TempState::new(true);
    let now = OffsetDateTime::now_utc().unix_timestamp() as f64;
    state.write(
        "access.log",
        &format!(
            "{}\n{}\n",
            line(now, "a.example", "/old", 200, "old"),
            line(now + 1.0, "a.example", "/new", 200, "new")
        ),
    );
    let cache = SnapshotCache::new();
    let first = read(state.path(), query(1, 0), &cache).await.unwrap();
    let mut continuation = query(1, 1);
    continuation.snapshot = Some(first.snapshot.clone());
    let continued = read(state.path(), continuation.clone(), &cache)
        .await
        .unwrap();
    assert!(!continued.snapshot_reset);
    assert_eq!(continued.offset, 1);

    let other_cache = SnapshotCache::new();
    let reset = read(state.path(), continuation, &other_cache)
        .await
        .unwrap();
    assert!(reset.snapshot_reset);
    assert_eq!(reset.offset, 0);
    assert_ne!(reset.snapshot, first.snapshot);
}
