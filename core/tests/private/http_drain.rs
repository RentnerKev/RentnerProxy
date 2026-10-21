use super::*;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

#[tokio::test]
async fn cancelled_connection_can_be_polled_repeatedly_without_repolling_completed_future() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let client = TcpStream::connect(listener.local_addr().unwrap())
        .await
        .unwrap();
    let (stream, _) = listener.accept().await.unwrap();
    let mut io = DrainIo {
        stream,
        cancelled: Box::pin(async {}),
        stopped: false,
    };
    for _ in 0..2 {
        assert_eq!(
            io.read(&mut [0]).await.unwrap_err().kind(),
            io::ErrorKind::ConnectionAborted
        );
        assert_eq!(
            io.write(b"x").await.unwrap_err().kind(),
            io::ErrorKind::ConnectionAborted
        );
        assert_eq!(
            io.flush().await.unwrap_err().kind(),
            io::ErrorKind::ConnectionAborted
        );
    }
    drop(client);
}

#[tokio::test]
async fn forced_drain_closes_a_connection_whose_response_body_never_finishes() {
    struct PendingBody;
    impl hyper::body::Body for PendingBody {
        type Data = bytes::Bytes;
        type Error = std::convert::Infallible;
        fn poll_frame(
            self: Pin<&mut Self>,
            _: &mut Context<'_>,
        ) -> Poll<Option<Result<hyper::body::Frame<Self::Data>, Self::Error>>> {
            Poll::Pending
        }
    }
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let router = Router::new().route(
        "/",
        axum::routing::get(|| async { axum::body::Body::new(PendingBody) }),
    );
    let (signal, started) = tokio::sync::oneshot::channel();
    let server = tokio::spawn(serve_with_drain(
        listener,
        router,
        async move {
            started.await.unwrap();
            Instant::now() + Duration::from_secs(1)
        },
        Duration::from_millis(30),
    ));
    let mut client = TcpStream::connect(address).await.unwrap();
    client
        .write_all(b"GET / HTTP/1.1\r\nHost: localhost\r\n\r\n")
        .await
        .unwrap();
    let mut header = Vec::new();
    tokio::time::timeout(Duration::from_secs(1), async {
        while !header.ends_with(b"\r\n\r\n") {
            header.push(client.read_u8().await.unwrap());
        }
    })
    .await
    .unwrap();
    signal.send(()).unwrap();
    tokio::time::timeout(Duration::from_secs(1), server)
        .await
        .unwrap()
        .unwrap()
        .0
        .unwrap();
    let read = tokio::time::timeout(Duration::from_secs(1), client.read(&mut [0]))
        .await
        .unwrap();
    assert!(matches!(read, Ok(0) | Err(_)));
}
