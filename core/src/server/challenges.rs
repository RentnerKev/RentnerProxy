use std::{collections::BTreeMap, sync::Arc, time::Duration};

use tokio::{sync::Mutex, time::Instant};

use crate::{proxy::is_canonical_domain, runtime::CertificateError};

const MAX_CHALLENGES: usize = 4096;

#[derive(Clone)]
pub(crate) struct ChallengeStore {
    entries: Arc<Mutex<BTreeMap<(String, String), ChallengeValue>>>,
}

#[derive(Clone)]
struct ChallengeValue {
    value: String,
    expires_at: Instant,
}

impl ChallengeStore {
    pub(crate) fn new() -> Self {
        Self {
            entries: Arc::new(Mutex::new(BTreeMap::new())),
        }
    }

    pub(crate) async fn insert(
        &self,
        domain: String,
        token: String,
        value: String,
    ) -> Result<(), CertificateError> {
        if !is_canonical_domain(&domain)
            || !(1..=128).contains(&token.len())
            || !token.bytes().all(is_base64url)
            || value.len() > 2048
            || value
                .strip_prefix(&format!("{token}."))
                .is_none_or(|proof| proof.is_empty() || !proof.bytes().all(is_base64url))
        {
            return Err(CertificateError::AcmeFailed);
        }
        let mut entries = self.entries.lock().await;
        entries.retain(|_, value| value.expires_at > Instant::now());
        let key = (domain, token);
        if entries.len() >= MAX_CHALLENGES || entries.contains_key(&key) {
            return Err(CertificateError::AcmeFailed);
        }
        entries.insert(
            key,
            ChallengeValue {
                value,
                expires_at: Instant::now() + Duration::from_secs(15 * 60),
            },
        );
        Ok(())
    }

    pub(crate) async fn get(&self, domain: &str, token: &str) -> Option<String> {
        let mut entries = self.entries.lock().await;
        entries.retain(|_, value| value.expires_at > Instant::now());
        entries
            .get(&(domain.to_owned(), token.to_owned()))
            .map(|value| value.value.clone())
    }

    pub(crate) async fn remove(&self, domain: &str, token: &str) {
        self.entries
            .lock()
            .await
            .remove(&(domain.to_owned(), token.to_owned()));
    }
}

fn is_base64url(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_')
}
