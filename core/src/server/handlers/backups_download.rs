use axum::{extract::Path, http::Uri, response::Response};

use super::{canonical_uuid, error, unavailable};

#[cfg(any(unix, test))]
#[derive(Clone, Copy)]
struct DownloadTimeouts {
    connection: std::time::Duration,
    preparation: std::time::Duration,
    idle: std::time::Duration,
}

#[cfg(any(unix, test))]
const TIMEOUTS: DownloadTimeouts = DownloadTimeouts {
    connection: std::time::Duration::from_secs(5),
    preparation: std::time::Duration::from_secs(4 * 60 * 60),
    idle: std::time::Duration::from_secs(5 * 60),
};

pub(in crate::server) async fn download(Path(id): Path<String>, uri: Uri) -> Response {
    if !canonical_uuid(&id) || uri.query().is_some() {
        return error(axum::http::StatusCode::NOT_FOUND, "not_found");
    }
    #[cfg(unix)]
    {
        let result = tokio::time::timeout(
            TIMEOUTS.connection,
            tokio::net::UnixStream::connect(super::AGENT_SOCKET),
        )
        .await;
        match result {
            Ok(Ok(stream)) => exchange(stream, &id)
                .await
                .unwrap_or_else(|_| unavailable()),
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
    exchange_with_timeouts(stream, id, TIMEOUTS).await
}

#[cfg(any(unix, test))]
async fn exchange_with_timeouts<S>(
    stream: S,
    id: &str,
    timeouts: DownloadTimeouts,
) -> Result<Response, ()>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
{
    use axum::{body::Body, http::StatusCode};
    use http_body_util::Empty;
    use hyper_util::rt::TokioIo;

    let (mut sender, connection) = tokio::time::timeout(
        timeouts.connection,
        hyper::client::conn::http1::handshake(TokioIo::new(stream)),
    )
    .await
    .map_err(|_| ())?
    .map_err(|_| ())?;
    let (deadline, mut deadline_changed) = tokio::sync::watch::channel(
        tokio::time::Instant::now() + timeouts.preparation + timeouts.connection,
    );
    let connection = super::ConnectionTask(tokio::spawn(async move {
        tokio::pin!(connection);
        loop {
            let expires = *deadline_changed.borrow_and_update();
            tokio::select! {
                _ = &mut connection => return,
                _ = tokio::time::sleep_until(expires) => return,
                changed = deadline_changed.changed() => if changed.is_err() { return },
            }
        }
    }));
    let request = hyper::Request::builder()
        .uri(format!("/artifacts/{id}/download"))
        .header("Host", "localhost")
        .header("Connection", "close")
        .body(Empty::<axum::body::Bytes>::new())
        .map_err(|_| ())?;
    let response = tokio::time::timeout(
        timeouts.preparation + timeouts.connection,
        sender.send_request(request),
    )
    .await
    .map_err(|_| ())?
    .map_err(|_| ())?;
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
    deadline.send_replace(tokio::time::Instant::now() + timeouts.idle);
    let body = DownloadBody {
        body: response.into_body(),
        _connection: connection,
        deadline,
        idle: timeouts.idle,
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
    deadline: tokio::sync::watch::Sender<tokio::time::Instant>,
    idle: std::time::Duration,
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
        use std::{io, pin::Pin, task::Poll};
        let this = self.get_mut();
        if tokio::time::Instant::now() >= *this.deadline.borrow() {
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
                    if !data.is_empty() {
                        this.deadline
                            .send_replace(tokio::time::Instant::now() + this.idle);
                    }
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

    #[tokio::test]
    async fn active_body_outlives_preparation_and_idle_budgets_with_regular_progress() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let (client, mut server) = tokio::io::duplex(4096);
        let task = tokio::spawn(async move {
            let mut request = [0; 4096];
            assert!(server.read(&mut request).await.unwrap() > 0);
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            server.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: application/x-tar\r\nContent-Length: 6144\r\n\r\n").await.unwrap();
            for _ in 0..6 {
                tokio::time::sleep(std::time::Duration::from_millis(30)).await;
                server.write_all(&[42; 1024]).await.unwrap();
            }
        });
        let response = exchange_with_timeouts(
            client,
            "00000000-0000-4000-8000-000000000001",
            DownloadTimeouts {
                connection: std::time::Duration::from_millis(100),
                preparation: std::time::Duration::from_millis(100),
                idle: std::time::Duration::from_millis(100),
            },
        )
        .await
        .unwrap();
        assert_eq!(
            to_bytes(response.into_body(), 6144).await.unwrap(),
            vec![42; 6144]
        );
        task.await.unwrap();
    }

    #[tokio::test]
    async fn unpolled_body_closes_agent_connection_at_idle_without_waiting_for_consumer() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let (client, mut server) = tokio::io::duplex(4096);
        let task = tokio::spawn(async move {
            let mut request = [0; 4096];
            assert!(server.read(&mut request).await.unwrap() > 0);
            server.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: application/x-tar\r\nContent-Length: 1048576\r\n\r\n").await.unwrap();
            server.write_all(&[42; 1024]).await.unwrap();
            tokio::time::timeout(
                std::time::Duration::from_millis(500),
                server.read(&mut request),
            )
            .await
            .unwrap()
            .unwrap()
        });
        let response = exchange_with_timeouts(
            client,
            "00000000-0000-4000-8000-000000000001",
            DownloadTimeouts {
                connection: std::time::Duration::from_millis(100),
                preparation: std::time::Duration::from_millis(100),
                idle: std::time::Duration::from_millis(50),
            },
        )
        .await
        .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(task.await.unwrap(), 0);
        drop(response);
    }

    #[tokio::test]
    async fn silent_preparation_is_bounded_even_if_socket_stays_connected() {
        use tokio::io::AsyncReadExt;
        let (client, mut server) = tokio::io::duplex(4096);
        let task = tokio::spawn(async move {
            let mut request = [0; 4096];
            assert!(server.read(&mut request).await.unwrap() > 0);
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        });
        assert!(
            exchange_with_timeouts(
                client,
                "00000000-0000-4000-8000-000000000001",
                DownloadTimeouts {
                    connection: std::time::Duration::from_millis(10),
                    preparation: std::time::Duration::from_millis(30),
                    idle: std::time::Duration::from_millis(100),
                }
            )
            .await
            .is_err()
        );
        task.abort();
    }

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
