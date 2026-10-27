use super::{Api, Error, ErrorKind, Page, Rrset, Zone, models};
use reqwest::{Method, StatusCode, Url};
use serde::de::DeserializeOwned;
use std::{collections::BTreeSet, time::Duration};
use tokio::time::{Instant, sleep, timeout_at};

const MAX_BODY: usize = 512 * 1024;
const MAX_REQUEST: usize = 512 * 1024;

impl Api<'_> {
    pub(super) fn url(&self, parts: &[&str]) -> Result<Url, Error> {
        let mut url = self.base.clone();
        url.path_segments_mut()
            .map_err(|_| ErrorKind::InvalidResponse)?
            .pop_if_empty()
            .extend(parts.iter().copied());
        Ok(url)
    }

    pub(super) async fn request<T: DeserializeOwned>(
        &self,
        method: Method,
        url: Url,
        body: Option<serde_json::Value>,
    ) -> Result<T, Error> {
        let bytes = body
            .map(|body| serde_json::to_vec(&body).map_err(|_| ErrorKind::InvalidResponse))
            .transpose()?;
        if bytes
            .as_ref()
            .is_some_and(|bytes| bytes.len() > MAX_REQUEST)
        {
            return Err(ErrorKind::InvalidResponse.into());
        }
        let is_read = method == Method::GET;
        let mut attempt = 0;
        loop {
            if Instant::now() >= self.deadline {
                return Err(ErrorKind::TimeBudgetExceeded.into());
            }
            if let Some(error) = self.paused()? {
                return Err(error);
            }
            attempt += 1;
            let result = timeout_at(
                self.deadline.min(Instant::now() + Duration::from_secs(5)),
                async {
                    let mut request = self
                        .client
                        .request(method.clone(), url.clone())
                        .bearer_auth(self.token)
                        .header(reqwest::header::ACCEPT, "application/json");
                    if let Some(bytes) = &bytes {
                        request = request
                            .header(reqwest::header::CONTENT_TYPE, "application/json")
                            .body(bytes.clone());
                    }
                    let mut response = request.send().await.map_err(|_| ErrorKind::Unavailable)?;
                    let status = response.status();
                    if !status.is_success() {
                        let kind = match status {
                            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => {
                                ErrorKind::Unauthorized
                            }
                            StatusCode::TOO_MANY_REQUESTS => ErrorKind::RateLimited,
                            StatusCode::NOT_FOUND => ErrorKind::NotFound,
                            StatusCode::CONFLICT => ErrorKind::Conflict,
                            _ => ErrorKind::Unavailable,
                        };
                        return Err(Error {
                            kind,
                            retry_after: retry_after(response.headers(), status).or_else(|| {
                                (status == StatusCode::TOO_MANY_REQUESTS).then_some(60)
                            }),
                        });
                    }
                    let mut result = Vec::new();
                    while let Some(chunk) =
                        response.chunk().await.map_err(|_| ErrorKind::Unavailable)?
                    {
                        if chunk.len() > MAX_BODY.saturating_sub(result.len()) {
                            return Err(ErrorKind::InvalidResponse.into());
                        }
                        result.extend_from_slice(&chunk);
                    }
                    serde_json::from_slice(&result).map_err(|_| ErrorKind::InvalidResponse.into())
                },
            )
            .await
            .unwrap_or_else(|_| Err(ErrorKind::TimeBudgetExceeded.into()));
            if let Err(error) = &result {
                self.remember_pause(*error)?;
            }
            // Only GET can be replayed. Mutation uncertainty is resolved by callers
            // using read-back, never a second POST with an unknown first outcome.
            if is_read
                && attempt < 2
                && result.as_ref().is_err_and(|error: &Error| {
                    error.kind == ErrorKind::Unavailable && error.retry_after.is_none()
                })
                && Instant::now() + Duration::from_millis(200) < self.deadline
            {
                sleep(Duration::from_millis(200)).await;
                continue;
            }
            return result.map_err(|mut error| {
                if !is_read
                    && matches!(
                        error.kind,
                        ErrorKind::Unavailable | ErrorKind::TimeBudgetExceeded
                    )
                {
                    error.kind = ErrorKind::WriteUnconfirmed;
                }
                error
            });
        }
    }

    pub(in crate::runtime) async fn zones_page(&self, page: u32) -> Result<Page<Zone>, Error> {
        let mut url = self.url(&["zones"])?;
        url.query_pairs_mut()
            .append_pair("page", &page.to_string())
            .append_pair("per_page", "50")
            .append_pair("mode", "primary");
        let response = self.request(Method::GET, url, None).await?;
        let mut page = models::page::<Zone>(response, "zones", page)?;
        for zone in &mut page.items {
            zone.validate()?;
        }
        Ok(page)
    }

    pub(in crate::runtime) async fn zone(&self, id: &str) -> Result<Zone, Error> {
        if !models::valid_id(id) {
            return Err(ErrorKind::InvalidResponse.into());
        }
        let response: serde_json::Value = self
            .request(Method::GET, self.url(&["zones", id])?, None)
            .await?;
        let mut zone: Zone = serde_json::from_value(
            response
                .get("zone")
                .ok_or(ErrorKind::InvalidResponse)?
                .clone(),
        )
        .map_err(|_| ErrorKind::InvalidResponse)?;
        zone.validate()?;
        if zone.id.to_string() != id || zone.mode != "primary" {
            return Err(ErrorKind::InvalidResponse.into());
        }
        Ok(zone)
    }

    pub(super) fn rrset_url(&self, zone: &str, name: &str, kind: &str) -> Result<Url, Error> {
        if !models::valid_id(zone) || !models::valid_name(name) || !models::valid_kind(kind) {
            return Err(ErrorKind::InvalidResponse.into());
        }
        self.url(&["zones", zone, "rrsets", name, kind])
    }

    pub(in crate::runtime) async fn rrset(
        &self,
        zone: &str,
        name: &str,
        kind: &str,
    ) -> Result<Option<Rrset>, Error> {
        let response: serde_json::Value = match self
            .request(Method::GET, self.rrset_url(zone, name, kind)?, None)
            .await
        {
            Ok(response) => response,
            Err(error) if error.kind == ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error),
        };
        let mut rrset: Rrset = serde_json::from_value(
            response
                .get("rrset")
                .ok_or(ErrorKind::InvalidResponse)?
                .clone(),
        )
        .map_err(|_| ErrorKind::InvalidResponse)?;
        rrset.validate(zone, name, Some(kind))?;
        Ok(Some(rrset))
    }

    pub(in crate::runtime) async fn rrsets(
        &self,
        zone: &str,
        name: &str,
    ) -> Result<Vec<Rrset>, Error> {
        if !models::valid_id(zone) || !models::valid_name(name) {
            return Err(ErrorKind::InvalidResponse.into());
        }
        let mut url = self.url(&["zones", zone, "rrsets"])?;
        url.query_pairs_mut()
            .append_pair("name", name)
            .append_pair("page", "1")
            .append_pair("per_page", "50");
        let response = self.request(Method::GET, url, None).await?;
        let mut page = models::page::<Rrset>(response, "rrsets", 1)?;
        if page.next_page.is_some() {
            return Err(ErrorKind::InvalidResponse.into());
        }
        let mut kinds = BTreeSet::new();
        for rrset in &mut page.items {
            rrset.validate(zone, name, None)?;
            if !kinds.insert(rrset.kind.clone()) {
                return Err(ErrorKind::InvalidResponse.into());
            }
        }
        Ok(page.items)
    }
}

fn retry_after(headers: &reqwest::header::HeaderMap, status: StatusCode) -> Option<u32> {
    if let Some(seconds) = headers
        .get(reqwest::header::RETRY_AFTER)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
    {
        return Some(seconds.clamp(1, 86400) as u32);
    }
    if status != StatusCode::TOO_MANY_REQUESTS {
        return None;
    }
    let reset = headers
        .get("ratelimit-reset")?
        .to_str()
        .ok()?
        .parse::<i64>()
        .ok()?;
    let now = time::OffsetDateTime::now_utc().unix_timestamp();
    Some(reset.saturating_sub(now).clamp(1, 86400) as u32)
}
