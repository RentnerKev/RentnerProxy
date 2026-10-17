use super::{
    http,
    models::{Error, Failure, RecordType, Target},
    validation,
};
use crate::runtime::dns::api::CloudflareResponse;
use reqwest::{Client, Method, Url};
use serde::Deserialize;
use std::{collections::BTreeSet, net::IpAddr};
use tokio::time::Instant;

#[derive(Clone, Debug, Deserialize)]
pub(super) struct Record {
    pub(super) id: String,
    pub(super) name: String,
    #[serde(rename = "type")]
    pub(super) kind: String,
    pub(super) content: String,
    pub(super) proxied: Option<bool>,
    pub(super) comment: Option<String>,
}
impl Record {
    pub(super) fn address(&self, family: RecordType) -> Result<IpAddr, Failure> {
        let address: IpAddr = self
            .content
            .parse()
            .map_err(|_| Error::InvalidProviderResponse)?;
        if !family.matches(address) || self.proxied.is_none() {
            return Err(Error::InvalidProviderResponse.into());
        }
        Ok(address)
    }
}

pub(super) struct Provider<'a> {
    client: Client,
    base: Url,
    token: &'a str,
    deadline: Instant,
}
impl<'a> Provider<'a> {
    pub(super) fn new(
        client: Client,
        endpoint: &str,
        token: &'a str,
        deadline: Instant,
    ) -> Result<Self, Failure> {
        Ok(Self {
            client,
            base: Url::parse(endpoint).map_err(|_| Error::ProviderUnavailable)?,
            token,
            deadline,
        })
    }
    async fn request<T: serde::de::DeserializeOwned>(
        &self,
        method: Method,
        url: Url,
        body: Option<serde_json::Value>,
    ) -> Result<T, Failure> {
        let mut request = self.client.request(method, url).bearer_auth(self.token);
        if let Some(body) = body {
            request = request.json(&body);
        }
        let bytes = http::send(request, self.deadline).await?;
        let response: CloudflareResponse<T> =
            serde_json::from_slice(&bytes).map_err(|_| Error::InvalidProviderResponse)?;
        if !response.success {
            return Err(
                if response.errors.iter().any(|error| error.is_unauthorized()) {
                    Error::ProviderUnauthorized
                } else {
                    Error::ProviderUnavailable
                }
                .into(),
            );
        }
        response
            .result
            .ok_or_else(|| Error::InvalidProviderResponse.into())
    }
    fn url(&self, target: &Target, suffix: &str) -> Result<Url, Failure> {
        self.base
            .join(&format!("zones/{}/dns_records{suffix}", target.zone_id))
            .map_err(|_| Error::ProviderUnavailable.into())
    }
    pub(super) async fn records(&self, target: &Target) -> Result<Vec<Record>, Failure> {
        let mut url = self.url(target, "")?;
        // Read all types at the exact owner, so CNAME and duplicate A/AAAA
        // conflicts are detected without ever modifying TXT or other records.
        url.query_pairs_mut()
            .append_pair("name", &target.name)
            .append_pair("per_page", "100")
            .append_pair("page", "1");
        let request = self.client.get(url).bearer_auth(self.token);
        let bytes = http::send(request, self.deadline).await?;
        let response: CloudflareResponse<Vec<Record>> =
            serde_json::from_slice(&bytes).map_err(|_| Error::InvalidProviderResponse)?;
        if !response.success {
            return Err(if response.errors.iter().any(|e| e.is_unauthorized()) {
                Error::ProviderUnauthorized
            } else {
                Error::ProviderUnavailable
            }
            .into());
        }
        let records = response.result.ok_or(Error::InvalidProviderResponse)?;
        let pagination = response.result_info.ok_or(Error::InvalidProviderResponse)?;
        if pagination.page != Some(1)
            || pagination.total_pages.is_none_or(|pages| pages > 1)
            || pagination.per_page != Some(100)
            || records.len() > 100
        {
            // An unexpectedly large exact-name result is ambiguous, never an
            // excuse to select a partial page and overwrite a record.
            return Err(Error::InvalidProviderResponse.into());
        }
        let mut ids = BTreeSet::new();
        for record in &records {
            if !validation::provider_id(&record.id)
                || !ids.insert(&record.id)
                || record.kind.is_empty()
                || record.kind.len() > 16
                || !record.kind.bytes().all(|b| b.is_ascii_uppercase())
                || !record
                    .name
                    .trim_end_matches('.')
                    .eq_ignore_ascii_case(&target.name)
            {
                return Err(Error::InvalidProviderResponse.into());
            }
        }
        Ok(records)
    }
    pub(super) async fn write(
        &self,
        target: &Target,
        address: IpAddr,
        record: Option<&Record>,
    ) -> Result<Record, Failure> {
        let (method, url, body) = if let Some(record) = record {
            (
                Method::PATCH,
                self.url(target, &format!("/{}", record.id))?,
                serde_json::json!({"content":address.to_string(),"proxied":target.proxied}),
            )
        } else {
            (
                Method::POST,
                self.url(target, "")?,
                serde_json::json!({"type":target.record_type.as_str(),"name":target.name,"content":address.to_string(),"proxied":target.proxied,"ttl":1,"comment":marker(target)}),
            )
        };
        let written: Record = self
            .request(method, url, Some(body))
            .await
            .map_err(|failure| {
                if matches!(
                    failure.code,
                    Error::ProviderUnauthorized
                        | Error::ProviderRateLimited
                        | Error::TimeBudgetExceeded
                ) {
                    failure
                } else {
                    Failure {
                        code: Error::WriteUnconfirmed,
                        ..failure
                    }
                }
            })?;
        if !validation::provider_id(&written.id)
            || !written
                .name
                .trim_end_matches('.')
                .eq_ignore_ascii_case(&target.name)
            || written.kind != target.record_type.as_str()
            || written.address(target.record_type).ok() != Some(address)
            || written.proxied != Some(target.proxied)
            || record.is_some_and(|record| record.id != written.id)
            || (record.is_none() && written.comment.as_deref() != Some(marker(target).as_str()))
        {
            return Err(Error::WriteUnconfirmed.into());
        }
        Ok(written)
    }
}
pub(super) fn marker(target: &Target) -> String {
    format!("rentnerproxy-ddns:{}", target.id)
}
