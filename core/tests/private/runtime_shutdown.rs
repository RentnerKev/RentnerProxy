use super::*;

#[tokio::test]
async fn held_apply_lock_and_stalled_ddns_share_the_callers_shutdown_deadline() {
    let runtime = ProxyRuntime::new(
        super::super::RuntimeSettings::new(std::env::temp_dir(), 0),
        None,
    );
    let held_apply = runtime.apply_lock.lock().await;
    let exited = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    struct Exited(std::sync::Arc<std::sync::atomic::AtomicBool>);
    impl Drop for Exited {
        fn drop(&mut self) {
            self.0.store(true, Ordering::SeqCst);
        }
    }
    let (ready, started) = tokio::sync::oneshot::channel();
    let done = exited.clone();
    *runtime.ddns_task.lock().await = Some(tokio::spawn(async move {
        let _done = Exited(done);
        ready.send(()).unwrap();
        std::future::pending::<()>().await;
    }));
    started.await.unwrap();
    let deadline = Instant::now() + Duration::from_millis(50);
    tokio::time::timeout(Duration::from_millis(500), runtime.shutdown_until(deadline))
        .await
        .unwrap();
    tokio::task::yield_now().await;
    assert!(exited.load(Ordering::SeqCst));
    assert!(runtime.stopping.load(Ordering::SeqCst));
    drop(held_apply);
}

#[tokio::test]
async fn shutdown_immediately_rejects_manual_renewal_and_candidate_activation() {
    let runtime = ProxyRuntime::new(
        super::super::RuntimeSettings::new(std::env::temp_dir(), 0),
        None,
    );
    runtime.begin_shutdown();
    assert!(matches!(
        runtime
            .start_acme_renewal(
                "not-a-certificate".into(),
                crate::server::challenges::ChallengeStore::new()
            )
            .await,
        Err(super::super::CertificateError::OperationInProgress)
    ));
    assert!(matches!(
        runtime
            .retry_certificate_candidate("not-a-certificate", false)
            .await,
        Err(super::super::CertificateError::OperationInProgress)
    ));
}
