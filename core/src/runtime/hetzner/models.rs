use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(in crate::runtime) enum ErrorKind {
    Unauthorized,
    RateLimited,
    Unavailable,
    InvalidResponse,
    NotFound,
    Conflict,
    TimeBudgetExceeded,
    WriteUnconfirmed,
}

#[derive(Clone, Copy, Debug)]
pub(in crate::runtime) struct Error {
    pub(in crate::runtime) kind: ErrorKind,
    pub(in crate::runtime) retry_after: Option<u32>,
}
impl From<ErrorKind> for Error {
    fn from(kind: ErrorKind) -> Self {
        Self {
            kind,
            retry_after: None,
        }
    }
}

pub(super) fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && !value.starts_with('0')
        && value.len() <= 19
        && value.bytes().all(|byte| byte.is_ascii_digit())
        && value.parse::<i64>().is_ok_and(|id| id > 0)
}

pub(super) fn valid_name(value: &str) -> bool {
    value == "@"
        || (!value.is_empty()
            && value.len() <= 253
            && value.split('.').all(|label| {
                !label.is_empty()
                    && label.len() <= 63
                    && label.bytes().all(|byte| {
                        byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'*')
                    })
            }))
}

pub(super) fn valid_kind(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 16
        && value
            .bytes()
            .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit())
}

#[derive(Clone, Debug, Deserialize)]
pub(in crate::runtime) struct Zone {
    pub(in crate::runtime) id: u64,
    pub(in crate::runtime) name: String,
    pub(in crate::runtime) mode: String,
    pub(in crate::runtime) ttl: u32,
}
impl Zone {
    pub(super) fn validate(&mut self) -> Result<(), Error> {
        self.name = self
            .name
            .strip_suffix('.')
            .unwrap_or(&self.name)
            .to_ascii_lowercase();
        if self.id == 0
            || self.id > i64::MAX as u64
            || !crate::proxy::is_canonical_domain(&self.name)
            || !matches!(self.mode.as_str(), "primary" | "secondary")
            || self.ttl < 60
        {
            return Err(ErrorKind::InvalidResponse.into());
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub(in crate::runtime) struct Record {
    pub(in crate::runtime) value: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(in crate::runtime) comment: Option<String>,
}

pub(super) fn validate_records(records: &[Record]) -> Result<(), Error> {
    let mut values = BTreeSet::new();
    if records.len() > 50
        || records.iter().any(|record| {
            record.value.is_empty()
                || record.value.chars().count() > 4096
                || record
                    .comment
                    .as_ref()
                    .is_some_and(|comment| comment.chars().count() > 512)
                || !values.insert(&record.value)
        })
    {
        return Err(ErrorKind::InvalidResponse.into());
    }
    Ok(())
}

#[derive(Clone, Debug, Deserialize)]
pub(in crate::runtime) struct Rrset {
    pub(in crate::runtime) id: String,
    pub(in crate::runtime) name: String,
    #[serde(rename = "type")]
    pub(in crate::runtime) kind: String,
    pub(in crate::runtime) zone: u64,
    pub(in crate::runtime) ttl: Option<u32>,
    pub(in crate::runtime) records: Vec<Record>,
}
impl Rrset {
    pub(super) fn validate(
        &mut self,
        zone: &str,
        name: &str,
        kind: Option<&str>,
    ) -> Result<(), Error> {
        self.name.make_ascii_lowercase();
        if self.zone.to_string() != zone
            || self.name != name
            || kind.is_some_and(|kind| kind != self.kind)
            || !valid_name(&self.name)
            || !valid_kind(&self.kind)
            || self.id != format!("{}/{}", self.name, self.kind)
            || self.ttl.is_some_and(|ttl| ttl < 60)
        {
            return Err(ErrorKind::InvalidResponse.into());
        }
        validate_records(&self.records)
    }
}

pub(in crate::runtime) struct Page<T> {
    pub(in crate::runtime) items: Vec<T>,
    pub(in crate::runtime) next_page: Option<u32>,
}

pub(super) fn page<T: serde::de::DeserializeOwned>(
    mut response: serde_json::Value,
    key: &str,
    requested_page: u32,
) -> Result<Page<T>, Error> {
    let pagination = response
        .get("meta")
        .and_then(|meta| meta.get("pagination"))
        .and_then(serde_json::Value::as_object)
        .ok_or(ErrorKind::InvalidResponse)?;
    if pagination.get("page").and_then(serde_json::Value::as_u64) != Some(u64::from(requested_page))
        || pagination
            .get("per_page")
            .and_then(serde_json::Value::as_u64)
            != Some(50)
    {
        return Err(ErrorKind::InvalidResponse.into());
    }
    // Require an explicit end marker; missing metadata must not truncate discovery.
    let next_page = match pagination.get("next_page") {
        Some(serde_json::Value::Null) => None,
        Some(value) => Some(
            value
                .as_u64()
                .and_then(|value| u32::try_from(value).ok())
                .filter(|page| requested_page.checked_add(1) == Some(*page))
                .ok_or(ErrorKind::InvalidResponse)?,
        ),
        None => return Err(ErrorKind::InvalidResponse.into()),
    };
    if let Some(last) = pagination.get("last_page").filter(|value| !value.is_null()) {
        let last = last
            .as_u64()
            .filter(|last| *last >= u64::from(requested_page))
            .ok_or(ErrorKind::InvalidResponse)?;
        if next_page.is_some_and(|next| u64::from(next) > last)
            || (next_page.is_none() && last != u64::from(requested_page))
        {
            return Err(ErrorKind::InvalidResponse.into());
        }
    }
    let total = pagination
        .get("total_entries")
        .filter(|value| !value.is_null())
        .map(|value| value.as_u64().ok_or(ErrorKind::InvalidResponse))
        .transpose()?;
    let last = pagination
        .get("last_page")
        .filter(|value| !value.is_null())
        .and_then(serde_json::Value::as_u64);
    let items: Vec<T> = serde_json::from_value(
        response
            .get_mut(key)
            .ok_or(ErrorKind::InvalidResponse)?
            .take(),
    )
    .map_err(|_| ErrorKind::InvalidResponse)?;
    if items.len() > 50 || (next_page.is_some() && items.is_empty()) {
        return Err(ErrorKind::InvalidResponse.into());
    }
    if let Some(total) = total {
        let offset = u64::from(requested_page)
            .checked_sub(1)
            .ok_or(ErrorKind::InvalidResponse)?
            * 50;
        let total_pages = total.div_ceil(50).max(1);
        if offset > total
            || last.is_some_and(|last| last != total_pages)
            || items.len() as u64 != total.saturating_sub(offset).min(50)
            || next_page.is_some() != (u64::from(requested_page) < total_pages)
        {
            return Err(ErrorKind::InvalidResponse.into());
        }
    }
    Ok(Page { items, next_page })
}
