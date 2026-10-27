use std::fmt;

use serde::{Deserialize, Serialize};

use crate::runtime::certificates::CertificateError;

use super::validation::{
    bare_authorization_name, dns_record_marker, domain_is_in_zone, is_canonical_dns_name,
    is_owned_marker, is_safe_secret,
};

/// Internal mutation outcome; preread and validation failures cannot leave a write.
#[derive(Debug)]
pub(crate) struct DnsPresentError {
    pub(crate) error: CertificateError,
    pub(crate) unconfirmed: bool,
}

impl From<CertificateError> for DnsPresentError {
    fn from(error: CertificateError) -> Self {
        Self {
            error,
            unconfirmed: false,
        }
    }
}

impl DnsPresentError {
    pub(crate) fn uncertain(error: CertificateError) -> Self {
        Self {
            error,
            unconfirmed: true,
        }
    }
}
#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct EncryptedDnsConfig {
    pub(crate) version: u8,
    pub(crate) nonce: Vec<u8>,
    pub(crate) ciphertext: Vec<u8>,
}

impl fmt::Debug for EncryptedDnsConfig {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("EncryptedDnsConfig")
            .field("version", &self.version)
            .field("nonce", &"REDACTED")
            .field("ciphertext_bytes", &self.ciphertext.len())
            .finish()
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct DnsDelegationBinding {
    pub(crate) original_owner: String,
    pub(crate) target_owner: String,
    pub(crate) zone_name: String,
    pub(crate) cname_chain: Vec<String>,
}

impl DnsDelegationBinding {
    pub(crate) fn validate(&self) -> Result<(), CertificateError> {
        if !is_canonical_dns_name(&self.original_owner)
            || !is_canonical_dns_name(&self.target_owner)
            || !is_canonical_dns_name(&self.zone_name)
            || !domain_is_in_zone(&self.target_owner, &self.zone_name)
            || self.cname_chain.is_empty()
            || self.cname_chain.len() > 9
            || self.cname_chain.first() != Some(&self.original_owner)
            || self.cname_chain.last() != Some(&self.target_owner)
            || self
                .cname_chain
                .iter()
                .any(|name| !is_canonical_dns_name(name))
            || self
                .cname_chain
                .iter()
                .collect::<std::collections::BTreeSet<_>>()
                .len()
                != self.cname_chain.len()
            || (self.cname_chain.len() == 1 && self.zone_name != self.original_owner)
        {
            return Err(CertificateError::DnsDelegationInvalid);
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct DnsRecordIntent {
    pub(crate) name: String,
    pub(crate) value: String,
    pub(crate) marker: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) delegation: Option<DnsDelegationBinding>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub(crate) unconfirmed_write: bool,
}

impl DnsRecordIntent {
    pub(crate) fn new(
        certificate_id: &str,
        authorization_name: &str,
        value: &str,
    ) -> Result<Self, CertificateError> {
        let marker = dns_record_marker(certificate_id)?;
        let name = bare_authorization_name(authorization_name)
            .ok_or(CertificateError::DnsProviderInvalid)?;
        let intent = Self {
            name,
            value: value.to_owned(),
            marker,
            delegation: None,
            unconfirmed_write: false,
        };
        intent.validate()?;
        Ok(intent)
    }

    pub(crate) fn with_delegation(
        mut self,
        binding: DnsDelegationBinding,
    ) -> Result<Self, CertificateError> {
        binding.validate()?;
        if binding.original_owner != format!("_acme-challenge.{}", self.name) {
            return Err(CertificateError::DnsDelegationInvalid);
        }
        self.delegation = Some(binding);
        self.validate()?;
        Ok(self)
    }

    pub(crate) fn validate(&self) -> Result<(), CertificateError> {
        if bare_authorization_name(&self.name).is_none()
            || !is_safe_secret(&self.value, 2_048)
            || !is_owned_marker(&self.marker)
            || (self.unconfirmed_write && self.delegation.is_none())
        {
            return Err(CertificateError::DnsProviderInvalid);
        }
        if let Some(binding) = &self.delegation {
            binding.validate()?;
            if binding.original_owner != format!("_acme-challenge.{}", self.name) {
                return Err(CertificateError::DnsDelegationInvalid);
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct DnsRecordHandle {
    pub(crate) id: String,
    pub(crate) intent: DnsRecordIntent,
}
