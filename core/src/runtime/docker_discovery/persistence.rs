use super::{models::*, validate_configuration};
use crate::{proxy::is_canonical_uuid_v7, runtime::state::state_dir};
use std::{io::ErrorKind, path::Path, sync::Arc};
use tokio::sync::{Mutex, Notify};

const FILE: &str = "docker-discovery.json";
const PAUSE: &str = "docker-discovery-restore-paused";

fn read(path: &Path) -> Result<(Document, bool), Error> {
    let dir = state_dir(path).map_err(|_| Error::StoreUnavailable)?;
    let document: Document = match dir.read_file(FILE, 4_096) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| Error::StoreUnavailable)?,
        Err(e) if e.kind() == ErrorKind::NotFound => Document::default(),
        Err(_) => return Err(Error::StoreUnavailable),
    };
    if document.version != 1 || validate_configuration(&document.settings).is_err() {
        return Err(Error::StoreUnavailable);
    }
    let restored = match dir.read_file(PAUSE, 128) {
        Ok(_) => true,
        Err(e) if e.kind() == ErrorKind::NotFound => false,
        Err(_) => return Err(Error::StoreUnavailable),
    };
    Ok((document, restored))
}
pub(super) async fn load(path: &Path, io: &Arc<Mutex<()>>) -> Result<(Document, bool), Error> {
    let path = path.to_owned();
    let guard = Arc::clone(io).lock_owned().await;
    tokio::task::spawn_blocking(move || {
        let _guard = guard;
        read(&path)
    })
    .await
    .map_err(|_| Error::StoreUnavailable)?
}
pub(super) async fn save(
    path: &Path,
    io: &Arc<Mutex<()>>,
    wake: &Arc<Notify>,
    request: Save,
) -> Result<(), Error> {
    if !is_canonical_uuid_v7(&request.actor_user_id) {
        return Err(Error::InvalidInput);
    }
    validate_configuration(&request.configuration)?;
    let path = path.to_owned();
    let wake = Arc::clone(wake);
    let guard = Arc::clone(io).lock_owned().await;
    tokio::task::spawn_blocking(move || {
        // The entire compare-and-replace is non-cancellable and serialized with readers.
        let _guard = guard;
        let (current, restored) = read(&path)?;
        if current.revision != request.expected_revision {
            return Err(Error::Conflict);
        }
        if restored && request.configuration.enabled && !request.acknowledge_restore {
            return Err(Error::Conflict);
        }
        let next = Document {
            version: 1,
            revision: current.revision.checked_add(1).ok_or(Error::Conflict)?,
            settings: request.configuration,
        };
        let dir = state_dir(&path).map_err(|_| Error::StoreUnavailable)?;
        let bytes = serde_json::to_vec(&next).map_err(|_| Error::StoreUnavailable)?;
        let result = dir
            .atomic_write(FILE, &bytes)
            .map_err(|_| Error::StoreUnavailable)
            .and_then(|()| {
                if restored && next.settings.enabled && request.acknowledge_restore {
                    dir.remove_file(PAUSE)
                        .map_err(|_| Error::StoreUnavailable)?;
                }
                Ok(())
            });
        // Even an uncertain write or a disconnected management caller requires a fresh read.
        wake.notify_one();
        result
    })
    .await
    .map_err(|_| Error::StoreUnavailable)?
}
