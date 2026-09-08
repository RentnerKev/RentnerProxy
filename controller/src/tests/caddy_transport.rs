use super::{EngineError, exchange};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt, DuplexStream};

async fn read_request(stream: &mut DuplexStream) -> String {
    let mut request = Vec::new();
    while !request.ends_with(b"\r\n\r\n") {
        request.push(stream.read_u8().await.unwrap());
        assert!(request.len() < 4_096);
    }
    String::from_utf8(request).unwrap()
}

async fn response(raw: Vec<u8>) -> Result<(u16, Vec<u8>), EngineError> {
    let (client, mut server) = tokio::io::duplex(16_384);
    let handler = tokio::spawn(async move {
        let request = read_request(&mut server).await;
        assert!(request.starts_with("GET /probe HTTP/1.1\r\n"));
        assert!(
            request
                .to_ascii_lowercase()
                .contains("host: 127.0.0.1:2020\r\n")
        );
        server.write_all(&raw).await.unwrap();
        server.shutdown().await.unwrap();
    });
    let result = exchange(client, "127.0.0.1:2020", "GET", "/probe", "")
        .await
        .map(|response| (response.status, response.body.to_vec()));
    handler.await.unwrap();
    result
}

#[tokio::test]
async fn control_transport_parses_real_http_framing_and_chunked_bodies() {
    assert_eq!(
        response(
            b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n3\r\nyes\r\n0\r\n\r\n".to_vec()
        )
        .await,
        Ok((200, b"yes".to_vec()))
    );
    assert_eq!(
        response(b"HTTP/1.1 400 Bad Request\r\nContent-Length: 3\r\n\r\nbad".to_vec()).await,
        Ok((400, b"bad".to_vec()))
    );
}

#[tokio::test]
async fn control_transport_rejects_malformed_truncated_and_oversized_responses() {
    let mut oversized = b"HTTP/1.1 200 OK\r\nContent-Length: 4097\r\n\r\n".to_vec();
    oversized.extend(vec![b'x'; 4_097]);
    for raw in [
        b"200 all good\r\n\r\n".to_vec(),
        b"HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\nno".to_vec(),
        oversized,
    ] {
        assert_eq!(response(raw).await, Err(EngineError::InvalidResponse));
    }
}

#[tokio::test]
async fn cancelled_control_request_closes_the_transport_task() {
    let (client, mut server) = tokio::io::duplex(4_096);
    let request =
        tokio::spawn(async move { exchange(client, "localhost", "GET", "/probe", "").await });
    read_request(&mut server).await;
    request.abort();
    let _ = request.await;
    let mut byte = [0u8; 1];
    assert_eq!(
        tokio::time::timeout(Duration::from_secs(1), server.read(&mut byte))
            .await
            .unwrap()
            .unwrap(),
        0
    );
}
