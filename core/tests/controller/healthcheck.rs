use super::common::isolated_command;
use std::time::Duration;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
    time::timeout,
};

#[tokio::test]
async fn binary_healthcheck_requires_an_exact_success_status_and_uses_the_requested_endpoint() {
    for (endpoint, response, success) in [
        ("health", "HTTP/1.1 200 OK\r\n\r\n", true),
        ("ready", "HTTP/1.0 200 OK\r\n\r\n", true),
        ("ready", "HTTP/1.1 503 Unavailable\r\n\r\n", false),
        ("health", "HTTP/1.1 201 Created\r\n\r\n", false),
        ("health", "HTTP/1.1 2000 Invalid\r\n\r\n", false),
        ("health", "200 OK\r\n\r\n", false),
    ] {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = Vec::new();
            while !request.ends_with(b"\r\n\r\n") {
                request.push(stream.read_u8().await.unwrap());
                assert!(request.len() < 4_096);
            }
            let request = String::from_utf8(request).unwrap();
            assert!(request.starts_with(&format!("GET /{endpoint} HTTP/1.1\r\n")));
            assert!(request.contains("Host: localhost\r\n"));
            assert!(request.contains("Connection: close\r\n"));
            stream.write_all(response.as_bytes()).await.unwrap();
            stream.shutdown().await.unwrap();
        });
        let output = timeout(
            Duration::from_secs(5),
            tokio::task::spawn_blocking(move || {
                isolated_command()
                    .env("RENTNERPROXY_CONTROLLER_LISTEN_ADDR", address.to_string())
                    .args(["--healthcheck", endpoint])
                    .output()
                    .unwrap()
            }),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(output.status.success(), success, "{response:?}");
        assert!(output.stdout.is_empty());
        assert!(output.stderr.is_empty());
        timeout(Duration::from_secs(1), server)
            .await
            .unwrap()
            .unwrap();
    }
}

#[test]
fn binary_healthcheck_rejects_invalid_addresses_and_connection_failures() {
    for address in ["invalid address", "127.0.0.1:0"] {
        let output = isolated_command()
            .env("RENTNERPROXY_CONTROLLER_LISTEN_ADDR", address)
            .args(["--healthcheck", "health"])
            .output()
            .unwrap();
        assert_eq!(output.status.code(), Some(1));
        assert!(output.stdout.is_empty());
        assert!(output.stderr.is_empty());
    }
}
