use std::fmt;

use serde::{Deserialize, Serialize};

use crate::runtime::certificates::CertificateError;

use super::validation::{
    bare_authorization_name, dns_record_marker, is_owned_marker, is_safe_secret,
};

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
pub(crate) struct DnsRecordIntent {
    pub(crate) name: String,
    pub(crate) value: String,
    pub(crate) marker: String,
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
        };
        intent.validate()?;
        Ok(intent)
    }

    pub(crate) fn validate(&self) -> Result<(), CertificateError> {
        if bare_authorization_name(&self.name).is_none()
            || !is_safe_secret(&self.value, 2_048)
            || !is_owned_marker(&self.marker)
        {
            return Err(CertificateError::DnsProviderInvalid);
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
