use super::{
    http,
    models::{Error, RecordType},
    validation,
};
use std::{net::IpAddr, time::Duration};
use tokio::time::{Instant, timeout_at};

pub(super) const IPV4_URL: &str = "https://1.1.1.1/cdn-cgi/trace";
pub(super) const IPV6_URL: &str = "https://[2606:4700:4700::1111]/cdn-cgi/trace";

pub(super) async fn discover(
    url: &str,
    family: RecordType,
    deadline: Instant,
) -> Result<IpAddr, Error> {
    timeout_at(
        deadline.min(Instant::now() + Duration::from_secs(3)),
        async {
            // No credentials and no environment HTTP proxy: detect this runtime's egress.
            super::super::tls::ensure_crypto_provider();
            let client = reqwest::Client::builder()
                .no_proxy()
                .retry(reqwest::retry::never())
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .map_err(|_| Error::IpDiscoveryFailed)?;
            let response = client
                .get(url)
                .send()
                .await
                .map_err(|_| Error::IpDiscoveryFailed)?;
            if !response.status().is_success() {
                return Err(Error::IpDiscoveryFailed);
            }
            let bytes = http::body(response, 4096)
                .await
                .map_err(|_| Error::IpDiscoveryFailed)?;
            let text = std::str::from_utf8(&bytes).map_err(|_| Error::IpDiscoveryFailed)?;
            parse(text, family)
        },
    )
    .await
    .map_err(|_| Error::IpDiscoveryFailed)?
}

pub(super) fn parse(text: &str, family: RecordType) -> Result<IpAddr, Error> {
    let mut addresses = text.lines().filter_map(|line| line.strip_prefix("ip="));
    let address = addresses
        .next()
        .ok_or(Error::IpDiscoveryFailed)?
        .parse::<IpAddr>()
        .map_err(|_| Error::IpDiscoveryFailed)?;
    if addresses.next().is_some() || !family.matches(address) || !validation::public(address) {
        return Err(Error::IpDiscoveryFailed);
    }
    Ok(address)
}
