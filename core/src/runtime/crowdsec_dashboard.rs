use std::{collections::BTreeSet, time::Duration};

use reqwest::{StatusCode, Url, redirect::Policy};
use serde::{Deserialize, Serialize};

use crate::models::SecretString;

use super::{ProxyRuntime, crowdsec::ActiveProvider};

mod decisions;
mod metrics;

use decisions::parse_decisions;
use metrics::parse_metrics;

const MAX_DECISIONS_RESPONSE_BYTES: usize = 16 * 1024 * 1024;
const MAX_PAGE_SIZE: usize = 100;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const DASHBOARD_CACHE_TTL: Duration = Duration::from_secs(15);

pub(super) struct CrowdSecDashboardCache {
    fetched_at: tokio::time::Instant,
    provider: ActiveProvider,
    data: DashboardData,
}

#[derive(Deserialize)]
#[serde(default, deny_unknown_fields)]
pub(crate) struct CrowdSecDashboardQuery {
    pub(crate) offset: usize,
    #[serde(default = "default_page_size")]
    pub(crate) limit: usize,
    pub(crate) search: String,
    pub(crate) origin: String,
    pub(crate) scope: String,
    pub(crate) include_all: bool,
}

impl Default for CrowdSecDashboardQuery {
    fn default() -> Self {
        Self {
            offset: 0,
            limit: default_page_size(),
            search: String::new(),
            origin: String::new(),
            scope: String::new(),
            include_all: false,
        }
    }
}

fn default_page_size() -> usize {
    15
}

impl CrowdSecDashboardQuery {
    pub(crate) fn validate(&self) -> bool {
        self.limit > 0
            && self.limit <= MAX_PAGE_SIZE
            && self.offset <= 1_000_000
            && (!self.include_all || self.offset == 0)
            && self.search.chars().count() <= 200
            && !self.search.chars().any(char::is_control)
            && safe_label(&self.origin, 80).is_some()
            && matches!(self.scope.as_str(), "" | "Ip" | "Range")
    }
}

struct DashboardData {
    collected_at: i64,
    metrics: Option<DashboardMetrics>,
    decisions: Option<Vec<DecisionEntry>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CrowdSecDashboardSnapshot {
    collected_at: i64,
    metrics: Option<DashboardMetrics>,
    decisions: Option<DashboardDecisions>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DashboardMetrics {
    blocked_requests: Option<u64>,
    active_decisions: Option<u64>,
    blocked_by_origin: Vec<OriginCount>,
    decisions_by_origin: Vec<OriginCount>,
}

#[derive(Clone, Serialize)]
struct OriginCount {
    origin: String,
    count: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DashboardDecisions {
    total: usize,
    filtered_total: usize,
    offset: usize,
    limit: usize,
    available_origins: Vec<String>,
    entries: Vec<DecisionEntry>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DecisionEntry {
    id: u64,
    scope: &'static str,
    value: String,
    origin: String,
    scenario: String,
    duration: String,
    country_code: Option<String>,
}

impl ProxyRuntime {
    pub(crate) async fn crowdsec_dashboard(
        &self,
        query: &CrowdSecDashboardQuery,
    ) -> CrowdSecDashboardSnapshot {
        let collected_at = time::OffsetDateTime::now_utc().unix_timestamp();
        let provider = self.active_crowdsec_provider().await;
        let (Some(api_url), Some(api_key)) = (provider.api_url(), provider.api_key()) else {
            return CrowdSecDashboardSnapshot {
                collected_at,
                metrics: None,
                decisions: None,
            };
        };

        let mut cache = self.crowdsec_dashboard_cache.lock().await;
        if let Some(previous) = cache.as_ref()
            && previous.provider == provider
            && previous.fetched_at.elapsed() < DASHBOARD_CACHE_TTL
        {
            return snapshot_for(&previous.data, query);
        }

        let metrics_request = async {
            let engine = self.engine.as_ref()?;
            let body = tokio::time::timeout(Duration::from_secs(4), engine.metrics())
                .await
                .ok()?
                .ok()?;
            parse_metrics(&body)
        };
        let decisions_request = fetch_decisions(api_url, api_key);
        let (metrics, decisions) = tokio::join!(metrics_request, decisions_request);
        let data = DashboardData {
            collected_at,
            metrics,
            decisions,
        };
        if self.active_crowdsec_provider().await != provider {
            return CrowdSecDashboardSnapshot {
                collected_at: time::OffsetDateTime::now_utc().unix_timestamp(),
                metrics: None,
                decisions: None,
            };
        }
        let snapshot = snapshot_for(&data, query);
        *cache = Some(CrowdSecDashboardCache {
            fetched_at: tokio::time::Instant::now(),
            provider,
            data,
        });
        snapshot
    }
}

fn snapshot_for(data: &DashboardData, query: &CrowdSecDashboardQuery) -> CrowdSecDashboardSnapshot {
    let decisions = data.decisions.as_ref().map(|entries| {
        let search = query.search.to_ascii_lowercase();
        let matching = entries
            .iter()
            .filter(|entry| {
                (query.origin.is_empty() || entry.origin.eq_ignore_ascii_case(&query.origin))
                    && (query.scope.is_empty() || entry.scope == query.scope)
                    && (search.is_empty()
                        || entry.value.to_ascii_lowercase().contains(&search)
                        || entry.origin.to_ascii_lowercase().contains(&search)
                        || entry.scenario.to_ascii_lowercase().contains(&search))
            })
            .collect::<Vec<_>>();
        // Country lookup runs in the web server. Its internal snapshot must include
        // all matches before country filtering and pagination, bounded by the LAPI body limit.
        let limit = if query.include_all {
            matching.len()
        } else {
            query.limit
        };
        DashboardDecisions {
            total: entries.len(),
            filtered_total: matching.len(),
            offset: query.offset,
            limit: query.limit,
            available_origins: entries
                .iter()
                .map(|entry| entry.origin.clone())
                .collect::<BTreeSet<_>>()
                .into_iter()
                .take(100)
                .collect(),
            entries: matching
                .into_iter()
                .skip(query.offset)
                .take(limit)
                .cloned()
                .collect(),
        }
    });
    CrowdSecDashboardSnapshot {
        collected_at: data.collected_at,
        metrics: data.metrics.clone(),
        decisions,
    }
}

fn safe_label(value: &str, max_len: usize) -> Option<String> {
    (value.len() <= max_len && !value.chars().any(char::is_control)).then(|| value.to_owned())
}

async fn fetch_decisions(api_url: &str, api_key: &SecretString) -> Option<Vec<DecisionEntry>> {
    crate::runtime::tls::ensure_crypto_provider();
    let api_url = super::crowdsec::normalize_api_url(api_url).ok()?;
    let endpoint = Url::parse(&api_url).ok()?.join("v1/decisions").ok()?;
    let client = reqwest::Client::builder()
        .redirect(Policy::none())
        .no_proxy()
        .connect_timeout(Duration::from_secs(2))
        .timeout(Duration::from_secs(5))
        .build()
        .ok()?;
    let mut response = client
        .get(endpoint)
        .header("X-Api-Key", api_key.expose())
        .header("Accept", "application/json")
        .send()
        .await
        .ok()?;
    if response.status() != StatusCode::OK
        || response
            .content_length()
            .is_some_and(|length| length > MAX_DECISIONS_RESPONSE_BYTES as u64)
    {
        return None;
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.ok()? {
        if body.len().saturating_add(chunk.len()) > MAX_DECISIONS_RESPONSE_BYTES {
            return None;
        }
        body.extend_from_slice(&chunk);
    }
    parse_decisions(&body)
}

#[cfg(test)]
#[path = "../../tests/private/crowdsec_dashboard.rs"]
mod tests;
