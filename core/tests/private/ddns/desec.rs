use super::Error;
use crate::runtime::ddns::{
    desec_fixture::*,
    models::{Selection, Status},
};
use axum::http::StatusCode;

#[tokio::test]
async fn creates_ipv6_with_zone_minimum_ttl_without_ownership_metadata() {
    let fixture = Fixture::new(vec![]).await;
    let result = fixture
        .engine
        .execute(&fixture.store, request(Selection::Create), false)
        .await
        .unwrap();
    assert_eq!(result.targets[0].status, Status::Updated);
    let data = fixture.data.lock().unwrap();
    assert_eq!(
        data.writes,
        vec![
            serde_json::json!({"subname":"","type":"AAAA","ttl":900,"records":["2001:4860:4860::8844"]})
        ]
    );
    assert_eq!(data.methods, vec!["POST"]);
    assert_eq!(result.targets[0].current.as_ref().unwrap().id.len(), 32);
}
#[tokio::test]
async fn adoption_refuses_unsafe_updates_and_unchanged_normalized_ipv6_is_noop() {
    let fixture = Fixture::new(vec![
        rrset("AAAA", &["2001:4860:4860::8888"]),
        rrset("TXT", &["\"foreign\""]),
    ])
    .await;
    let preview = fixture
        .engine
        .execute(&fixture.store, request(Selection::Inspect), true)
        .await
        .unwrap();
    let id = preview.targets[0].current.as_ref().unwrap().id.clone();
    let approved = request(Selection::Adopt {
        record_id: id.clone(),
    });
    let preview = fixture
        .engine
        .execute(&fixture.store, approved, true)
        .await
        .unwrap();
    assert_eq!(preview.targets[0].status, Status::Failed);
    assert_eq!(
        preview.targets[0].error,
        Some(Error::UpdatePreconditionUnsupported)
    );
    let result = fixture
        .engine
        .execute(
            &fixture.store,
            request(Selection::Adopt {
                record_id: id.clone(),
            }),
            false,
        )
        .await
        .unwrap();
    assert_eq!(result.targets[0].status, Status::Failed);
    assert_eq!(
        result.targets[0].error,
        Some(Error::UpdatePreconditionUnsupported)
    );
    {
        let data = fixture.data.lock().unwrap();
        assert!(data.methods.is_empty());
        assert!(data.writes.is_empty());
        assert_eq!(
            data.rrsets.iter().find(|r| r["type"] == "TXT").unwrap()["records"],
            serde_json::json!(["\"foreign\""])
        );
        assert_eq!(
            data.rrsets.iter().find(|r| r["type"] == "AAAA").unwrap()["ttl"],
            3600
        );
    }
    fixture
        .data
        .lock()
        .unwrap()
        .rrsets
        .iter_mut()
        .find(|r| r["type"] == "AAAA")
        .unwrap()["records"] = serde_json::json!(["2001:4860:4860:0:0:0:0:8844"]);
    let result = fixture
        .engine
        .execute(
            &fixture.store,
            request(Selection::Adopt { record_id: id }),
            false,
        )
        .await
        .unwrap();
    assert_eq!(result.targets[0].status, Status::Unchanged);
    assert!(fixture.data.lock().unwrap().writes.is_empty());
}

#[tokio::test]
async fn replacement_after_the_last_read_cannot_reach_an_owner_type_patch() {
    let fixture = Fixture::new(vec![rrset("AAAA", &["2001:4860:4860::8888"])]).await;
    let target = target(Selection::Inspect);
    let access = fixture
        .store
        .record_access(&target.connection_id, &target.zone_id)
        .await
        .unwrap();
    let provider = super::Provider::new(
        access.provider,
        reqwest::Client::new(),
        &access.endpoint,
        &access.token,
        tokio::time::Instant::now() + std::time::Duration::from_secs(3),
    )
    .unwrap();
    let observed = super::records(&provider, &target).await.unwrap();
    {
        let mut data = fixture.data.lock().unwrap();
        data.rrsets[0]["created"] = serde_json::json!("2026-02-01T00:00:00Z");
        data.rrsets[0]["records"] = serde_json::json!(["2001:4860:4860::9999"]);
    }
    let result = super::write(
        &provider,
        &target,
        "2001:4860:4860::8844".parse().unwrap(),
        observed.first(),
    )
    .await;
    assert!(matches!(result, Err(failure) if failure.code == Error::UpdatePreconditionUnsupported));
    let data = fixture.data.lock().unwrap();
    assert!(data.methods.is_empty());
    assert!(data.writes.is_empty());
    assert_eq!(
        data.rrsets[0]["records"],
        serde_json::json!(["2001:4860:4860::9999"])
    );
}

#[tokio::test]
async fn creation_racing_a_foreign_rrset_never_overwrites_it() {
    let fixture = Fixture::new(vec![]).await;
    fixture.data.lock().unwrap().replace_before_create = true;
    let result = fixture
        .engine
        .execute(&fixture.store, request(Selection::Create), false)
        .await
        .unwrap();
    assert_eq!(result.targets[0].error, Some(Error::WriteUnconfirmed));
    let data = fixture.data.lock().unwrap();
    assert_eq!(data.methods, vec!["POST"]);
    assert_eq!(data.rrsets.len(), 1);
    assert_eq!(
        data.rrsets[0]["records"],
        serde_json::json!(["2001:4860:4860::9999"])
    );
}
#[tokio::test]
async fn existing_rrsets_require_adoption_and_multiple_addresses_are_preserved() {
    for values in [
        vec!["2001:4860:4860::8844"],
        vec!["2001:4860:4860::8844", "2001:4860:4860::8888"],
    ] {
        let fixture = Fixture::new(vec![rrset("AAAA", &values)]).await;
        let result = fixture
            .engine
            .execute(&fixture.store, request(Selection::Create), false)
            .await
            .unwrap();
        assert_eq!(result.targets[0].error, Some(Error::RecordConflict));
        assert!(fixture.data.lock().unwrap().writes.is_empty());
    }
    let fixture = Fixture::new(vec![rrset("CNAME", &["foreign.example."])]).await;
    let result = fixture
        .engine
        .execute(&fixture.store, request(Selection::Create), false)
        .await
        .unwrap();
    assert_eq!(result.targets[0].error, Some(Error::RecordConflict));
    assert!(fixture.data.lock().unwrap().writes.is_empty());
}
#[tokio::test]
async fn replacement_rrset_timestamp_invalidates_explicit_adoption() {
    let fixture = Fixture::new(vec![rrset("AAAA", &["2001:4860:4860::8888"])]).await;
    let preview = fixture
        .engine
        .execute(&fixture.store, request(Selection::Inspect), true)
        .await
        .unwrap();
    let id = preview.targets[0].current.as_ref().unwrap().id.clone();
    fixture.data.lock().unwrap().rrsets[0]["created"] = serde_json::json!("2026-02-01T00:00:00Z");
    let result = fixture
        .engine
        .execute(
            &fixture.store,
            request(Selection::Adopt { record_id: id }),
            false,
        )
        .await
        .unwrap();
    assert_eq!(result.targets[0].error, Some(Error::RecordChanged));
    assert!(fixture.data.lock().unwrap().writes.is_empty());
}
#[tokio::test]
async fn rejects_untrusted_identity_pagination_and_invalid_zone_ttl_before_write() {
    for field in ["domain", "name", "subname", "created"] {
        let mut value = rrset("AAAA", &["2001:4860:4860::8888"]);
        value[field] = serde_json::json!("malicious");
        let fixture = Fixture::new(vec![value]).await;
        let result = fixture
            .engine
            .execute(&fixture.store, request(Selection::Inspect), true)
            .await
            .unwrap();
        assert_eq!(
            result.targets[0].error,
            Some(Error::InvalidProviderResponse),
            "{field}"
        );
        assert!(fixture.data.lock().unwrap().writes.is_empty());
    }
    let fixture = Fixture::new(vec![]).await;
    fixture.data.lock().unwrap().next_page = true;
    let result = fixture
        .engine
        .execute(&fixture.store, request(Selection::Create), false)
        .await
        .unwrap();
    assert_eq!(
        result.targets[0].error,
        Some(Error::InvalidProviderResponse)
    );
    fixture.data.lock().unwrap().next_page = false;
    fixture.data.lock().unwrap().minimum_ttl = 0;
    let result = fixture
        .engine
        .execute(&fixture.store, request(Selection::Create), false)
        .await
        .unwrap();
    assert_eq!(
        result.targets[0].error,
        Some(Error::InvalidProviderResponse)
    );
    assert!(fixture.data.lock().unwrap().writes.is_empty());
}
#[tokio::test]
async fn provider_errors_honour_retry_after_and_ambiguous_ack_cannot_be_adopted() {
    for status in [
        StatusCode::UNAUTHORIZED,
        StatusCode::FORBIDDEN,
        StatusCode::TOO_MANY_REQUESTS,
    ] {
        let fixture = Fixture::new(vec![]).await;
        fixture.data.lock().unwrap().status = status;
        let result = fixture
            .engine
            .execute(&fixture.store, request(Selection::Create), false)
            .await
            .unwrap();
        assert_eq!(
            result.targets[0].error,
            Some(if status == StatusCode::TOO_MANY_REQUESTS {
                Error::ProviderRateLimited
            } else {
                Error::ProviderUnauthorized
            })
        );
        assert_eq!(result.targets[0].retry_after_seconds, Some(17));
        assert!(fixture.data.lock().unwrap().writes.is_empty());
    }
    let fixture = Fixture::new(vec![]).await;
    fixture.data.lock().unwrap().bad_ack = true;
    let result = fixture
        .engine
        .execute(&fixture.store, request(Selection::Create), false)
        .await
        .unwrap();
    assert_eq!(result.targets[0].error, Some(Error::WriteUnconfirmed));
    fixture.data.lock().unwrap().bad_ack = false;
    let result = fixture
        .engine
        .execute(&fixture.store, request(Selection::Create), false)
        .await
        .unwrap();
    assert_eq!(result.targets[0].error, Some(Error::RecordConflict));
    assert_eq!(fixture.data.lock().unwrap().writes.len(), 1);
}
#[tokio::test]
async fn unsupported_proxy_mode_is_rejected_without_provider_write() {
    let fixture = Fixture::new(vec![]).await;
    let mut request = request(Selection::Create);
    request.targets[0].proxied = true;
    let result = fixture
        .engine
        .execute(&fixture.store, request, false)
        .await
        .unwrap();
    assert_eq!(result.targets[0].error, Some(Error::InvalidInput));
    assert!(fixture.data.lock().unwrap().writes.is_empty());
}

#[tokio::test]
async fn mutation_failures_are_never_retried_and_rate_limit_is_fenced() {
    for (status, error) in [
        (StatusCode::INTERNAL_SERVER_ERROR, Error::WriteUnconfirmed),
        (StatusCode::TOO_MANY_REQUESTS, Error::ProviderRateLimited),
        (StatusCode::FORBIDDEN, Error::ProviderUnauthorized),
    ] {
        let fixture = Fixture::new(vec![]).await;
        fixture.data.lock().unwrap().write_status = status;
        let result = fixture
            .engine
            .execute(&fixture.store, request(Selection::Create), false)
            .await
            .unwrap();
        assert_eq!(result.targets[0].error, Some(error));
        assert_eq!(fixture.data.lock().unwrap().writes.len(), 1);
        if status == StatusCode::TOO_MANY_REQUESTS {
            assert_eq!(result.targets[0].retry_after_seconds, Some(23));
            fixture.data.lock().unwrap().write_status = StatusCode::OK;
            let result = fixture
                .engine
                .execute(&fixture.store, request(Selection::Create), false)
                .await
                .unwrap();
            assert_eq!(result.targets[0].status, Status::Skipped);
            assert_eq!(result.targets[0].error, Some(Error::ProviderRateLimited));
            assert_eq!(fixture.data.lock().unwrap().writes.len(), 1);
        }
    }
}
