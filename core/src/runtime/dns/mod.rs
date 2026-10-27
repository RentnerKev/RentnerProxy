pub(super) mod api;
pub(crate) mod capabilities;
mod config;
pub(in crate::runtime) mod desec;
pub(super) mod encryption;
mod hetzner;
mod models;
mod provider;
mod setup;
mod txt;
mod validation;

pub(crate) use config::DnsProviderConfig;
pub(in crate::runtime) use config::connection_test_endpoint;
pub(in crate::runtime) use config::{CLOUDFLARE_API_BASE, DESEC_API_BASE, HETZNER_API_BASE};
pub(crate) use encryption::{decrypt, encrypt};
pub(crate) use models::{
    DnsDelegationBinding, DnsPresentError, DnsRecordIntent, EncryptedDnsConfig,
};
pub(crate) use provider::DnsProvider;
pub(crate) use validation::is_canonical_dns_name;

#[cfg(test)]
mod tests;
