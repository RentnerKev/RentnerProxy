use super::{Api, Error, ErrorKind, Record, Rrset, models};
use reqwest::Method;
use serde::Deserialize;
use std::time::Duration;
use tokio::time::{Instant, sleep_until};

#[derive(Deserialize)]
struct Resource {
    id: u64,
    #[serde(rename = "type")]
    kind: String,
}
#[derive(Deserialize)]
struct Action {
    id: u64,
    status: String,
    resources: Vec<Resource>,
    error: Option<serde_json::Value>,
}
impl Action {
    fn validate(&self, zone: &str, expected_id: Option<u64>) -> Result<(), Error> {
        if self.id == 0
            || self.id > i64::MAX as u64
            || expected_id.is_some_and(|id| id != self.id)
            || !matches!(self.status.as_str(), "running" | "success" | "error")
            || self.resources.is_empty()
            || self.resources.len() > 100
            || !self
                .resources
                .iter()
                .any(|resource| resource.kind == "zone" && resource.id.to_string() == zone)
            || self
                .resources
                .iter()
                .any(|resource| resource.kind == "zone" && resource.id.to_string() != zone)
            || (self.status == "success"
                && self.error.as_ref().is_some_and(|error| !error.is_null()))
        {
            return Err(ErrorKind::InvalidResponse.into());
        }
        Ok(())
    }
}

impl Api<'_> {
    async fn wait_action(&self, response: serde_json::Value, zone: &str) -> Result<(), Error> {
        let mut action: Action = serde_json::from_value(
            response
                .get("action")
                .ok_or(ErrorKind::InvalidResponse)?
                .clone(),
        )
        .map_err(|_| ErrorKind::InvalidResponse)?;
        action.validate(zone, None)?;
        let id = action.id;
        for poll in 0..32 {
            match action.status.as_str() {
                "success" => return Ok(()),
                "error" => return Err(ErrorKind::Unavailable.into()),
                _ => {}
            }
            let delay = Duration::from_millis((100u64 << poll.min(4)).min(1000));
            let next = Instant::now() + delay;
            if next >= self.deadline {
                return Err(ErrorKind::TimeBudgetExceeded.into());
            }
            sleep_until(next).await;
            let response: serde_json::Value = self
                .request(Method::GET, self.url(&["actions", &id.to_string()])?, None)
                .await
                .map_err(|mut error| {
                    // The POST was accepted. A later poll rejection cannot prove
                    // that the mutation was rejected; retain any provider pause.
                    if error.kind == ErrorKind::RateLimited {
                        error.retry_after = Some(error.retry_after.unwrap_or(60));
                    }
                    error.kind = ErrorKind::WriteUnconfirmed;
                    error
                })?;
            action = serde_json::from_value(
                response
                    .get("action")
                    .ok_or(ErrorKind::InvalidResponse)?
                    .clone(),
            )
            .map_err(|_| ErrorKind::InvalidResponse)?;
            action.validate(zone, Some(id))?;
        }
        Err(ErrorKind::TimeBudgetExceeded.into())
    }

    pub(in crate::runtime) async fn create_rrset(
        &self,
        zone: &str,
        name: &str,
        kind: &str,
        ttl: Option<u32>,
        records: &[Record],
    ) -> Result<(), Error> {
        self.rrset_url(zone, name, kind)?;
        models::validate_records(records)?;
        if records.is_empty() || ttl.is_some_and(|ttl| ttl < 60) {
            return Err(ErrorKind::InvalidResponse.into());
        }
        let body = serde_json::json!({"name":name,"type":kind,"ttl":ttl,"records":records});
        let response: serde_json::Value = self
            .request(
                Method::POST,
                self.url(&["zones", zone, "rrsets"])?,
                Some(body),
            )
            .await?;
        let mut rrset: Rrset = serde_json::from_value(
            response
                .get("rrset")
                .ok_or(ErrorKind::InvalidResponse)?
                .clone(),
        )
        .map_err(|_| ErrorKind::InvalidResponse)?;
        rrset.validate(zone, name, Some(kind))?;
        self.wait_action(response, zone).await
    }

    async fn mutate_records(
        &self,
        zone: &str,
        name: &str,
        kind: &str,
        operation: &str,
        records: &[Record],
    ) -> Result<(), Error> {
        self.rrset_url(zone, name, kind)?;
        models::validate_records(records)?;
        if records.is_empty() {
            return Err(ErrorKind::InvalidResponse.into());
        }
        let url = self.url(&["zones", zone, "rrsets", name, kind, "actions", operation])?;
        let response = self
            .request(
                Method::POST,
                url,
                Some(serde_json::json!({"records":records})),
            )
            .await?;
        self.wait_action(response, zone).await
    }

    pub(in crate::runtime) async fn add_records(
        &self,
        zone: &str,
        name: &str,
        kind: &str,
        records: &[Record],
    ) -> Result<(), Error> {
        self.mutate_records(zone, name, kind, "add_records", records)
            .await
    }
    pub(in crate::runtime) async fn remove_records(
        &self,
        zone: &str,
        name: &str,
        kind: &str,
        records: &[Record],
    ) -> Result<(), Error> {
        self.mutate_records(zone, name, kind, "remove_records", records)
            .await
    }
    pub(in crate::runtime) async fn set_records(
        &self,
        zone: &str,
        name: &str,
        kind: &str,
        records: &[Record],
    ) -> Result<(), Error> {
        self.mutate_records(zone, name, kind, "set_records", records)
            .await
    }
}
