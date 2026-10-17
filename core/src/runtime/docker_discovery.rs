mod client;
mod labels;
pub(crate) mod models;
mod persistence;
mod worker;

use models::{Configuration, Document, Error, Save, Snapshot, Status};
use std::{
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};
use tokio::{
    sync::{Mutex, Notify},
    task::JoinHandle,
};

pub(crate) struct Discovery {
    path: PathBuf,
    io: Arc<Mutex<()>>,
    snapshot: Mutex<Snapshot>,
    wake: Arc<Notify>,
    stopping: AtomicBool,
    task: Mutex<Option<JoinHandle<()>>>,
}

impl Discovery {
    pub(crate) fn new(path: PathBuf) -> Arc<Self> {
        Arc::new(Self {
            path,
            io: Arc::new(Mutex::new(())),
            snapshot: Mutex::new(Snapshot::default()),
            wake: Arc::new(Notify::new()),
            stopping: AtomicBool::new(false),
            task: Mutex::new(None),
        })
    }

    pub(crate) async fn status(&self) -> Result<Snapshot, Error> {
        let (document, restored) = persistence::load(&self.path, &self.io).await?;
        let mut value = self.snapshot.lock().await.clone();
        if value.configuration != document || restored {
            value = Snapshot::for_configuration(document, restored);
        }
        Ok(value)
    }

    pub(crate) async fn save(&self, request: Save) -> Result<Snapshot, Error> {
        if self.stopping.load(Ordering::SeqCst) {
            return Err(Error::Stopping);
        }
        let (document, restored) =
            persistence::save(&self.path, &self.io, &self.wake, request).await?;
        // A later management write cannot replace this operation's acknowledgment.
        Ok(Snapshot::for_configuration(document, restored))
    }

    async fn publish(
        &self,
        configuration: &Document,
        candidates: Option<Vec<models::Candidate>>,
        error: Option<Error>,
    ) {
        // A late response from a replaced endpoint must never become its successor's inventory.
        let Ok((current, restored)) = persistence::load(&self.path, &self.io).await else {
            return;
        };
        if &current != configuration || restored {
            return;
        }
        let mut snapshot = self.snapshot.lock().await;
        if snapshot.configuration != current {
            *snapshot = Snapshot::for_configuration(current, false);
        }
        if let Some(candidates) = candidates {
            snapshot.candidates = candidates;
            snapshot.stale = false;
            snapshot.status = Status::Ready;
        } else {
            snapshot.stale = true;
            snapshot.status = Status::Unavailable;
        }
        snapshot.error = error;
    }
}

pub(crate) fn validate_configuration(value: &Configuration) -> Result<(), Error> {
    if value.enabled && value.endpoint.is_none() {
        return Err(Error::InvalidInput);
    }
    if let Some(endpoint) = &value.endpoint {
        client::validate_endpoint(endpoint)?;
    }
    Ok(())
}

#[cfg(test)]
#[path = "../../tests/private/docker_discovery/mod.rs"]
mod tests;
