pub(super) mod api;
pub(crate) mod capabilities;
mod config;
pub(in crate::runtime) mod desec;
pub(super) mod encryption;
mod hetzner;
mod models;
mod provider;
mod txt;
mod validation;

pub(crate) use config::DnsProviderConfig;
pub(in crate::runtime) use config::{CLOUDFLARE_API_BASE, DESEC_API_BASE, HETZNER_API_BASE};
pub(crate) use encryption::{decrypt, encrypt};
pub(crate) use models::{DnsRecordIntent, EncryptedDnsConfig};
pub(crate) use provider::DnsProvider;

#[cfg(test)]
mod tests;
