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
