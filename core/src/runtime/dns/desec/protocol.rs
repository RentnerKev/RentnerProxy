use serde::{Deserialize, Serialize};

pub(super) use super::super::txt::{quote_txt, unquote_txt};

use crate::runtime::certificates::CertificateError;

#[derive(Deserialize)]
pub(super) struct DesecDomain {
    pub(super) name: String,
    pub(super) minimum_ttl: u32,
}

#[derive(Deserialize, Serialize)]
pub(super) struct DesecRrset {
    pub(super) subname: String,
    #[serde(skip_serializing)]
    domain: String,
    #[serde(skip_serializing)]
    name: String,
    #[serde(rename = "type")]
    record_type: String,
    ttl: u32,
    pub(super) records: Vec<String>,
}

impl DesecRrset {
    pub(super) fn new(subname: String, ttl: u32) -> Self {
        Self {
            subname,
            domain: String::new(),
            name: String::new(),
            record_type: "TXT".to_owned(),
            ttl,
            records: Vec::new(),
        }
    }

    pub(super) fn validate(&self, zone: &str, subname: &str) -> Result<(), CertificateError> {
        let expected_name = if subname.is_empty() {
            format!("{zone}.")
        } else {
            format!("{subname}.{zone}.")
        };
        if self.domain != zone
            || self.name != expected_name
            || self.subname != subname
            || self.record_type != "TXT"
            || !(1..=86400).contains(&self.ttl)
            || self
                .records
                .iter()
                .any(|record| unquote_txt(record).is_none())
        {
            return Err(CertificateError::DnsProviderInvalid);
        }
        Ok(())
    }

    pub(super) fn same_contents(&self, other: &Self) -> bool {
        let values = |records: &[String]| {
            records
                .iter()
                .filter_map(|record| unquote_txt(record))
                .collect::<std::collections::BTreeSet<_>>()
        };
        self.subname == other.subname
            && self.record_type == other.record_type
            && self.ttl == other.ttl
            && values(&self.records) == values(&other.records)
    }

    pub(super) fn contains(&self, value: &str) -> bool {
        self.records
            .iter()
            .any(|record| unquote_txt(record).as_deref() == Some(value.as_bytes()))
    }

    pub(super) fn remove_value(&mut self, value: &str) {
        self.records
            .retain(|record| unquote_txt(record).as_deref() != Some(value.as_bytes()));
    }
}
