use super::models::{Error, Failure};
use reqwest::{Client, Response, StatusCode};
use std::time::{Duration, SystemTime};
use tokio::time::{Instant, timeout_at};

pub(super) fn client() -> Result<Client, Error> {
    super::super::tls::ensure_crypto_provider();
    let builder = Client::builder()
        .retry(reqwest::retry::never())
        .redirect(reqwest::redirect::Policy::none());
    #[cfg(test)]
    let builder = builder.no_proxy();
    builder.build().map_err(|_| Error::ProviderUnavailable)
}

pub(super) async fn body(mut response: Response, limit: usize) -> Result<Vec<u8>, Failure> {
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| Error::ProviderUnavailable)?
    {
        if bytes.len() + chunk.len() > limit {
            return Err(Error::InvalidProviderResponse.into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

pub(super) async fn send(
    request: reqwest::RequestBuilder,
    deadline: Instant,
) -> Result<Vec<u8>, Failure> {
    send_inner(request, deadline, false).await
}

pub(super) async fn send_unpaginated(
    request: reqwest::RequestBuilder,
    deadline: Instant,
) -> Result<Vec<u8>, Failure> {
    send_inner(request, deadline, true).await
}

async fn send_inner(
    request: reqwest::RequestBuilder,
    deadline: Instant,
    reject_pagination: bool,
) -> Result<Vec<u8>, Failure> {
    if Instant::now() >= deadline {
        return Err(Error::TimeBudgetExceeded.into());
    }
    timeout_at(
        deadline.min(Instant::now() + Duration::from_secs(5)),
        async {
            let response = request
                .send()
                .await
                .map_err(|_| Error::ProviderUnavailable)?;
            let code = match response.status() {
                StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => {
                    Some(Error::ProviderUnauthorized)
                }
                StatusCode::TOO_MANY_REQUESTS => Some(Error::ProviderRateLimited),
                status if !status.is_success() => Some(Error::ProviderUnavailable),
                _ => None,
            };
            if let Some(code) = code {
                let retry_after = response
                    .headers()
                    .get(reqwest::header::RETRY_AFTER)
                    .and_then(|value| value.to_str().ok())
                    .and_then(retry_after);
                return Err(Failure { code, retry_after });
            }
            if reject_pagination
                && response
                    .headers()
                    .get_all(reqwest::header::LINK)
                    .iter()
                    .any(|value| {
                        value.to_str().map_or(true, |value| {
                            value.split(',').any(|link| {
                                link.split(';').skip(1).any(|parameter| {
                                    parameter
                                        .trim()
                                        .split_once('=')
                                        .is_some_and(|(key, value)| {
                                            key.trim().eq_ignore_ascii_case("rel")
                                                && value
                                                    .trim()
                                                    .trim_matches('"')
                                                    .split_ascii_whitespace()
                                                    .any(|relation| relation == "next")
                                        })
                                })
                            })
                        })
                    })
            {
                return Err(Error::InvalidProviderResponse.into());
            }
            if !response
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
                .is_some_and(|value| value.starts_with("application/json"))
            {
                return Err(Error::InvalidProviderResponse.into());
            }
            body(response, 128 * 1024).await
        },
    )
    .await
    .map_err(|_| Failure::from(Error::ProviderUnavailable))?
}

fn retry_after(value: &str) -> Option<u32> {
    value
        .parse::<u64>()
        .ok()
        .or_else(|| {
            httpdate::parse_http_date(value)
                .ok()?
                .duration_since(SystemTime::now())
                .ok()
                .map(|d| d.as_secs())
        })
        .map(|seconds| seconds.clamp(1, 86_400) as u32)
}
