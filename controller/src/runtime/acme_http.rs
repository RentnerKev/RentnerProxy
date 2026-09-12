use std::{
    future::Future,
    io,
    pin::Pin,
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use axum::http::{
    Request, Response,
    header::{HeaderMap, RETRY_AFTER},
};
use bytes::Bytes;
use http_body_util::BodyExt;
use httpdate::parse_http_date;
use instant_acme::{BodyWrapper, BytesResponse, Error, HttpClient};
use reqwest::{Client, redirect::Policy};
use time::{Date, OffsetDateTime, Time};

use super::super::{ProxyRuntime, certificates::CertificateEnvironment};

const MAX_ACME_REQUEST_BODY_BYTES: usize = 1 << 20;
const MAX_ACME_RESPONSE_BODY_BYTES: usize = 1 << 20;

/// Reqwest-backed ACME transport.
///
/// The runtime and certificate ID are owned by the transport for the lifetime
/// of an issuance attempt.  This lets a Retry-After deadline be persisted
/// after headers arrive and before the response is handed back to
/// instant-acme, including when a later body read or operation is cancelled.
pub(crate) struct AcmeHttpClient {
    client: Client,
    runtime: Arc<ProxyRuntime>,
    certificate_id: String,
    environment: CertificateEnvironment,
}

impl AcmeHttpClient {
    pub(crate) fn new(
        root_certificate_pem: Option<&[u8]>,
        runtime: Arc<ProxyRuntime>,
        certificate_id: String,
        environment: CertificateEnvironment,
    ) -> Result<Self, Error> {
        // reqwest is compiled with rustls-no-provider in the controller.  The
        // ring provider is installed by the caller before constructing this
        // client, matching the DNS provider's TLS setup.
        let mut builder = Client::builder()
            .timeout(Duration::from_secs(30))
            .no_proxy()
            .redirect(Policy::none());
        if let Some(root_certificate_pem) = root_certificate_pem {
            let certificate = reqwest::Certificate::from_pem(root_certificate_pem)
                .map_err(|error| Error::Other(Box::new(error)))?;
            // Match instant-acme's builder_with_root behavior: a configured
            // staging root is the complete trust store for that client.
            builder = builder.tls_certs_only([certificate]);
        }
        let client = builder
            .build()
            .map_err(|error| Error::Other(Box::new(error)))?;
        Ok(Self {
            client,
            runtime,
            certificate_id,
            environment,
        })
    }
}

impl HttpClient for AcmeHttpClient {
    fn request(
        &self,
        request: Request<BodyWrapper<Bytes>>,
    ) -> Pin<Box<dyn Future<Output = Result<BytesResponse, Error>> + Send>> {
        let client = self.client.clone();
        let runtime = Arc::clone(&self.runtime);
        let certificate_id = self.certificate_id.clone();
        let environment = self.environment;
        Box::pin(async move {
            let (parts, body) = request.into_parts();
            let authority = parts.uri.authority().map(|authority| authority.as_str());
            if parts.uri.scheme_str() != Some("https")
                || authority.is_none()
                || authority.is_some_and(|authority| authority.contains('@'))
            {
                return Err(other_error("ACME requests require an HTTPS origin"));
            }

            let body = body
                .collect()
                .await
                .map_err(|error| Error::Other(Box::new(error)))?
                .to_bytes();
            if body.len() > MAX_ACME_REQUEST_BODY_BYTES {
                return Err(other_error("ACME request body is too large"));
            }

            let request = client
                .request(parts.method, parts.uri.to_string())
                .headers(parts.headers)
                .body(body);
            // The request's URI has already been checked above.  Keeping the
            // reqwest redirect policy disabled prevents an ACME endpoint from
            // moving a signed request to another origin.
            let response = request
                .send()
                .await
                .map_err(|error| Error::Other(Box::new(error)))?;
            let status = response.status();
            let version = response.version();
            let headers = response.headers().clone();
            if retry_after_is_actionable(status)
                && let Some(deadline) = parse_retry_after(&headers, OffsetDateTime::now_utc())
            {
                // This happens before body collection and before the
                // BytesResponse is returned.  The certificate operation
                // lease is held by the caller while the request runs.
                if retry_after_is_account_scoped(status) {
                    runtime
                        .certificate_store
                        .defer_acme_account_retry(environment, deadline)
                        .await
                        .map_err(|_| {
                            other_error("unable to persist ACME account retry deadline")
                        })?;
                }
                runtime
                    .certificate_store
                    .defer_acme_retry(&certificate_id, deadline)
                    .await
                    .map_err(|_| other_error("unable to persist ACME retry deadline"))?;
            }
            let bytes = read_bounded_body(response).await?;
            bytes_response(status, version, headers, bytes)
        })
    }
}

fn bytes_response(
    status: axum::http::StatusCode,
    version: axum::http::Version,
    headers: HeaderMap,
    bytes: Vec<u8>,
) -> Result<BytesResponse, Error> {
    let mut response = Response::builder()
        .status(status)
        .version(version)
        .body(BodyWrapper::from(bytes))
        .map_err(Error::Http)?;
    // ACME relies on Replay-Nonce and Location in addition to the body.
    // Preserve every header, including duplicate field values, when adapting
    // the reqwest response.
    *response.headers_mut() = headers;
    Ok(BytesResponse::from(response))
}

async fn read_bounded_body(mut response: reqwest::Response) -> Result<Vec<u8>, Error> {
    if response
        .content_length()
        .is_some_and(|length| length > MAX_ACME_RESPONSE_BODY_BYTES as u64)
    {
        return Err(other_error("ACME response body is too large"));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| Error::Other(Box::new(error)))?
    {
        if bytes.len().saturating_add(chunk.len()) > MAX_ACME_RESPONSE_BODY_BYTES {
            return Err(other_error("ACME response body is too large"));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

fn other_error(message: &'static str) -> Error {
    Error::Other(Box::new(io::Error::new(
        io::ErrorKind::InvalidInput,
        message,
    )))
}

fn retry_after_is_actionable(status: axum::http::StatusCode) -> bool {
    status == axum::http::StatusCode::TOO_MANY_REQUESTS
        || status == axum::http::StatusCode::SERVICE_UNAVAILABLE
        || status.is_success()
}

fn retry_after_is_account_scoped(status: axum::http::StatusCode) -> bool {
    status == axum::http::StatusCode::TOO_MANY_REQUESTS
        || status == axum::http::StatusCode::SERVICE_UNAVAILABLE
}

/// Parse one RFC 9110 Retry-After value.
///
/// Retry-After is not a list-valued header.  Multiple field values therefore
/// make the hint ambiguous and are ignored.  The caller supplies `now` so the
/// conversion is deterministic in focused parser tests.  Numeric delays that
/// cannot be represented by `OffsetDateTime` use its maximum representable
/// value, preserving a conservative durable deadline instead of retrying
/// immediately after an absurd CA value.
pub(crate) fn parse_retry_after(
    headers: &HeaderMap,
    now: OffsetDateTime,
) -> Option<OffsetDateTime> {
    let mut values = headers.get_all(RETRY_AFTER).iter();
    let value = values.next()?.to_str().ok()?.trim();
    if values.next().is_some() || value.is_empty() {
        return None;
    }

    let deadline = if value.bytes().all(|byte| byte.is_ascii_digit()) {
        let Some(seconds) = value.parse::<u64>().ok() else {
            return Some(OffsetDateTime::new_utc(Date::MAX, Time::MAX));
        };
        let Some(seconds) = i64::try_from(seconds).ok() else {
            return Some(OffsetDateTime::new_utc(Date::MAX, Time::MAX));
        };
        now.checked_add(time::Duration::seconds(seconds))
            .unwrap_or_else(|| OffsetDateTime::new_utc(Date::MAX, Time::MAX))
    } else {
        let date = parse_http_date(value).ok()?;
        system_time_to_offset_datetime(date)?
    };
    Some(deadline)
}

fn system_time_to_offset_datetime(value: SystemTime) -> Option<OffsetDateTime> {
    match value.duration_since(UNIX_EPOCH) {
        Ok(elapsed) => {
            let seconds = i64::try_from(elapsed.as_secs()).unwrap_or(i64::MAX);
            Some(
                OffsetDateTime::from_unix_timestamp(seconds)
                    .unwrap_or_else(|_| OffsetDateTime::new_utc(Date::MAX, Time::MAX)),
            )
        }
        Err(error) => {
            let elapsed = error.duration();
            let seconds = i64::try_from(elapsed.as_secs()).unwrap_or(i64::MAX);
            let seconds = seconds
                .checked_add(i64::from(u8::from(elapsed.subsec_nanos() != 0)))
                .and_then(|seconds| seconds.checked_neg())
                .unwrap_or(i64::MIN);
            Some(
                OffsetDateTime::from_unix_timestamp(seconds)
                    .unwrap_or_else(|_| OffsetDateTime::new_utc(Date::MIN, Time::MIDNIGHT)),
            )
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::{HeaderValue, StatusCode, Version, header::RETRY_AFTER};

    fn headers(value: &str) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(RETRY_AFTER, HeaderValue::from_str(value).unwrap());
        headers
    }

    #[test]
    fn retry_after_seconds_are_not_shortened() {
        let now = OffsetDateTime::from_unix_timestamp(1_700_000_000).unwrap();
        assert_eq!(
            parse_retry_after(&headers("30"), now),
            Some(now + time::Duration::seconds(30))
        );
        assert_eq!(
            parse_retry_after(&headers("999999999999999999999"), now),
            Some(OffsetDateTime::new_utc(Date::MAX, Time::MAX))
        );
    }

    #[test]
    fn retry_after_http_dates_are_parsed_without_a_local_cap() {
        let now = OffsetDateTime::from_unix_timestamp(1_700_000_000).unwrap();
        assert_eq!(
            parse_retry_after(&headers("Tue, 14 Nov 2023 22:14:30 GMT"), now),
            Some(OffsetDateTime::from_unix_timestamp(1_700_000_070).unwrap())
        );
        assert_eq!(
            parse_retry_after(&headers("Tue, 21 Nov 2023 22:13:20 GMT"), now),
            Some(OffsetDateTime::from_unix_timestamp(1_700_604_800).unwrap())
        );
    }

    #[test]
    fn malformed_and_duplicate_retry_after_values_are_ignored() {
        let now = OffsetDateTime::from_unix_timestamp(1_700_000_000).unwrap();
        assert_eq!(parse_retry_after(&headers("tomorrow"), now), None);
        assert_eq!(parse_retry_after(&headers("-1"), now), None);

        let mut duplicate = HeaderMap::new();
        duplicate.append(RETRY_AFTER, HeaderValue::from_static("10"));
        duplicate.append(RETRY_AFTER, HeaderValue::from_static("20"));
        assert_eq!(parse_retry_after(&duplicate, now), None);
    }

    #[test]
    fn retry_after_is_actionable_for_ca_throttling_and_successful_polls() {
        assert!(retry_after_is_actionable(
            axum::http::StatusCode::TOO_MANY_REQUESTS
        ));
        assert!(retry_after_is_actionable(
            axum::http::StatusCode::SERVICE_UNAVAILABLE
        ));
        assert!(retry_after_is_actionable(axum::http::StatusCode::OK));
        assert!(!retry_after_is_actionable(
            axum::http::StatusCode::BAD_REQUEST
        ));
    }

    #[test]
    fn only_throttling_responses_are_account_scoped() {
        assert!(retry_after_is_account_scoped(
            axum::http::StatusCode::TOO_MANY_REQUESTS
        ));
        assert!(retry_after_is_account_scoped(
            axum::http::StatusCode::SERVICE_UNAVAILABLE
        ));
        assert!(!retry_after_is_account_scoped(axum::http::StatusCode::OK));
        assert!(!retry_after_is_account_scoped(
            axum::http::StatusCode::BAD_REQUEST
        ));
    }

    #[test]
    fn response_adapter_preserves_acme_nonce_and_location_headers() {
        let mut response_headers = HeaderMap::new();
        response_headers.insert("Replay-Nonce", HeaderValue::from_static("nonce-1"));
        response_headers.insert(
            "Location",
            HeaderValue::from_static("https://ca.example/order/1"),
        );
        let response = bytes_response(
            StatusCode::CREATED,
            Version::HTTP_11,
            response_headers,
            b"{}".to_vec(),
        )
        .unwrap();
        assert_eq!(
            response.parts.headers.get("Replay-Nonce"),
            Some(&HeaderValue::from_static("nonce-1"))
        );
        assert_eq!(
            response.parts.headers.get("Location"),
            Some(&HeaderValue::from_static("https://ca.example/order/1"))
        );
    }
}
