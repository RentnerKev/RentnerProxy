mod api;
mod config;
mod encryption;
mod models;
mod provider;
mod validation;

pub(crate) use config::DnsProviderConfig;
pub(crate) use encryption::{decrypt, encrypt};
pub(crate) use models::{DnsRecordIntent, EncryptedDnsConfig};
pub(crate) use provider::DnsProvider;

#[cfg(test)]
mod tests;
