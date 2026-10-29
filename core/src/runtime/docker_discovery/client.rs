use super::{labels, models::*};
use reqwest::{Client, Response, Url, redirect::Policy};
use serde::de::DeserializeOwned;
use std::{collections::BTreeSet, time::Duration};

const API: &str = "/v1.47";
const MAX_CONTAINERS: usize = 256;
const MAX_RESPONSE: usize = 2 * 1024 * 1024;
const FILTER: &str = r#"{"label":["rentnerproxy.enable=true"]}"#;

pub(super) fn validate_endpoint(value: &str) -> Result<(), Error> {
    if value.starts_with("unix:") {
        unix_socket_path(value)?;
        return if cfg!(unix) {
            Ok(())
        } else {
            Err(Error::InvalidInput)
        };
    }
    let url = Url::parse(value).map_err(|_| Error::InvalidInput)?;
    if value.len() > 512
        || value != value.trim()
        || !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
        || value.contains(['\\', '\r', '\n', '\t'])
        || url.port() == Some(0)
    {
        return Err(Error::InvalidInput);
    }
    Ok(())
}

fn unix_socket_path(value: &str) -> Result<&str, Error> {
    let path = value.strip_prefix("unix://").ok_or(Error::InvalidInput)?;
    if value.len() > 512
        || value.chars().any(char::is_control)
        || value.contains(['\\', '?', '#', '%'])
        || value != value.trim()
        || !path.starts_with('/')
        || path
            .split('/')
            .skip(1)
            .any(|part| matches!(part, "" | "." | ".."))
    {
        return Err(Error::InvalidInput);
    }
    Ok(path)
}

pub(super) struct Docker {
    client: Client,
    endpoint: Url,
}
impl Docker {
    pub(super) fn new(endpoint: &str) -> Result<Self, Error> {
        validate_endpoint(endpoint)?;
        super::super::tls::ensure_crypto_provider();
        let builder = Client::builder()
            .retry(reqwest::retry::never())
            .no_proxy()
            .redirect(Policy::none())
            .connect_timeout(Duration::from_secs(3))
            .pool_max_idle_per_host(2);
        let (builder, endpoint) = if endpoint.starts_with("unix:") {
            #[cfg(unix)]
            {
                (
                    builder.unix_socket(unix_socket_path(endpoint)?),
                    Url::parse("http://localhost/").map_err(|_| Error::InvalidInput)?,
                )
            }
            #[cfg(not(unix))]
            {
                return Err(Error::InvalidInput);
            }
        } else {
            (
                builder,
                Url::parse(endpoint).map_err(|_| Error::InvalidInput)?,
            )
        };
        Ok(Self {
            client: builder.build().map_err(|_| Error::EndpointUnavailable)?,
            endpoint,
        })
    }
    // There is deliberately no generic method/body/path API. Only these three GET capabilities
    // exist; container IDs are validated before becoming URL path segments.
    async fn get(&self, path: &str, query: &[(&str, String)]) -> Result<Option<Response>, Error> {
        let mut url = self.endpoint.clone();
        url.set_path(&format!("{API}{path}"));
        if !query.is_empty() {
            url.query_pairs_mut()
                .extend_pairs(query.iter().map(|(k, v)| (*k, v.as_str())));
        }
        let response = tokio::time::timeout(
            Duration::from_secs(5),
            self.client
                .get(url)
                .header("accept", "application/json")
                .send(),
        )
        .await
        .map_err(|_| Error::EndpointUnavailable)?
        .map_err(|_| Error::EndpointUnavailable)?;
        if response.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !response.status().is_success() {
            return Err(Error::EndpointUnavailable);
        }
        Ok(Some(response))
    }
    pub(super) async fn inventory(&self) -> Result<Vec<Candidate>, Error> {
        tokio::time::timeout(Duration::from_secs(30), self.read_inventory())
            .await
            .map_err(|_| Error::EndpointUnavailable)?
    }
    async fn read_inventory(&self) -> Result<Vec<Candidate>, Error> {
        let summaries: Vec<Summary> = json(
            self.get(
                "/containers/json",
                &[("all", "1".into()), ("filters", FILTER.into())],
            )
            .await?
            .ok_or(Error::EndpointUnavailable)?,
        )
        .await?;
        if summaries.len() > MAX_CONTAINERS {
            return Err(Error::InventoryTooLarge);
        }
        let mut seen = BTreeSet::new();
        let mut candidates = Vec::new();
        for summary in summaries {
            if !labels::container_id(&summary.id) || !seen.insert(summary.id.clone()) {
                return Err(Error::InvalidResponse);
            }
            // Defense in depth: a proxy/daemon ignoring filters still cannot opt in an unlabeled container.
            if summary.labels.get(labels::ENABLE).map(String::as_str) != Some("true") {
                continue;
            }
            let Some(response) = self
                .get(&format!("/containers/{}/json", summary.id), &[])
                .await?
            else {
                // A confirmed 404 during a Compose recreate removes only this candidate.
                // Authorization, transport and other failures still invalidate the complete scan.
                continue;
            };
            let container: Container = json(response).await?;
            if container.id != summary.id {
                return Err(Error::InvalidResponse);
            }
            if let Some(candidate) = labels::candidate(container) {
                candidates.push(candidate);
            }
        }
        candidates.sort_by(|a, b| a.container_id.cmp(&b.container_id));
        labels::conflicts(&mut candidates);
        if serde_json::to_vec(&candidates)
            .map_err(|_| Error::InvalidResponse)?
            .len()
            > 900_000
        {
            return Err(Error::InventoryTooLarge);
        }
        Ok(candidates)
    }
    pub(super) async fn events(&self) -> Result<Response, Error> {
        let since = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| Error::EndpointUnavailable)?
            .as_secs()
            .to_string();
        self.get(
            "/events",
            &[
                ("since", since),
                ("filters", r#"{"type":["container","network"],"event":["create","start","stop","die","destroy","rename","update","pause","unpause","connect","disconnect"]}"#.into()),
            ],
        )
        .await?.ok_or(Error::EndpointUnavailable)
    }
}
async fn json<T: DeserializeOwned>(mut response: Response) -> Result<T, Error> {
    tokio::time::timeout(Duration::from_secs(5), async move {
        if response
            .content_length()
            .is_some_and(|n| n > MAX_RESPONSE as u64)
        {
            return Err(Error::InvalidResponse);
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| Error::EndpointUnavailable)?
        {
            if bytes.len().saturating_add(chunk.len()) > MAX_RESPONSE {
                return Err(Error::InvalidResponse);
            }
            bytes.extend_from_slice(&chunk);
        }
        serde_json::from_slice(&bytes).map_err(|_| Error::InvalidResponse)
    })
    .await
    .map_err(|_| Error::EndpointUnavailable)?
}

#[derive(Default)]
pub(super) struct Events {
    pending: Vec<u8>,
    seen: BTreeSet<(String, String, String, u64)>,
    bytes: usize,
    count: usize,
}
#[derive(Debug, PartialEq, Eq)]
pub(super) enum EventUpdate {
    Unchanged,
    Changed,
    Reconnect,
}
impl Events {
    pub(super) fn push(&mut self, bytes: &[u8]) -> Result<EventUpdate, Error> {
        self.bytes = self.bytes.saturating_add(bytes.len());
        if self.bytes > MAX_RESPONSE {
            return Ok(EventUpdate::Reconnect);
        }
        let mut changed = false;
        for byte in bytes {
            if *byte != b'\n' {
                if self.pending.len() >= 16_384 {
                    return Ok(EventUpdate::Reconnect);
                }
                self.pending.push(*byte);
                continue;
            }
            if self.pending.is_empty() {
                continue;
            }
            #[derive(serde::Deserialize)]
            struct Event {
                #[serde(rename = "Type")]
                kind: String,
                #[serde(rename = "Action")]
                action: String,
            }
            #[derive(serde::Deserialize)]
            struct Actor {
                #[serde(rename = "ID")]
                id: String,
            }
            let event: Event =
                serde_json::from_slice(&self.pending).map_err(|_| Error::InvalidResponse)?;
            self.count += 1;
            if self.count > 4_096 {
                return Ok(EventUpdate::Reconnect);
            }
            let relevant = (event.kind == "container"
                && matches!(
                    event.action.as_str(),
                    "create"
                        | "start"
                        | "stop"
                        | "die"
                        | "destroy"
                        | "rename"
                        | "update"
                        | "pause"
                        | "unpause"
                ))
                || (event.kind == "network"
                    && matches!(event.action.as_str(), "connect" | "disconnect" | "destroy"));
            if !relevant {
                self.pending.clear();
                continue;
            }
            #[derive(serde::Deserialize)]
            struct Identity {
                #[serde(rename = "Actor")]
                actor: Actor,
                #[serde(rename = "timeNano")]
                time: u64,
            }
            let identity: Identity =
                serde_json::from_slice(&self.pending).map_err(|_| Error::InvalidResponse)?;
            self.pending.clear();
            if !labels::container_id(&identity.actor.id) {
                return Err(Error::InvalidResponse);
            }
            if self
                .seen
                .insert((event.kind, event.action, identity.actor.id, identity.time))
            {
                changed = true;
            }
            if self.seen.len() > 256 {
                self.seen.clear();
            }
        }
        Ok(if changed {
            EventUpdate::Changed
        } else {
            EventUpdate::Unchanged
        })
    }
}
