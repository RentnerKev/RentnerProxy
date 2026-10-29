use super::*;
use crate::runtime::ddns::{
    desec_fixture::*,
    models::{Selection, Status},
};
const NOW: i64 = 1_900_000_000;
#[tokio::test]
async fn created_rrset_remains_unchanged_after_restart_but_cannot_be_updated() {
    let fixture = Fixture::new(vec![]).await;
    let automation = Automation::new(fixture.path.clone());
    automation
        .save_at(
            &fixture.store,
            SaveConfiguration {
                expected_revision: 0,
                actor_user_id: ACTOR.into(),
                configuration: Configuration {
                    enabled: true,
                    interval_seconds: 300,
                    update_on_start: true,
                    ipv4: false,
                    ipv6: true,
                    targets: vec![target(Selection::Create)],
                },
            },
            NOW,
            Outcome::Configured,
        )
        .await
        .unwrap();
    let run = automation
        .run_at(&fixture.store, &fixture.engine, None, NOW)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(run.targets[0].status, Status::Updated);
    let run = automation
        .run_at(&fixture.store, &fixture.engine, None, NOW + 300)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(run.targets[0].status, Status::Unchanged);
    drop(automation);
    let automation = Automation::new(fixture.path.clone());
    let run = automation
        .run_at(&fixture.store, &fixture.engine, None, NOW + 600)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(run.targets[0].status, Status::Unchanged);
    fixture.data.lock().unwrap().ip = "2001:4860:4860::8888".into();
    let run = automation
        .run_at(&fixture.store, &fixture.engine, None, NOW + 900)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(run.targets[0].status, Status::Failed);
    assert_eq!(
        run.targets[0].error,
        Some(crate::runtime::ddns::models::Error::UpdatePreconditionUnsupported)
    );
    assert_eq!(fixture.data.lock().unwrap().methods, vec!["POST"]);
    assert_eq!(fixture.data.lock().unwrap().writes.len(), 1);
}

#[tokio::test]
async fn cancellation_after_provider_creation_does_not_claim_unknown_rrset_on_restart() {
    let fixture = Arc::new(Fixture::new(vec![]).await);
    let automation = Arc::new(Automation::new(fixture.path.clone()));
    automation
        .save_at(
            &fixture.store,
            SaveConfiguration {
                expected_revision: 0,
                actor_user_id: ACTOR.into(),
                configuration: Configuration {
                    enabled: true,
                    interval_seconds: 300,
                    update_on_start: true,
                    ipv4: false,
                    ipv6: true,
                    targets: vec![target(Selection::Create)],
                },
            },
            NOW,
            Outcome::Configured,
        )
        .await
        .unwrap();
    let (entered, release) = {
        let mut data = fixture.data.lock().unwrap();
        data.pause_ack = true;
        (data.entered.clone(), data.release.clone())
    };
    let run = {
        let fixture = fixture.clone();
        let automation = automation.clone();
        tokio::spawn(async move {
            automation
                .run_at(&fixture.store, &fixture.engine, None, NOW)
                .await
        })
    };
    tokio::time::timeout(std::time::Duration::from_secs(3), entered.notified())
        .await
        .unwrap();
    run.abort();
    let _ = run.await;
    release.notify_one();
    fixture.data.lock().unwrap().pause_ack = false;
    drop(automation);
    let automation = Automation::new(fixture.path.clone());
    let status = automation
        .status_at(&fixture.store, NOW + 300)
        .await
        .unwrap();
    assert!(
        status.targets[0]
            .last_result
            .as_ref()
            .is_none_or(|result| result.status != Status::Updated)
    );
    let run = automation
        .run_at(
            &fixture.store,
            &fixture.engine,
            Some(Action {
                expected_revision: 1,
                actor_user_id: ACTOR.into(),
            }),
            NOW + 600,
        )
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        run.targets[0].error,
        Some(crate::runtime::ddns::models::Error::RecordConflict)
    );
    assert_eq!(fixture.data.lock().unwrap().writes.len(), 1);
}

#[tokio::test]
async fn changing_selection_discards_automatic_create_reuse() {
    let fixture = Fixture::new(vec![]).await;
    let automation = Automation::new(fixture.path.clone());
    let configuration = |selection| Configuration {
        enabled: true,
        interval_seconds: 300,
        update_on_start: true,
        ipv4: false,
        ipv6: true,
        targets: vec![target(selection)],
    };
    automation
        .save_at(
            &fixture.store,
            SaveConfiguration {
                expected_revision: 0,
                actor_user_id: ACTOR.into(),
                configuration: configuration(Selection::Create),
            },
            NOW,
            Outcome::Configured,
        )
        .await
        .unwrap();
    let run = automation
        .run_at(&fixture.store, &fixture.engine, None, NOW)
        .await
        .unwrap()
        .unwrap();
    let id = run.targets[0].current.as_ref().unwrap().id.clone();
    automation
        .save_at(
            &fixture.store,
            SaveConfiguration {
                expected_revision: 1,
                actor_user_id: ACTOR.into(),
                configuration: configuration(Selection::Adopt { record_id: id }),
            },
            NOW + 1,
            Outcome::Configured,
        )
        .await
        .unwrap();
    automation
        .save_at(
            &fixture.store,
            SaveConfiguration {
                expected_revision: 2,
                actor_user_id: ACTOR.into(),
                configuration: configuration(Selection::Create),
            },
            NOW + 2,
            Outcome::Configured,
        )
        .await
        .unwrap();
    let run = automation
        .run_at(&fixture.store, &fixture.engine, None, NOW + 300)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        run.targets[0].error,
        Some(crate::runtime::ddns::models::Error::RecordConflict)
    );
    assert_eq!(fixture.data.lock().unwrap().writes.len(), 1);
}

#[tokio::test]
async fn successful_creation_authority_survives_transient_read_failures_and_restart() {
    use crate::runtime::ddns::Engine;
    use axum::http::StatusCode;
    for status in [
        StatusCode::TOO_MANY_REQUESTS,
        StatusCode::SERVICE_UNAVAILABLE,
    ] {
        let fixture = Fixture::new(vec![]).await;
        let automation = Automation::new(fixture.path.clone());
        automation
            .save_at(
                &fixture.store,
                SaveConfiguration {
                    expected_revision: 0,
                    actor_user_id: ACTOR.into(),
                    configuration: Configuration {
                        enabled: true,
                        interval_seconds: 300,
                        update_on_start: true,
                        ipv4: false,
                        ipv6: true,
                        targets: vec![target(Selection::Create)],
                    },
                },
                NOW,
                Outcome::Configured,
            )
            .await
            .unwrap();
        let run = automation
            .run_at(&fixture.store, &fixture.engine, None, NOW)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(run.targets[0].status, Status::Updated);
        let created_id = run.targets[0].current.as_ref().unwrap().id.clone();
        {
            let mut data = fixture.data.lock().unwrap();
            data.ip = "2001:4860:4860::8888".into();
            data.status = status;
        }
        let failed = automation
            .run_at(&fixture.store, &fixture.engine, None, NOW + 300)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(failed.targets[0].status, Status::Failed);
        let saved = automation
            .status_at(&fixture.store, NOW + 301)
            .await
            .unwrap();
        assert_eq!(
            saved.targets[0].created_record_id.as_deref(),
            Some(created_id.as_str())
        );
        assert_eq!(
            saved.targets[0].last_result.as_ref().unwrap().status,
            Status::Failed
        );
        drop(automation);
        {
            let mut data = fixture.data.lock().unwrap();
            data.status = StatusCode::OK;
            data.write_status = StatusCode::OK;
            data.ip = "2001:4860:4860::8844".into();
        }
        // A fresh engine models process restart, restoring the durable provider
        // deadline from automation state rather than waiting on wall-clock time.
        let engine = Engine {
            discovery_urls: fixture.engine.discovery_urls.clone(),
            ..Engine::new()
        };
        let automation = Automation::new(fixture.path.clone());
        let recovered = automation
            .run_at(&fixture.store, &engine, None, NOW + 600)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            recovered.targets[0].status,
            Status::Unchanged,
            "status={status}"
        );
        assert_eq!(
            recovered.targets[0].current.as_ref().unwrap().id,
            created_id
        );
        assert_eq!(fixture.data.lock().unwrap().writes.len(), 1);
    }
}
