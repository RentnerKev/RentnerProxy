use std::{
    collections::{BTreeMap, BTreeSet},
    net::IpAddr,
    str::FromStr,
    time::Duration,
};

use ipnet::IpNet;
use reqwest::{StatusCode, Url, redirect::Policy};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::models::SecretString;

use super::{ProxyRuntime, crowdsec::ActiveProvider};

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
}

impl Default for CrowdSecDashboardQuery {
    fn default() -> Self {
        Self {
            offset: 0,
            limit: default_page_size(),
            search: String::new(),
            origin: String::new(),
            scope: String::new(),
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
                .take(query.limit)
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

fn parse_metrics(body: &[u8]) -> Option<DashboardMetrics> {
    let text = std::str::from_utf8(body).ok()?;
    let mut blocked_seen = false;
    let mut decisions_seen = false;
    let mut blocked = BTreeMap::new();
    let mut decisions = BTreeMap::new();

    for line in text.lines() {
        if line.starts_with("# HELP crowdsec_requests_blocked ")
            || line.starts_with("# TYPE crowdsec_requests_blocked ")
        {
            blocked_seen = true;
            continue;
        }
        if line.starts_with("# HELP crowdsec_decisions_active ")
            || line.starts_with("# TYPE crowdsec_decisions_active ")
        {
            decisions_seen = true;
            continue;
        }
        let Some((name, labels, sample)) = metric_sample(line) else {
            continue;
        };
        let target = match name {
            "crowdsec_requests_blocked" | "crowdsec_requests_blocked_total" => {
                blocked_seen = true;
                &mut blocked
            }
            "crowdsec_decisions_active" => {
                decisions_seen = true;
                &mut decisions
            }
            _ => continue,
        };
        let count = sample.parse::<f64>().ok()?;
        if !count.is_finite() || count < 0.0 || count > MAX_SAFE_INTEGER as f64 {
            return None;
        }
        let origin = origin_label(labels);
        let current = target.entry(origin).or_insert(0u64);
        *current = current.checked_add(count as u64)?;
        if *current > MAX_SAFE_INTEGER {
            return None;
        }
    }

    if !blocked_seen && !decisions_seen {
        return None;
    }
    Some(DashboardMetrics {
        blocked_requests: blocked_seen.then(|| total_count(&blocked)).flatten(),
        active_decisions: decisions_seen.then(|| total_count(&decisions)).flatten(),
        blocked_by_origin: ranked_origins(blocked),
        decisions_by_origin: ranked_origins(decisions),
    })
}

fn total_count(values: &BTreeMap<String, u64>) -> Option<u64> {
    values
        .values()
        .try_fold(0u64, |sum, value| sum.checked_add(*value))
        .filter(|sum| *sum <= MAX_SAFE_INTEGER)
}

fn ranked_origins(values: BTreeMap<String, u64>) -> Vec<OriginCount> {
    let mut ranked = values
        .into_iter()
        .map(|(origin, count)| OriginCount { origin, count })
        .collect::<Vec<_>>();
    ranked.sort_by(|left, right| {
        right
            .count
            .cmp(&left.count)
            .then(left.origin.cmp(&right.origin))
    });
    ranked.truncate(12);
    ranked
}

fn metric_sample(line: &str) -> Option<(&str, &str, &str)> {
    if line.starts_with('#') || line.is_empty() {
        return None;
    }
    let end = line.find(char::is_whitespace)?;
    let identifier = &line[..end];
    let sample = line[end..].split_whitespace().next()?;
    if let Some(start) = identifier.find('{') {
        let labels = identifier.get(start + 1..identifier.len().checked_sub(1)?)?;
        identifier
            .ends_with('}')
            .then_some((&identifier[..start], labels, sample))
    } else {
        Some((identifier, "", sample))
    }
}

fn origin_label(labels: &str) -> String {
    let value = labels
        .split(',')
        .find_map(|label| label.strip_prefix("origin=\"")?.strip_suffix('"'))
        .unwrap_or("unknown");
    safe_label(value, 80)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "unknown".to_owned())
}

fn safe_label(value: &str, max_len: usize) -> Option<String> {
    (value.len() <= max_len && !value.chars().any(char::is_control)).then(|| value.to_owned())
}

async fn fetch_decisions(api_url: &str, api_key: &SecretString) -> Option<Vec<DecisionEntry>> {
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let endpoint = Url::parse(api_url).ok()?.join("v1/decisions").ok()?;
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

fn parse_decisions(body: &[u8]) -> Option<Vec<DecisionEntry>> {
    let rows = serde_json::from_slice::<Option<Vec<Value>>>(body)
        .ok()?
        .unwrap_or_default();
    let mut entries = rows.iter().filter_map(parse_decision).collect::<Vec<_>>();
    entries.sort_by_key(|entry| std::cmp::Reverse(entry.id));
    Some(entries)
}

fn parse_decision(value: &Value) -> Option<DecisionEntry> {
    if value.get("type")?.as_str()? != "ban" {
        return None;
    }
    let source_scope = value.get("scope")?.as_str()?;
    if !source_scope.eq_ignore_ascii_case("ip") && !source_scope.eq_ignore_ascii_case("range") {
        return None;
    }
    let ip_value = value.get("value")?.as_str()?;
    let scope = if IpAddr::from_str(ip_value).is_ok() {
        "Ip"
    } else if IpNet::from_str(ip_value).is_ok() {
        "Range"
    } else {
        return None;
    };
    let id = value.get("id")?.as_u64()?;
    if id > MAX_SAFE_INTEGER {
        return None;
    }
    Some(DecisionEntry {
        id,
        scope,
        value: ip_value.to_owned(),
        origin: safe_label(value.get("origin")?.as_str()?, 80)?,
        scenario: safe_label(value.get("scenario")?.as_str()?, 160)?,
        duration: safe_label(value.get("duration")?.as_str()?, 80)?,
        country_code: value
            .get("country_code")
            .or_else(|| value.get("country"))
            .and_then(Value::as_str)
            .and_then(|code| {
                (code.len() == 2 && code.bytes().all(|byte| byte.is_ascii_alphabetic()))
                    .then(|| code.to_ascii_uppercase())
            }),
    })
}

#[cfg(test)]
#[path = "../tests/crowdsec_dashboard.rs"]
mod tests;
