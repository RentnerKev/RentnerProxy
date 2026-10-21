use super::controller_connect_addr;

#[test]
fn controller_connect_address_preserves_explicit_binds_and_maps_wildcards_by_family() {
    for (listen, target) in [
        ("0.0.0.0:49152", "127.0.0.1:49152"),
        ("[::]:49153", "[::1]:49153"),
        ("127.0.0.1:49154", "127.0.0.1:49154"),
        ("192.0.2.10:49155", "192.0.2.10:49155"),
        ("[::1]:49156", "[::1]:49156"),
        ("[2001:db8::10]:49157", "[2001:db8::10]:49157"),
        ("[fe80::1%7]:49158", "[fe80::1%7]:49158"),
    ] {
        assert_eq!(
            controller_connect_addr(listen.parse().unwrap()),
            target.parse().unwrap()
        );
    }
}

#[tokio::test]
async fn controller_connect_address_keeps_the_actual_ephemeral_listener_port() {
    for bind in ["127.0.0.1:0", "[::1]:0", "0.0.0.0:0", "[::]:0"] {
        let listener = tokio::net::TcpListener::bind(bind).await.unwrap();
        let address = listener.local_addr().unwrap();
        let target = controller_connect_addr(address);
        assert_ne!(target.port(), 0);
        assert_eq!(target.port(), address.port());
        let stream = tokio::time::timeout(
            std::time::Duration::from_secs(2),
            tokio::net::TcpStream::connect(target),
        )
        .await
        .unwrap()
        .unwrap();
        drop(stream);
    }
}

#[tokio::test]
async fn http_drain_starts_at_signal_and_cancels_a_stalled_request_and_connection() {
    use axum::{Router, routing::get};
    use std::{sync::Arc, time::Duration};
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpStream,
        sync::{Notify, oneshot},
        time::{Instant, timeout},
    };
    let entered = Arc::new(Notify::new());
    let handler_entered = entered.clone();
    let router = Router::new().route(
        "/",
        get(move || {
            let entered = handler_entered.clone();
            async move {
                entered.notify_one();
                std::future::pending::<&'static str>().await
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let (signal, started) = oneshot::channel();
    let server = tokio::spawn(crate::shutdown::http::serve_with_drain(
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
    timeout(Duration::from_secs(1), entered.notified())
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_millis(60)).await;
    assert!(!server.is_finished(), "normal operation has no drain timer");
    signal.send(()).unwrap();
    let (result, _) = timeout(Duration::from_secs(1), server)
        .await
        .unwrap()
        .unwrap();
    result.unwrap();
    let mut byte = [0];
    let read = timeout(Duration::from_secs(1), client.read(&mut byte))
        .await
        .unwrap();
    assert!(
        matches!(read, Ok(0) | Err(_)),
        "forced drain must close the TCP connection"
    );
}

#[tokio::test]
async fn http_drain_allows_an_admitted_request_to_finish() {
    use axum::{Router, routing::get};
    use std::{sync::Arc, time::Duration};
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        sync::{Notify, oneshot},
        time::{Instant, timeout},
    };
    let entered = Arc::new(Notify::new());
    let finish = Arc::new(Notify::new());
    let (seen, done) = (entered.clone(), finish.clone());
    let router = Router::new().route(
        "/",
        get(move || {
            let (seen, done) = (seen.clone(), done.clone());
            async move {
                seen.notify_one();
                done.notified().await;
                "drained"
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let (signal, started) = oneshot::channel();
    let server = tokio::spawn(crate::shutdown::http::serve_with_drain(
        listener,
        router,
        async move {
            started.await.unwrap();
            Instant::now() + Duration::from_secs(2)
        },
        Duration::from_secs(1),
    ));
    let mut client = tokio::net::TcpStream::connect(address).await.unwrap();
    client
        .write_all(b"GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
        .await
        .unwrap();
    timeout(Duration::from_secs(1), entered.notified())
        .await
        .unwrap();
    signal.send(()).unwrap();
    finish.notify_one();
    let mut response = String::new();
    timeout(Duration::from_secs(2), client.read_to_string(&mut response))
        .await
        .unwrap()
        .unwrap();
    assert!(response.ends_with("drained"));
    timeout(Duration::from_secs(2), server)
        .await
        .unwrap()
        .unwrap()
        .0
        .unwrap();
}
