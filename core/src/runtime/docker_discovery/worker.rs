use super::{
    Discovery,
    client::{Docker, Events},
    models::*,
};
use std::{
    sync::{Arc, atomic::Ordering},
    time::Duration,
};
use tokio::time::{Instant, sleep, sleep_until};

impl Discovery {
    pub(crate) async fn start(self: &Arc<Self>) {
        let mut task = self.task.lock().await;
        if task.is_some() || self.stopping.load(Ordering::SeqCst) {
            return;
        }
        let discovery = Arc::clone(self);
        *task = Some(tokio::spawn(async move {
            discovery.run().await;
        }));
    }
    pub(crate) fn stop_accepting(&self) {
        self.stopping.store(true, Ordering::SeqCst);
        self.wake.notify_one();
    }
    pub(crate) async fn stop(&self) {
        self.stop_accepting();
        if let Some(mut task) = self.task.lock().await.take() {
            match tokio::time::timeout(Duration::from_secs(2), &mut task).await {
                Ok(Ok(())) => {}
                Ok(Err(error)) => {
                    crate::runtime::task::report_join_failure("docker_discovery", &error)
                }
                Err(_) => {
                    task.abort();
                    let _ = task.await;
                }
            }
        }
    }
    async fn run(&self) {
        let mut failures = 0_u32;
        while !self.stopping.load(Ordering::SeqCst) {
            let loaded = super::persistence::load(&self.path, &self.io).await;
            let document = match loaded {
                Ok((document, false)) if document.settings.enabled => document,
                _ => {
                    tokio::select! { _ = self.wake.notified() => {}, _ = sleep(Duration::from_secs(30)) => {} }
                    continue;
                }
            };
            // Changing configuration cancels reads/streams, never enqueues a second worker.
            let result = tokio::select! {
                _ = self.wake.notified() => { failures = 0; continue; },
                result = self.observe(&document) => result,
            };
            if let Err(error) = result {
                self.publish(&document, None, Some(error)).await;
                failures = failures.saturating_add(1).min(6);
            } else {
                failures = 0;
            }
            let delay = Duration::from_secs(if failures == 0 {
                1
            } else {
                (1_u64 << failures).min(60)
            });
            tokio::select! { _ = self.wake.notified() => { failures = 0; }, _ = sleep(delay) => {} }
        }
    }
    async fn observe(&self, document: &Document) -> Result<(), Error> {
        let docker = Docker::new(
            document
                .settings
                .endpoint
                .as_deref()
                .ok_or(Error::InvalidInput)?,
        )?;
        // Subscribe before listing, so events during a scan are retained by the bounded HTTP stream.
        let mut stream = docker.events().await?;
        self.publish(document, Some(docker.inventory().await?), None)
            .await;
        let expires = Instant::now() + Duration::from_secs(60);
        let mut refresh = expires;
        let mut dirty = false;
        let mut decoder = Events::default();
        loop {
            tokio::select! {
                // Deadlines win even under a continuous event flood; at most one scan every 500ms.
                biased;
                _ = sleep_until(refresh) => {
                    if Instant::now() >= expires { return Ok(()); }
                    self.publish(document, Some(docker.inventory().await?), None).await;
                    dirty = false;
                    refresh = expires;
                },
                chunk = stream.chunk() => {
                    let Some(chunk) = chunk.map_err(|_| Error::EndpointUnavailable)? else { return Err(Error::EndpointUnavailable); };
                    if decoder.push(&chunk)? && !dirty {
                        dirty = true;
                        refresh = (Instant::now() + Duration::from_millis(500)).min(expires);
                    }
                }
            }
        }
    }
}
