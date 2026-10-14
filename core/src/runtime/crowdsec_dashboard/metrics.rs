use std::collections::BTreeMap;

use super::{DashboardMetrics, MAX_SAFE_INTEGER, OriginCount, safe_label};

pub(super) fn parse_metrics(body: &[u8]) -> Option<DashboardMetrics> {
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
        // The bouncer's CounterVec has no exported series until its first blocked request.
        // An active-decision gauge from the same registry confirms the collector is available.
        blocked_requests: (blocked_seen || decisions_seen)
            .then(|| total_count(&blocked))
            .flatten(),
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

pub(super) fn metric_sample(line: &str) -> Option<(&str, &str, &str)> {
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
