use super::*;
use axum::body::to_bytes;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

async fn chunked_response(payload: &[u8], idle: Duration) -> Response {
    let (client, mut agent) = tokio::io::duplex(8192);
    let wire = [
        b"HTTP/1.1 200 OK\r\nContent-Type: application/x-tar\r\nTransfer-Encoding: chunked\r\nX-Rentnerproxy-Backup-Bytes: 1024\r\n\r\n".as_slice(),
        payload,
    ].concat();
    let task = tokio::spawn(async move {
        let mut request = [0; 4096];
        assert!(agent.read(&mut request).await.unwrap() > 0);
        agent.write_all(&wire).await.unwrap();
    });
    let response = exchange_with_timeouts(
        client,
        "00000000-0000-4000-8000-000000000001",
        DownloadTimeouts {
            connection: Duration::from_secs(2),
            preparation: Duration::from_secs(2),
            idle,
        },
    )
    .await
    .unwrap();
    task.await.unwrap();
    response
}

#[tokio::test]
async fn clean_chunked_eof_before_verified_length_is_a_download_error() {
    let response = chunked_response(b"3\r\nabc\r\n0\r\n\r\n", Duration::from_secs(2)).await;
    assert!(to_bytes(response.into_body(), 4096).await.is_err());
}

#[tokio::test]
async fn chunked_data_exceeding_verified_length_is_a_download_error() {
    let mut payload = b"401\r\n".to_vec();
    payload.extend_from_slice(&[42; 1025]);
    payload.extend_from_slice(b"\r\n0\r\n\r\n");
    let response = chunked_response(&payload, Duration::from_secs(2)).await;
    assert!(to_bytes(response.into_body(), 4096).await.is_err());
}

#[tokio::test]
async fn expired_idle_deadline_rejects_even_a_buffered_download_body() {
    let mut payload = b"400\r\n".to_vec();
    payload.extend_from_slice(&[42; 1024]);
    payload.extend_from_slice(b"\r\n0\r\n\r\n");
    let response = chunked_response(&payload, Duration::ZERO).await;
    assert!(to_bytes(response.into_body(), 4096).await.is_err());
}
