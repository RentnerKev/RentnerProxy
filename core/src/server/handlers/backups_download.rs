use axum::{extract::Path, http::Uri, response::Response};

use super::{canonical_uuid, error, unavailable};

pub(in crate::server) async fn download(Path(id): Path<String>, uri: Uri) -> Response {
    if !canonical_uuid(&id) || uri.query().is_some() {
        return error(axum::http::StatusCode::NOT_FOUND, "not_found");
    }
    #[cfg(unix)]
    {
        let result = tokio::time::timeout(std::time::Duration::from_secs(300), async {
            let stream = tokio::net::UnixStream::connect(super::AGENT_SOCKET)
                .await
                .map_err(|_| ())?;
            exchange(stream, &id).await
        })
        .await;
        match result {
            Ok(Ok(response)) => response,
            _ => unavailable(),
        }
    }
    #[cfg(not(unix))]
    unavailable()
}

#[cfg(any(unix, test))]
async fn exchange<S>(stream: S, id: &str) -> Result<Response, ()>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
{
    use axum::{body::Body, http::StatusCode};
    use http_body_util::Empty;
    use hyper_util::rt::TokioIo;

    let (mut sender, connection) = hyper::client::conn::http1::handshake(TokioIo::new(stream))
        .await
        .map_err(|_| ())?;
    let connection = super::ConnectionTask(tokio::spawn(async move {
        let _ = connection.await;
    }));
    let request = hyper::Request::builder()
        .uri(format!("/artifacts/{id}/download"))
        .header("Host", "localhost")
        .header("Connection", "close")
        .body(Empty::<axum::body::Bytes>::new())
        .map_err(|_| ())?;
    let response = sender.send_request(request).await.map_err(|_| ())?;
    if response.status() != StatusCode::OK {
        return Ok(match response.status() {
            StatusCode::NOT_FOUND => error(StatusCode::NOT_FOUND, "not_found"),
            StatusCode::CONFLICT => error(StatusCode::CONFLICT, "conflict"),
            _ => unavailable(),
        });
    }
    let size = |name: &str| {
        response
            .headers()
            .get(name)
            .map(|value| {
                value
                    .to_str()
                    .ok()
                    .filter(|value| {
                        !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit())
                    })
                    .and_then(|value| value.parse::<u64>().ok())
                    .filter(|value| (1024..=32 * 1024 * 1024 * 1024 + 65536).contains(value))
                    .ok_or(())
            })
            .transpose()
    };
    let content_length = size("content-length")?;
    let verified_length = size("x-rentnerproxy-backup-bytes")?;
    if content_length
        .zip(verified_length)
        .is_some_and(|(content, verified)| content != verified)
    {
        return Err(());
    }
    let length = verified_length.or(content_length).ok_or(())?;
    if response
        .headers()
        .get("content-type")
        .and_then(|value| value.to_str().ok())
        != Some("application/x-tar")
    {
        return Err(());
    }
    let body = DownloadBody {
        body: response.into_body(),
        _connection: connection,
        deadline: Box::pin(tokio::time::sleep(std::time::Duration::from_secs(300))),
        remaining: length,
    };
    Response::builder()
        .header("Cache-Control", "private, no-store")
        .header("X-Content-Type-Options", "nosniff")
        .header("Content-Type", "application/x-tar")
        .header("Content-Length", length)
        .header("X-Rentnerproxy-Backup-Bytes", length)
        .header(
            "Content-Disposition",
            format!("attachment; filename=\"rentnerproxy-backup-{id}.tar\""),
        )
        .body(Body::new(body))
        .map_err(|_| ())
}

#[cfg(any(unix, test))]
struct DownloadBody {
    body: hyper::body::Incoming,
    _connection: super::ConnectionTask,
    deadline: std::pin::Pin<Box<tokio::time::Sleep>>,
    remaining: u64,
}

#[cfg(any(unix, test))]
impl hyper::body::Body for DownloadBody {
    type Data = axum::body::Bytes;
    type Error = std::io::Error;

    fn poll_frame(
        self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Option<Result<hyper::body::Frame<Self::Data>, Self::Error>>> {
        use std::{future::Future, io, pin::Pin, task::Poll};
        let this = self.get_mut();
        if this.deadline.as_mut().poll(cx).is_ready() {
            this._connection.0.abort();
            return Poll::Ready(Some(Err(io::Error::other("backup download timed out"))));
        }
        match Pin::new(&mut this.body).poll_frame(cx) {
            Poll::Ready(Some(Ok(frame))) => {
                if let Some(data) = frame.data_ref() {
                    let Some(remaining) = this.remaining.checked_sub(data.len() as u64) else {
                        return Poll::Ready(Some(Err(io::Error::other("invalid backup length"))));
                    };
                    this.remaining = remaining;
                }
                Poll::Ready(Some(Ok(frame)))
            }
            Poll::Ready(Some(Err(_))) => {
                Poll::Ready(Some(Err(io::Error::other("backup download unavailable"))))
            }
            Poll::Ready(None) if this.remaining != 0 => {
                Poll::Ready(Some(Err(io::Error::other("truncated backup download"))))
            }
            value => value.map(|value| {
                value
                    .map(|frame| frame.map_err(|_| io::Error::other("backup download unavailable")))
            }),
        }
    }

    fn size_hint(&self) -> hyper::body::SizeHint {
        hyper::body::SizeHint::with_exact(self.remaining)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::to_bytes, http::StatusCode};

    async fn agent_response(head: &str, bytes: &[u8]) -> Response {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let (client, mut server) = tokio::io::duplex(4096);
        let response = [head.as_bytes(), bytes].concat();
        tokio::spawn(async move {
            let mut request = [0; 4096];
            let length = server.read(&mut request).await.unwrap();
            assert!(
                std::str::from_utf8(&request[..length])
                    .unwrap()
                    .starts_with(
                        "GET /artifacts/00000000-0000-4000-8000-000000000001/download HTTP/1.1"
                    )
            );
            let _ = server.write_all(&response).await;
        });
        exchange(client, "00000000-0000-4000-8000-000000000001")
            .await
            .unwrap_or_else(|_| unavailable())
    }

    #[tokio::test]
    async fn streams_tar_without_json_limit_and_sets_fixed_safe_headers() {
        let payload = vec![42; 600_000];
        let response = agent_response(
            "HTTP/1.1 200 OK\r\nContent-Type: application/x-tar\r\nContent-Length: 600000\r\n\r\n",
            &payload,
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()["cache-control"], "private, no-store");
        assert_eq!(response.headers()["x-content-type-options"], "nosniff");
        assert_eq!(
            to_bytes(response.into_body(), 600_000).await.unwrap(),
            payload
        );
    }

    #[tokio::test]
    async fn rejects_invalid_type_missing_length_and_private_errors() {
        for head in [
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 1024\r\n\r\n",
            "HTTP/1.1 200 OK\r\nContent-Type: application/x-tar\r\n\r\n",
            "HTTP/1.1 500 Internal Server Error\r\nContent-Length: 13\r\n\r\n",
        ] {
            let response = agent_response(head, b"/private/path").await;
            assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
            assert_eq!(
                to_bytes(response.into_body(), 1024).await.unwrap(),
                r#"{"error":"unavailable"}"#
            );
        }
        for (head, status) in [
            (
                "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n",
                StatusCode::NOT_FOUND,
            ),
            (
                "HTTP/1.1 409 Conflict\r\nContent-Length: 0\r\n\r\n",
                StatusCode::CONFLICT,
            ),
        ] {
            assert_eq!(agent_response(head, b"").await.status(), status);
        }
    }

    #[tokio::test]
    async fn truncated_body_errors_instead_of_reporting_complete_download() {
        let response = agent_response(
            "HTTP/1.1 200 OK\r\nContent-Type: application/x-tar\r\nContent-Length: 2048\r\n\r\n",
            &[0; 1024],
        )
        .await;
        assert!(to_bytes(response.into_body(), 4096).await.is_err());
    }

    #[tokio::test]
    async fn chunked_agent_stream_uses_verified_size_and_rejects_conflicting_headers() {
        let payload = vec![42; 2048];
        let mut chunks = b"800\r\n".to_vec();
        chunks.extend_from_slice(&payload);
        chunks.extend_from_slice(b"\r\n0\r\n\r\n");
        let response = agent_response(
            "HTTP/1.1 200 OK\r\nContent-Type: application/x-tar\r\nTransfer-Encoding: chunked\r\nX-Rentnerproxy-Backup-Bytes: 2048\r\n\r\n",
            &chunks,
        ).await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()["x-rentnerproxy-backup-bytes"], "2048");
        assert_eq!(to_bytes(response.into_body(), 2048).await.unwrap(), payload);
        for headers in [
            "Content-Length: 2048\r\nX-Rentnerproxy-Backup-Bytes: 1024\r\n",
            "X-Rentnerproxy-Backup-Bytes: 0\r\n",
            "X-Rentnerproxy-Backup-Bytes: 34359938368\r\n",
            "X-Rentnerproxy-Backup-Bytes: +2048\r\n",
        ] {
            let response = agent_response(
                &format!("HTTP/1.1 200 OK\r\nContent-Type: application/x-tar\r\n{headers}\r\n"),
                &payload,
            )
            .await;
            assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        }
    }
}
