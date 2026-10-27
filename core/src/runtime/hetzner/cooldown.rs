use super::{Api, Error, ErrorKind};
use aws_lc_rs::digest::{Context, SHA256};
use std::{
    collections::BTreeMap,
    sync::{LazyLock, Mutex},
    time::Duration,
};
use tokio::time::Instant;

const MAX_SCOPES: usize = 512;

#[derive(Clone, Copy)]
struct Pause {
    until: Instant,
    kind: ErrorKind,
}

#[derive(Default)]
struct Pauses {
    scopes: BTreeMap<[u8; 32], Pause>,
    overflow: Option<Pause>,
}

// Share pauses across DNS checks, immediate cleanup and DDNS clients. Keys are
// credential hashes, never token strings. Overflow conservatively pauses all
// scopes rather than discarding an unexpired provider instruction.
static PAUSES: LazyLock<Mutex<Pauses>> = LazyLock::new(|| Mutex::new(Pauses::default()));

fn scope(base: &reqwest::Url, token: &str) -> [u8; 32] {
    let mut hash = Context::new(&SHA256);
    hash.update(base.as_str().as_bytes());
    hash.update(&[0]);
    hash.update(token.as_bytes());
    let mut key = [0; 32];
    key.copy_from_slice(hash.finish().as_ref());
    key
}

impl Api<'_> {
    pub(super) fn paused(&self) -> Result<Option<Error>, Error> {
        let mut pauses = PAUSES.lock().map_err(|_| ErrorKind::Unavailable)?;
        let now = Instant::now();
        pauses.scopes.retain(|_, pause| pause.until > now);
        if pauses.overflow.is_some_and(|pause| pause.until <= now) {
            pauses.overflow = None;
        }
        let pause = pauses
            .scopes
            .get(&scope(self.base, self.token))
            .copied()
            .into_iter()
            .chain(pauses.overflow)
            .max_by_key(|pause| pause.until);
        Ok(pause.map(|pause| Error {
            kind: pause.kind,
            retry_after: Some(
                pause
                    .until
                    .duration_since(now)
                    .as_secs()
                    .saturating_add(1)
                    .min(86400) as u32,
            ),
        }))
    }

    pub(super) fn remember_pause(&self, error: Error) -> Result<(), Error> {
        let Some(seconds) = error.retry_after else {
            return Ok(());
        };
        let mut pauses = PAUSES.lock().map_err(|_| ErrorKind::Unavailable)?;
        let now = Instant::now();
        pauses.scopes.retain(|_, pause| pause.until > now);
        let key = scope(self.base, self.token);
        let pause = Pause {
            until: now + Duration::from_secs(u64::from(seconds.clamp(1, 86400))),
            kind: error.kind,
        };
        if let Some(previous) = pauses.scopes.get_mut(&key) {
            if pause.until > previous.until {
                *previous = pause;
            }
        } else if pauses.scopes.len() < MAX_SCOPES {
            pauses.scopes.insert(key, pause);
        } else if pauses
            .overflow
            .is_none_or(|previous| pause.until > previous.until)
        {
            pauses.overflow = Some(pause);
        }
        Ok(())
    }
}

#[cfg(test)]
pub(in crate::runtime) fn clear_pause_for_test(base: &reqwest::Url, token: &str) {
    PAUSES.lock().unwrap().scopes.remove(&scope(base, token));
}
