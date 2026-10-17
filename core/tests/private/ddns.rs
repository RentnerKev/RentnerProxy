use super::fixture::*;
use super::{
    discovery,
    models::{Error, RecordType, Selection, Status},
    validation,
};
use serde_json::json;
use std::{sync::atomic::Ordering, time::Duration};

#[tokio::test]
async fn multizone_apex_wildcard_and_proxy_exception_preserve_unselected_records_and_ipv6() {
    let initial = vec![
        record('1', 'a', "example.com", "A", "9.9.9.9"),
        record('2', 'a', "test.example.com", "A", "1.0.0.1"),
        record(
            '3',
            'a',
            "_acme-challenge.example.com",
            "TXT",
            "keep-acme-challenge",
        ),
        record('4', 'a', "example.com", "AAAA", "2001:4860::1"),
        record('5', 'b', "git.example.org", "A", "9.9.9.9"),
    ];
    let fixture = Fixture::new(initial.clone()).await;
    let make = || {
        let mut wildcard = target(11, "*.example.org", RecordType::A, Selection::Create);
        wildcard.zone_id = provider_id('b');
        let mut git = target(
            12,
            "git.example.org",
            RecordType::A,
            Selection::Adopt {
                record_id: provider_id('5'),
            },
        );
        git.zone_id = provider_id('b');
        git.proxied = false;
        request(vec![
            target(
                10,
                "example.com",
                RecordType::A,
                Selection::Adopt {
                    record_id: provider_id('1'),
                },
            ),
            wildcard,
            git,
            target(
                13,
                "example.com",
                RecordType::Aaaa,
                Selection::Adopt {
                    record_id: provider_id('4'),
                },
            ),
        ])
    };
    let result = fixture
        .engine
        .execute(&fixture.store, make(), false)
        .await
        .unwrap();
    assert_eq!(
        result.targets.iter().map(|t| t.status).collect::<Vec<_>>(),
        [
            Status::Updated,
            Status::Updated,
            Status::Updated,
            Status::Skipped
        ]
    );
    assert_eq!(fixture.writes(), 3);
    {
        let data = fixture.mock.data.lock().unwrap();
        for id in ['2', '3', '4'] {
            assert_eq!(
                data.records
                    .iter()
                    .find(|r| r["id"] == provider_id(id))
                    .unwrap(),
                initial.iter().find(|r| r["id"] == provider_id(id)).unwrap()
            );
        }
        assert_eq!(data.records[0]["ttl"], 3600);
        assert_eq!(data.records[0]["comment"], "keep this comment");
        assert_eq!(data.records[0]["tags"], json!(["owner:fixture"]));
        assert_eq!(data.records[4]["proxied"], false);
    }
    assert_eq!(fixture.mock.ipv6_calls.load(Ordering::SeqCst), 0);
    let repeated = fixture
        .engine
        .execute(&fixture.store, make(), false)
        .await
        .unwrap();
    assert!(
        repeated.targets[..3]
            .iter()
            .all(|r| r.status == Status::Unchanged)
    );
    assert_eq!(fixture.writes(), 3);
    assert!(!serde_json::to_string(&repeated).unwrap().contains(SECRET));
}

#[tokio::test]
async fn preview_requires_explicit_adoption_or_creation_and_never_writes() {
    let fixture = Fixture::new(vec![record('1', 'a', "example.com", "A", "9.9.9.9")]).await;
    let inspect = || {
        request(vec![
            target(10, "example.com", RecordType::A, Selection::Inspect),
            target(11, "new.example.com", RecordType::A, Selection::Inspect),
        ])
    };
    let preview = fixture
        .engine
        .execute(&fixture.store, inspect(), true)
        .await
        .unwrap();
    assert_eq!(preview.targets[0].status, Status::AdoptionRequired);
    assert_eq!(
        preview.targets[0].current.as_ref().unwrap().id,
        provider_id('1')
    );
    assert_eq!(preview.targets[1].status, Status::CreationRequired);
    let unchanged = fixture
        .engine
        .execute(&fixture.store, inspect(), false)
        .await
        .unwrap();
    assert!(
        unchanged
            .targets
            .iter()
            .all(|r| r.status == Status::Skipped)
    );
    let selected = request(vec![
        target(
            10,
            "example.com",
            RecordType::A,
            Selection::Adopt {
                record_id: provider_id('1'),
            },
        ),
        target(11, "new.example.com", RecordType::A, Selection::Create),
    ]);
    let preview = fixture
        .engine
        .execute(&fixture.store, selected, true)
        .await
        .unwrap();
    assert_eq!(preview.targets[0].status, Status::WouldUpdate);
    assert_eq!(preview.targets[1].status, Status::WouldCreate);
    assert_eq!(fixture.writes(), 0);
}

#[tokio::test]
async fn conflicts_are_per_target_and_never_overwrite_cnames_duplicates_or_replacements() {
    let fixture = Fixture::new(vec![
        record('1', 'a', "alias.example.com", "CNAME", "other.example.com"),
        record('2', 'a', "dup.example.com", "A", "1.0.0.1"),
        record('3', 'a', "dup.example.com", "A", "9.9.9.9"),
        record('4', 'a', "existing.example.com", "A", "9.9.9.9"),
    ])
    .await;
    let mut outside = target(15, "notexample.com", RecordType::A, Selection::Create);
    let mut denied = target(16, "denied.example.com", RecordType::A, Selection::Create);
    denied.zone_id = provider_id('c');
    outside.proxied = false;
    let result = fixture
        .engine
        .execute(
            &fixture.store,
            request(vec![
                target(10, "alias.example.com", RecordType::A, Selection::Create),
                target(
                    11,
                    "dup.example.com",
                    RecordType::A,
                    Selection::Adopt {
                        record_id: provider_id('2'),
                    },
                ),
                target(12, "existing.example.com", RecordType::A, Selection::Create),
                target(
                    13,
                    "existing.example.com",
                    RecordType::Aaaa,
                    Selection::Inspect,
                ),
                target(
                    14,
                    "missing.example.com",
                    RecordType::A,
                    Selection::Adopt {
                        record_id: provider_id('9'),
                    },
                ),
                outside,
                denied,
                target(17, "good.example.com", RecordType::A, Selection::Create),
            ]),
            false,
        )
        .await
        .unwrap();
    assert_eq!(
        result.targets.iter().map(|r| r.error).collect::<Vec<_>>(),
        [
            Some(Error::RecordConflict),
            Some(Error::RecordConflict),
            Some(Error::RecordConflict),
            Some(Error::FamilyDisabled),
            Some(Error::RecordChanged),
            Some(Error::NameOutsideZone),
            Some(Error::ZoneNotPermitted),
            None
        ]
    );
    assert_eq!(result.targets[7].status, Status::Updated);
    assert_eq!(fixture.writes(), 1);
}

#[tokio::test]
async fn invalid_ipv4_preserves_a_records_while_valid_ipv6_can_succeed() {
    let original = record('1', 'a', "example.com", "A", "9.9.9.9");
    let fixture = Fixture::new(vec![original.clone()]).await;
    fixture.mock.data.lock().unwrap().v4 = "ip=192.168.1.1\n".into();
    let mut request = request(vec![
        target(
            10,
            "example.com",
            RecordType::A,
            Selection::Adopt {
                record_id: provider_id('1'),
            },
        ),
        target(11, "example.com", RecordType::Aaaa, Selection::Create),
    ]);
    request.ipv6 = true;
    let result = fixture
        .engine
        .execute(&fixture.store, request, false)
        .await
        .unwrap();
    assert_eq!(result.targets[0].error, Some(Error::IpDiscoveryFailed));
    assert_eq!(result.targets[1].status, Status::Updated);
    assert_eq!(fixture.writes(), 1);
    assert_eq!(fixture.mock.data.lock().unwrap().records[0], original);
}

#[tokio::test]
async fn provider_failures_are_redacted_retryable_and_do_not_change_records() {
    let original = record('1', 'a', "example.com", "A", "9.9.9.9");
    let fixture = Fixture::new(vec![original.clone()]).await;
    let make = || {
        request(vec![target(
            10,
            "example.com",
            RecordType::A,
            Selection::Adopt {
                record_id: provider_id('1'),
            },
        )])
    };
    for (status, code) in [
        (
            axum::http::StatusCode::FORBIDDEN,
            Error::ProviderUnauthorized,
        ),
        (
            axum::http::StatusCode::TOO_MANY_REQUESTS,
            Error::ProviderRateLimited,
        ),
        (
            axum::http::StatusCode::SERVICE_UNAVAILABLE,
            Error::ProviderUnavailable,
        ),
    ] {
        fixture.mock.data.lock().unwrap().status = status;
        let result = fixture
            .engine
            .execute(&fixture.store, make(), false)
            .await
            .unwrap();
        assert_eq!(result.targets[0].error, Some(code));
        assert_eq!(result.targets[0].retry_after_seconds, Some(17));
        assert!(!serde_json::to_string(&result).unwrap().contains(SECRET));
        *fixture.engine.run.lock().await = None;
    }
    assert_eq!(fixture.writes(), 0);
    assert_eq!(fixture.mock.data.lock().unwrap().records[0], original);
    fixture.mock.data.lock().unwrap().status = axum::http::StatusCode::OK;
    assert_eq!(
        fixture
            .engine
            .execute(&fixture.store, make(), false)
            .await
            .unwrap()
            .targets[0]
            .status,
        Status::Updated
    );
}

#[tokio::test]
async fn changed_records_and_incomplete_pages_prevent_writes() {
    let fixture = Fixture::new(vec![record('1', 'a', "example.com", "A", "1.0.0.1")]).await;
    let make = || {
        request(vec![target(
            10,
            "example.com",
            RecordType::A,
            Selection::Adopt {
                record_id: provider_id('1'),
            },
        )])
    };
    fixture.mock.data.lock().unwrap().change_on_second_read = true;
    assert_eq!(
        fixture
            .engine
            .execute(&fixture.store, make(), false)
            .await
            .unwrap()
            .targets[0]
            .error,
        Some(Error::RecordChanged)
    );
    fixture.mock.data.lock().unwrap().malformed_page = true;
    assert_eq!(
        fixture
            .engine
            .execute(&fixture.store, make(), false)
            .await
            .unwrap()
            .targets[0]
            .error,
        Some(Error::InvalidProviderResponse)
    );
    assert_eq!(fixture.writes(), 0);
}

#[tokio::test]
async fn ambiguous_creation_is_reported_and_replay_recognizes_its_owned_record() {
    let fixture = Fixture::new(vec![]).await;
    let make = || {
        request(vec![target(
            10,
            "new.example.com",
            RecordType::A,
            Selection::Create,
        )])
    };
    fixture.mock.data.lock().unwrap().bad_ack = true;
    let result = fixture
        .engine
        .execute(&fixture.store, make(), false)
        .await
        .unwrap();
    assert_eq!(result.targets[0].error, Some(Error::WriteUnconfirmed));
    assert_eq!(fixture.writes(), 1);
    fixture.mock.data.lock().unwrap().bad_ack = false;
    assert_eq!(
        fixture
            .engine
            .execute(&fixture.store, make(), false)
            .await
            .unwrap()
            .targets[0]
            .status,
        Status::Unchanged
    );
    assert_eq!(fixture.writes(), 1);
}

#[tokio::test]
async fn redirects_never_forward_credentials_or_write_dns() {
    let fixture = Fixture::new(vec![]).await;
    fixture.mock.data.lock().unwrap().redirect = true;
    let result = fixture
        .engine
        .execute(
            &fixture.store,
            request(vec![target(
                10,
                "example.com",
                RecordType::A,
                Selection::Create,
            )]),
            false,
        )
        .await
        .unwrap();
    assert_eq!(result.targets[0].error, Some(Error::ProviderUnavailable));
    assert_eq!(fixture.mock.leaked.load(Ordering::SeqCst), 0);
    assert_eq!(fixture.writes(), 0);
}

#[tokio::test]
async fn bounded_discovery_and_provider_bodies_fail_without_dns_writes() {
    let fixture = Fixture::new(vec![]).await;
    let make = || {
        request(vec![target(
            10,
            "example.com",
            RecordType::A,
            Selection::Create,
        )])
    };
    fixture.mock.data.lock().unwrap().v4 = format!("ip=8.8.8.8\npadding={}\n", "a".repeat(4096));
    let result = fixture
        .engine
        .execute(&fixture.store, make(), false)
        .await
        .unwrap();
    assert_eq!(result.targets[0].error, Some(Error::IpDiscoveryFailed));
    assert_eq!(fixture.mock.reads.load(Ordering::SeqCst), 0);
    {
        let mut data = fixture.mock.data.lock().unwrap();
        data.v4 = "ip=8.8.8.8\n".into();
        data.oversized = true;
    }
    let result = fixture
        .engine
        .execute(&fixture.store, make(), false)
        .await
        .unwrap();
    assert_eq!(
        result.targets[0].error,
        Some(Error::InvalidProviderResponse)
    );
    assert_eq!(fixture.writes(), 0);
}

#[tokio::test]
async fn rate_limits_pause_remaining_targets_and_subsequent_manual_runs() {
    let fixture = Fixture::new(vec![]).await;
    fixture.mock.data.lock().unwrap().status = axum::http::StatusCode::TOO_MANY_REQUESTS;
    let make = || {
        request(vec![
            target(10, "first.example.com", RecordType::A, Selection::Create),
            target(11, "second.example.com", RecordType::A, Selection::Create),
        ])
    };
    let result = fixture
        .engine
        .execute(&fixture.store, make(), false)
        .await
        .unwrap();
    assert_eq!(result.targets[0].status, Status::Failed);
    assert_eq!(result.targets[1].status, Status::Skipped);
    assert_eq!(result.targets[1].retry_after_seconds, Some(17));
    let paused = fixture
        .engine
        .execute(&fixture.store, make(), false)
        .await
        .unwrap();
    assert!(
        paused
            .targets
            .iter()
            .all(|target| target.status == Status::Skipped
                && target.error == Some(Error::ProviderRateLimited))
    );
    assert_eq!(fixture.mock.reads.load(Ordering::SeqCst), 1);
    assert_eq!(fixture.mock.ipv4_calls.load(Ordering::SeqCst), 1);
    *fixture.engine.run.lock().await = Some(super::Cooldown {
        until: tokio::time::Instant::now() - Duration::from_secs(1),
        error: Error::ProviderRateLimited,
    });
    fixture.mock.data.lock().unwrap().status = axum::http::StatusCode::OK;
    let recovered = fixture
        .engine
        .execute(&fixture.store, make(), false)
        .await
        .unwrap();
    assert!(
        recovered
            .targets
            .iter()
            .all(|target| target.status == Status::Updated)
    );
    assert_eq!(fixture.writes(), 2);
}

#[test]
fn discovery_rejects_private_reserved_malformed_and_wrong_family_addresses() {
    for ip in [
        "",
        "garbage",
        "127.0.0.1",
        "192.168.0.1",
        "100.64.0.1",
        "198.18.0.1",
        "192.0.2.1",
        "0.0.0.0",
        "224.0.0.1",
        "255.255.255.255",
        "::1",
        "fc00::1",
        "fe80::1",
        "2001:db8::1",
        "2002:808:808::1",
        "3fff::1",
        "::ffff:8.8.8.8",
    ] {
        for family in [RecordType::A, RecordType::Aaaa] {
            assert!(
                discovery::parse(&format!("ip={ip}\n"), family).is_err(),
                "accepted {ip}"
            );
        }
    }
    assert!(discovery::parse("ip=8.8.8.8\nip=1.1.1.1\n", RecordType::A).is_err());
    assert!(discovery::parse("ip=8.8.8.8\n", RecordType::Aaaa).is_err());
    assert!(discovery::parse("ip=2001:4860::1\n", RecordType::A).is_err());
    assert!(discovery::parse("ip=8.8.8.8\n", RecordType::A).is_ok());
    assert!(discovery::parse("ip=2001:4860::1\n", RecordType::Aaaa).is_ok());
}

#[tokio::test]
async fn malformed_batches_are_rejected_before_any_network_request() {
    let fixture = Fixture::new(vec![]).await;
    let good = target(10, "example.com", RecordType::A, Selection::Create);
    assert!(validation::request(&request(vec![])).is_err());
    assert!(
        fixture
            .engine
            .execute(
                &fixture.store,
                request(vec![good.clone(), good.clone()]),
                false
            )
            .await
            .is_err()
    );
    for name in [
        "EXAMPLE.com",
        "evil.example.com.attacker.test.",
        "*.*.example.com",
        "_acme-challenge.example.com",
        "127.0.0.1",
        "example.com\n",
    ] {
        let mut bad = good.clone();
        bad.name = name.into();
        assert!(
            fixture
                .engine
                .execute(&fixture.store, request(vec![bad]), false)
                .await
                .is_err(),
            "accepted {name}"
        );
    }
    let mut repeated = good.clone();
    repeated.id = "0198d98a-0000-7000-8000-000000000011".into();
    assert!(
        fixture
            .engine
            .execute(&fixture.store, request(vec![good, repeated]), false)
            .await
            .is_err()
    );
    assert_eq!(fixture.mock.ipv4_calls.load(Ordering::SeqCst), 0);
    assert_eq!(fixture.mock.reads.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn concurrent_runs_are_rejected_and_credential_deletion_waits_for_inflight_record() {
    let fixture = Fixture::new(vec![]).await;
    fixture.mock.pause.store(true, Ordering::SeqCst);
    let make = || {
        request(vec![target(
            10,
            "new.example.com",
            RecordType::A,
            Selection::Create,
        )])
    };
    let execute = fixture.engine.execute(&fixture.store, make(), false);
    tokio::pin!(execute);
    tokio::select! { _=fixture.mock.entered.notified()=>{}, _=&mut execute=>panic!("run was not blocked") }
    assert!(matches!(
        fixture.engine.execute(&fixture.store, make(), false).await,
        Err(Error::Busy)
    ));
    assert!(
        tokio::time::timeout(
            Duration::from_millis(20),
            fixture.store.delete(CONNECTION, 1)
        )
        .await
        .is_err()
    );
    fixture.mock.pause.store(false, Ordering::SeqCst);
    fixture.mock.release.notify_one();
    assert_eq!(execute.await.unwrap().targets[0].status, Status::Updated);
    fixture.store.delete(CONNECTION, 1).await.unwrap();
}

#[tokio::test]
async fn batch_deadline_bounds_a_stalled_provider_and_skips_remaining_targets() {
    let mut fixture = Fixture::new(vec![]).await;
    fixture.engine.budget = Some(Duration::from_millis(500));
    fixture.mock.pause.store(true, Ordering::SeqCst);
    let result = fixture
        .engine
        .execute(
            &fixture.store,
            request(vec![
                target(10, "first.example.com", RecordType::A, Selection::Create),
                target(11, "second.example.com", RecordType::A, Selection::Create),
            ]),
            false,
        )
        .await
        .unwrap();
    assert_eq!(result.targets[0].status, Status::Failed);
    assert_eq!(result.targets[1].error, Some(Error::TimeBudgetExceeded));
    assert_eq!(fixture.writes(), 0);
}

#[tokio::test]
async fn records_owned_by_another_target_cannot_be_silently_adopted() {
    let mut existing = record('1', 'a', "example.com", "A", "9.9.9.9");
    existing["comment"] = json!("rentnerproxy-ddns:0198d98a-0000-7000-8000-000000000999");
    let fixture = Fixture::new(vec![existing.clone()]).await;
    let result = fixture
        .engine
        .execute(
            &fixture.store,
            request(vec![target(
                10,
                "example.com",
                RecordType::A,
                Selection::Adopt {
                    record_id: provider_id('1'),
                },
            )]),
            false,
        )
        .await
        .unwrap();
    assert_eq!(result.targets[0].error, Some(Error::RecordConflict));
    assert_eq!(fixture.mock.data.lock().unwrap().records[0], existing);
    assert_eq!(fixture.writes(), 0);
}

#[tokio::test]
async fn private_http_contract_requires_bearer_and_rejects_invalid_bodies_without_echoing_secrets()
{
    use crate::{
        runtime::{ProxyRuntime, RuntimeSettings},
        server::{AppState, app_with_state},
    };
    use axum::{
        body::{Body, to_bytes},
        http::Request as HttpRequest,
    };
    use tower::ServiceExt;
    let fixture = Fixture::new(vec![]).await;
    let runtime = ProxyRuntime::new(RuntimeSettings::new(fixture.path.clone(), 8080), None);
    let token = crate::config::Config::from_values(
        None,
        Some("0123456789abcdef0123456789abcdef"),
        None,
        None,
        None,
        false,
    )
    .unwrap()
    .controller_token
    .unwrap();
    let authorized = app_with_state(AppState::new(runtime.clone(), Some(token)));
    let unconfigured = app_with_state(AppState::new(runtime, None));
    let valid = json!({"actorUserId":ACTOR,"ipv4":false,"ipv6":false,"targets":[{"id":"0198d98a-0000-7000-8000-000000000010","connectionId":CONNECTION,"zoneId":provider_id('a'),"name":"example.com","recordType":"A","proxied":false,"selection":{"mode":"create"}}]});
    for path in ["/internal/v1/ddns/preview", "/internal/v1/ddns/sync"] {
        for (app, bearer) in [
            (&authorized, None),
            (&authorized, Some("Bearer wrong")),
            (
                &unconfigured,
                Some("Bearer 0123456789abcdef0123456789abcdef"),
            ),
        ] {
            let mut builder = HttpRequest::builder().uri(path).method("POST");
            if let Some(bearer) = bearer {
                builder = builder.header("authorization", bearer);
            }
            let response = app
                .clone()
                .oneshot(builder.body(Body::from(valid.to_string())).unwrap())
                .await
                .unwrap();
            assert_eq!(response.status(), 401);
        }
        let send = |body: String| {
            HttpRequest::builder()
                .method("POST")
                .uri(path)
                .header("authorization", "Bearer 0123456789abcdef0123456789abcdef")
                .body(Body::from(body))
                .unwrap()
        };
        if path.ends_with("/sync") {
            let response = authorized
                .clone()
                .oneshot(send(
                    json!({"actorUserId":ACTOR,"expectedRevision":0}).to_string(),
                ))
                .await
                .unwrap();
            assert_eq!(response.status(), 409);
            let response = authorized
                .clone()
                .oneshot(send(valid.to_string()))
                .await
                .unwrap();
            assert_eq!(response.status(), 400);
            continue;
        }
        let response = authorized
            .clone()
            .oneshot(send(valid.to_string()))
            .await
            .unwrap();
        assert_eq!(response.status(), 200);
        assert_eq!(response.headers()["cache-control"], "no-store");
        let body: serde_json::Value =
            serde_json::from_slice(&to_bytes(response.into_body(), 65536).await.unwrap()).unwrap();
        assert_eq!(body["targets"][0]["status"], "skipped");
        let mut adopted_ipv6 = valid.clone();
        adopted_ipv6["targets"][0]["recordType"] = json!("AAAA");
        adopted_ipv6["targets"][0]["selection"] =
            json!({"mode":"adopt","recordId":provider_id('1')});
        let response = authorized
            .clone()
            .oneshot(send(adopted_ipv6.to_string()))
            .await
            .unwrap();
        assert_eq!(response.status(), 200);
        for body in [
            format!("{{\"apiToken\":\"{SECRET}\"}}"),
            "a".repeat(128 * 1024 + 1),
            valid.to_string().replace("\"A\"", "\"TXT\""),
        ] {
            let response = authorized.clone().oneshot(send(body)).await.unwrap();
            assert_eq!(response.status(), 400);
            let bytes = to_bytes(response.into_body(), 65536).await.unwrap();
            assert!(!String::from_utf8_lossy(&bytes).contains(SECRET));
        }
    }
    assert_eq!(fixture.mock.ipv4_calls.load(Ordering::SeqCst), 0);
    assert_eq!(fixture.writes(), 0);
}
