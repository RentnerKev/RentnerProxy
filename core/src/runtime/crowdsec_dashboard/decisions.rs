use std::{net::IpAddr, str::FromStr};

use ipnet::IpNet;
use serde_json::Value;

use super::{DecisionEntry, MAX_SAFE_INTEGER, safe_label};

pub(super) fn parse_decisions(body: &[u8]) -> Option<Vec<DecisionEntry>> {
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
