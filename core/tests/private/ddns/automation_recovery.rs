use super::*;

#[tokio::test]
async fn write_retry_after_fences_other_targets_and_survives_restart() {
    for adopt in [false, true] {
        let fixture = Fixture::new(if adopt {
            vec![record('1', 'a', "example.com", "A", "9.9.9.9")]
        } else {
            vec![]
        })
        .await;
        let automation = Automation::new(fixture.path.clone());
        let mut config = settings(0, true, true);
        if adopt {
            config.configuration.targets[0].selection = Selection::Adopt {
                record_id: provider_id('1'),
            };
        }
        config.configuration.targets.push(target(
            11,
            "other.example.com",
            RecordType::A,
            Selection::Create,
        ));
        configure(&automation, &fixture, config).await;
        {
            let mut data = fixture.mock.data.lock().unwrap();
            data.write_status = StatusCode::SERVICE_UNAVAILABLE;
            data.retry_after = "120".into();
        }
        let result = tick(&automation, &fixture, NOW).await.unwrap();
        assert_eq!(result.targets[0].error, Some(Error::WriteUnconfirmed));
        assert_eq!(result.targets[0].retry_after_seconds, Some(120));
        assert_eq!(result.targets[1].status, Status::Skipped);
        assert_eq!(result.targets[1].error, Some(Error::ProviderUnavailable));
        assert_eq!(fixture.writes(), 1);
        assert_eq!(fixture.mock.reads.load(Ordering::SeqCst), 2);
        let state = automation.status_at(&fixture.store, NOW).await.unwrap();
        assert_eq!(state.provider_not_before, Some(NOW + 120));
        assert_eq!(
            state.provider_pause_reason,
            Some(Error::ProviderUnavailable)
        );
        let restarted = Automation::new(fixture.path.clone());
        assert!(tick(&restarted, &fixture, NOW + 119).await.is_none());
        let state = restarted
            .status_at(&fixture.store, NOW + 119)
            .await
            .unwrap();
        assert_eq!(state.provider_not_before, Some(NOW + 120));
        assert_eq!(fixture.writes(), 1);
        let reads = fixture.mock.reads.load(Ordering::SeqCst);
        let result = fixture
            .engine
            .execute(
                &fixture.store,
                request(vec![target(
                    12,
                    "third.example.com",
                    RecordType::A,
                    Selection::Create,
                )]),
                false,
            )
            .await
            .unwrap();
        assert_eq!(result.targets[0].status, Status::Skipped);
        assert_eq!(result.targets[0].error, Some(Error::ProviderUnavailable));
        assert_eq!(fixture.mock.reads.load(Ordering::SeqCst), reads);
    }
}

#[tokio::test]
async fn cancelled_disable_cannot_drop_active_batch_results_without_a_status_observer() {
    let fixture = Fixture::new(vec![]).await;
    let automation = Automation::new(fixture.path.clone());
    configure(&automation, &fixture, settings(0, true, true)).await;
    fixture.mock.pause.store(true, Ordering::SeqCst);
    let run = automation.run_at(&fixture.store, &fixture.engine, None, NOW);
    tokio::pin!(run);
    tokio::select! { _=fixture.mock.entered.notified()=>{}, _=&mut run=>panic!("batch did not pause") }
    let io = Arc::clone(&automation.io).lock_owned().await;
    {
        let disable = automation.disable_at(&fixture.store, action(1), NOW + 1);
        tokio::pin!(disable);
        tokio::select! { biased; result=&mut disable=>panic!("disable should wait for I/O: {result:?}"), _=tokio::task::yield_now()=>{} }
    }
    assert!(automation.state.lock().await.is_none());
    drop(io);
    fixture.mock.pause.store(false, Ordering::SeqCst);
    fixture.mock.release.notify_one();
    let result = tokio::time::timeout(Duration::from_secs(3), &mut run)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert_eq!(result.targets[0].status, Status::Updated);
    let state = automation.status_at(&fixture.store, NOW + 1).await.unwrap();
    assert_eq!(state.last_run.unwrap().outcome, Outcome::Completed);
    assert!(state.in_flight.is_none());
    assert!(state.targets[0].last_success_at.is_some());
    assert!(
        !state
            .events
            .iter()
            .any(|event| event.outcome == Outcome::Interrupted)
    );
}

#[tokio::test]
async fn cancelled_disable_cannot_drop_a_concurrent_preview_cooldown() {
    let fixture = Fixture::new(vec![]).await;
    let automation = Automation::new(fixture.path.clone());
    configure(&automation, &fixture, settings(0, true, true)).await;
    fixture.mock.data.lock().unwrap().status = StatusCode::TOO_MANY_REQUESTS;
    fixture.mock.pause.store(true, Ordering::SeqCst);
    let preview = automation.preview(
        &fixture.store,
        &fixture.engine,
        request(vec![target(
            10,
            "example.com",
            RecordType::A,
            Selection::Create,
        )]),
    );
    tokio::pin!(preview);
    tokio::select! { _=fixture.mock.entered.notified()=>{}, _=&mut preview=>panic!("preview did not pause") }
    let io = Arc::clone(&automation.io).lock_owned().await;
    {
        let disable = automation.disable_at(&fixture.store, action(1), NOW + 1);
        tokio::pin!(disable);
        tokio::select! { biased; result=&mut disable=>panic!("disable should wait for I/O: {result:?}"), _=tokio::task::yield_now()=>{} }
    }
    assert!(automation.state.lock().await.is_none());
    drop(io);
    fixture.mock.pause.store(false, Ordering::SeqCst);
    fixture.mock.release.notify_one();
    let result = tokio::time::timeout(Duration::from_secs(3), &mut preview)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(result.targets[0].error, Some(Error::ProviderRateLimited));
    let state = automation.status(&fixture.store).await.unwrap();
    assert!(state.provider_not_before.is_some());
    assert_eq!(
        state.provider_pause_reason,
        Some(Error::ProviderRateLimited)
    );
    assert_eq!(fixture.writes(), 0);
}
