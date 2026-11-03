use super::*;
use hyper::body::{Body, Frame, SizeHint};
use std::{
    collections::VecDeque,
    sync::atomic::{AtomicUsize, Ordering},
    task::{Context, Poll},
};

fn runtime() -> Arc<ProxyRuntime> {
    crate::runtime::tls::ensure_crypto_provider();
    ProxyRuntime::new(
        crate::runtime::RuntimeSettings::new(
            std::env::temp_dir().join(format!(
                "rentnerproxy-acme-http-{}-{}",
                std::process::id(),
                OffsetDateTime::now_utc().unix_timestamp_nanos()
            )),
            0,
        ),
        None,
    )
}

fn tls_response(response: String) -> (String, Vec<u8>, std::thread::JoinHandle<()>) {
    use std::io::{Read, Write};
    let certificate = rcgen::generate_simple_self_signed(vec!["127.0.0.1".to_owned()]).unwrap();
    let pem = certificate.cert.pem().into_bytes();
    let config = rustls::ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(
            vec![certificate.cert.der().clone()],
            rustls::pki_types::PrivatePkcs8KeyDer::from(certificate.signing_key.serialize_der())
                .into(),
        )
        .unwrap();
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let origin = format!("https://{}", listener.local_addr().unwrap());
    let task = std::thread::spawn(move || {
        let (socket, _) = listener.accept().unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        socket
            .set_write_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let connection = rustls::ServerConnection::new(Arc::new(config)).unwrap();
        let mut stream = rustls::StreamOwned::new(connection, socket);
        let mut request = Vec::new();
        while !request.windows(4).any(|window| window == b"\r\n\r\n") {
            let mut bytes = [0; 4096];
            let read = stream.read(&mut bytes).unwrap();
            assert!(read > 0 && request.len() + read <= 65536);
            request.extend_from_slice(&bytes[..read]);
        }
        assert!(request.starts_with(b"GET /order/1 HTTP/1.1\r\n"));
        stream.write_all(response.as_bytes()).unwrap();
        stream.flush().unwrap();
    });
    (origin, pem, task)
}

#[tokio::test]
async fn trusted_https_responses_observe_expiry_and_persist_ca_retry_deadlines() {
    const ID: &str = "0198d98a-0000-7000-8000-000000000492";
    for status in [200, 202, 429, 503] {
        let runtime = runtime();
        std::fs::create_dir_all(&runtime.settings.state_dir).unwrap();
        runtime.certificate_store.initialize().await.unwrap();
        runtime
            .certificate_store
            .begin_issue(
                ID,
                crate::runtime::CertificateIssueRequest {
                    domains: vec!["example.com".to_owned()],
                    environment: CertificateEnvironment::Staging,
                    contact_email: None,
                    challenge_type: Default::default(),
                    dns_mode: Default::default(),
                    dns_provider: None,
                    accept_terms: true,
                },
                false,
            )
            .await
            .unwrap();
        let body = r#"{"status":"pending","expires":"2099-01-01T00:00:00Z"}"#;
        let response = format!(
            "HTTP/1.1 {status} Fixture\r\nContent-Length: {}\r\nContent-Type: application/json\r\nRetry-After: 120\r\nLocation: /order/1\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        let (origin, pem, server) = tls_response(response);
        let observer = AcmeResponseObserver::default();
        let client = AcmeHttpClient::new(
            Some(&pem),
            Arc::clone(&runtime),
            ID.to_owned(),
            CertificateEnvironment::Staging,
            &format!("{origin}/directory"),
        )
        .unwrap()
        .observing(observer.clone());
        let request = Request::builder()
            .uri(format!("{origin}/order/1"))
            .body(BodyWrapper::default())
            .unwrap();
        let mut response = client.request(request).await.unwrap();
        assert_eq!(response.parts.status.as_u16(), status);
        assert_eq!(
            response.body.into_bytes().await.unwrap().as_ref(),
            body.as_bytes()
        );
        server.join().unwrap();
        let metadata = runtime.certificate_store.get(ID).await.unwrap();
        let deadline =
            OffsetDateTime::parse(metadata.next_attempt_at.as_deref().unwrap(), &Rfc3339).unwrap();
        assert!(deadline > OffsetDateTime::now_utc() + time::Duration::seconds(100));
        assert_eq!(
            observer.expires_at("/order/1"),
            (status < 300).then(|| "2099-01-01T00:00:00Z".to_owned())
        );
        let reopened = crate::runtime::CertificateStore::new(runtime.settings.state_dir.clone());
        reopened.initialize().await.unwrap();
        let restarted = reopened.get(ID).await.unwrap();
        assert!(
            OffsetDateTime::parse(restarted.next_attempt_at.as_deref().unwrap(), &Rfc3339).unwrap()
                >= deadline
        );
        let index: serde_json::Value = serde_json::from_slice(
            &std::fs::read(
                runtime
                    .settings
                    .state_dir
                    .join("certificates/certificate-metadata.json"),
            )
            .unwrap(),
        )
        .unwrap();
        assert_eq!(
            index["acmeRetryUntil"].get("staging").is_some(),
            status >= 400
        );
        std::fs::remove_dir_all(&runtime.settings.state_dir).unwrap();
    }
}

fn assert_invalid_input(error: Error, message: &str) {
    let Error::Other(error) = error else {
        panic!("expected input error")
    };
    let error = error.downcast_ref::<io::Error>().unwrap();
    assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
    assert_eq!(error.to_string(), message);
}

#[tokio::test]
async fn ca_retry_persistence_failure_is_reported_before_returning_ca_response() {
    for (status, message) in [
        (202, "unable to persist ACME retry deadline"),
        (429, "unable to persist ACME account retry deadline"),
    ] {
        let runtime = runtime();
        std::fs::create_dir_all(&runtime.settings.state_dir).unwrap();
        runtime.certificate_store.initialize().await.unwrap();
        runtime
            .certificate_store
            .begin_issue(
                "0198d98a-0000-7000-8000-000000000492",
                crate::runtime::CertificateIssueRequest {
                    domains: vec!["example.com".to_owned()],
                    environment: CertificateEnvironment::Staging,
                    contact_email: None,
                    challenge_type: Default::default(),
                    dns_mode: Default::default(),
                    dns_provider: None,
                    accept_terms: true,
                },
                false,
            )
            .await
            .unwrap();
        let index = runtime
            .settings
            .state_dir
            .join("certificates/certificate-metadata.json");
        std::fs::remove_file(&index).unwrap();
        std::fs::create_dir(&index).unwrap();
        let (origin, pem, server) = tls_response(format!(
            "HTTP/1.1 {status} Fixture\r\nContent-Length: 2\r\nRetry-After: 120\r\nConnection: close\r\n\r\n{{}}"
        ));
        let client = AcmeHttpClient::new(
            Some(&pem),
            Arc::clone(&runtime),
            "0198d98a-0000-7000-8000-000000000492".into(),
            CertificateEnvironment::Staging,
            &format!("{origin}/directory"),
        )
        .unwrap();
        let request = Request::builder()
            .uri(format!("{origin}/order/1"))
            .body(BodyWrapper::default())
            .unwrap();
        assert_invalid_input(client.request(request).await.err().unwrap(), message);
        server.join().unwrap();
        std::fs::remove_dir_all(&runtime.settings.state_dir).unwrap();
    }
}

#[test]
fn expiry_observer_bounds_memory_and_ignores_poisoned_state() {
    let observer = AcmeResponseObserver::default();
    let body = br#"{"status":"pending","expires":"2099-01-01T00:00:00Z"}"#;
    for index in 0..256 {
        observer.observe(&format!("order/{index}"), None, body);
    }
    assert_eq!(
        observer.expires_at("order/255").as_deref(),
        Some("2099-01-01T00:00:00Z")
    );
    observer.observe("order/256", None, body);
    assert!(observer.expires_at("order/256").is_none());
    let poisoned = observer.clone();
    assert!(
        std::thread::spawn(move || {
            let _lock = poisoned.0.lock().unwrap();
            panic!("fixture poison");
        })
        .join()
        .is_err()
    );
    assert!(observer.expires_at("order/0").is_none());
    observer.observe("order/new", None, body);
    assert!(observer.expires_at("order/new").is_none());
}

#[tokio::test]
async fn insecure_missing_and_credentialed_origins_fail_before_transport() {
    let client = AcmeHttpClient::new(
        None,
        runtime(),
        "unused".to_owned(),
        CertificateEnvironment::Staging,
        "https://ca.example.test/directory",
    )
    .unwrap();
    for uri in [
        "http://ca.example.test/directory",
        "/directory",
        "ca.example.test:443",
        "https://user:password@ca.example.test/directory",
    ] {
        let request = Request::builder()
            .uri(uri)
            .body(BodyWrapper::default())
            .unwrap();
        assert_invalid_input(
            client.request(request).await.err().unwrap(),
            "ACME requests require an HTTPS origin",
        );
    }
}

#[tokio::test]
async fn changed_finalization_and_certificate_origins_fail_before_transport() {
    let client = AcmeHttpClient::new(
        None,
        runtime(),
        "unused".to_owned(),
        CertificateEnvironment::Staging,
        "https://ca.example.test:8443/directory",
    )
    .unwrap();
    for uri in [
        "https://other.example.test:8443/finalize/1",
        "https://other.example.test:8443/certificate/1",
        "https://ca.example.test/finalize/1",
        "https://ca.example.test:9443/certificate/1",
        "https://127.0.0.1:8443/certificate/1",
    ] {
        let request = Request::builder()
            .method("POST")
            .uri(uri)
            .body(BodyWrapper::from(b"signed account request".to_vec()))
            .unwrap();
        assert_invalid_input(
            client.request(request).await.err().unwrap(),
            "ACME request must use the configured directory origin",
        );
    }
}

#[tokio::test]
async fn default_https_port_is_the_same_directory_origin() {
    let client = AcmeHttpClient::new(
        None,
        runtime(),
        "unused".to_owned(),
        CertificateEnvironment::Staging,
        "https://ca.example.test:443/directory",
    )
    .unwrap();
    let request = Request::builder()
        .method("POST")
        .uri("https://ca.example.test/finalize/1")
        .body(BodyWrapper::from(vec![
            b'x';
            MAX_ACME_REQUEST_BODY_BYTES + 1
        ]))
        .unwrap();
    assert_invalid_input(
        client.request(request).await.err().unwrap(),
        "ACME request body is too large",
    );
}

#[tokio::test]
async fn oversized_outbound_body_fails_before_network_request() {
    let client = AcmeHttpClient::new(
        None,
        runtime(),
        "unused".to_owned(),
        CertificateEnvironment::Production,
        "https://ca.example.test/directory",
    )
    .unwrap();
    let request = Request::builder()
        .method("POST")
        .uri("https://ca.example.test/order")
        .body(BodyWrapper::from(vec![
            b'x';
            MAX_ACME_REQUEST_BODY_BYTES + 1
        ]))
        .unwrap();
    assert_invalid_input(
        client.request(request).await.err().unwrap(),
        "ACME request body is too large",
    );
}

#[test]
fn custom_ca_requires_valid_certificate_pem() {
    assert!(
        AcmeHttpClient::new(
            Some(b"-----BEGIN CERTIFICATE-----\ninvalid!\n-----END CERTIFICATE-----\n"),
            runtime(),
            "unused".to_owned(),
            CertificateEnvironment::Staging,
            "https://ca.example.test/directory",
        )
        .is_err()
    );
    let cert = rcgen::generate_simple_self_signed(vec!["ca.example.test".to_owned()]).unwrap();
    assert!(
        AcmeHttpClient::new(
            Some(cert.cert.pem().as_bytes()),
            runtime(),
            "unused".to_owned(),
            CertificateEnvironment::Staging,
            "https://ca.example.test/directory",
        )
        .is_ok()
    );
}

struct ChunkedBody {
    chunks: VecDeque<Result<Bytes, io::Error>>,
    declared_length: Option<u64>,
    polls: Arc<AtomicUsize>,
}

impl Body for ChunkedBody {
    type Data = Bytes;
    type Error = io::Error;
    fn poll_frame(
        mut self: Pin<&mut Self>,
        _: &mut Context<'_>,
    ) -> Poll<Option<Result<Frame<Self::Data>, Self::Error>>> {
        self.polls.fetch_add(1, Ordering::Relaxed);
        Poll::Ready(self.chunks.pop_front().map(|chunk| chunk.map(Frame::data)))
    }
    fn size_hint(&self) -> SizeHint {
        let mut hint = SizeHint::new();
        if let Some(length) = self.declared_length {
            hint.set_exact(length);
        }
        hint
    }
}

fn response(
    chunks: Vec<Result<Bytes, io::Error>>,
    declared_length: Option<u64>,
) -> (reqwest::Response, Arc<AtomicUsize>) {
    let polls = Arc::new(AtomicUsize::new(0));
    let body = ChunkedBody {
        chunks: chunks.into(),
        declared_length,
        polls: Arc::clone(&polls),
    };
    (
        reqwest::Response::from(Response::new(reqwest::Body::wrap(body))),
        polls,
    )
}

#[tokio::test]
async fn declared_oversized_response_is_rejected_without_reading() {
    let (response, polls) = response(
        vec![Ok(Bytes::from_static(b"never read"))],
        Some(MAX_ACME_RESPONSE_BODY_BYTES as u64 + 1),
    );
    assert_invalid_input(
        read_bounded_body(response).await.err().unwrap(),
        "ACME response body is too large",
    );
    assert_eq!(polls.load(Ordering::Relaxed), 0);
}

#[tokio::test]
async fn unknown_length_response_is_capped_across_chunk_boundaries() {
    let (response, polls) = response(
        vec![
            Ok(Bytes::from(vec![b'x'; MAX_ACME_RESPONSE_BODY_BYTES])),
            Ok(Bytes::from_static(b"x")),
            Err(io::Error::other("must not read past limit")),
        ],
        None,
    );
    assert_invalid_input(
        read_bounded_body(response).await.err().unwrap(),
        "ACME response body is too large",
    );
    assert_eq!(polls.load(Ordering::Relaxed), 2);
}

#[tokio::test]
async fn bounded_response_preserves_chunks_empty_bodies_and_exact_limit() {
    for chunks in [
        vec![],
        vec![
            Bytes::from_static(b"first"),
            Bytes::new(),
            Bytes::from_static(b"second"),
        ],
        vec![Bytes::from(vec![b'x'; MAX_ACME_RESPONSE_BODY_BYTES])],
    ] {
        let expected = chunks
            .iter()
            .flat_map(|chunk| chunk.iter().copied())
            .collect::<Vec<_>>();
        let (response, _) = response(chunks.into_iter().map(Ok).collect(), None);
        assert_eq!(read_bounded_body(response).await.unwrap(), expected);
    }
}

#[tokio::test]
async fn interrupted_response_fails_instead_of_returning_partial_certificate() {
    let (response, polls) = response(
        vec![
            Ok(Bytes::from_static(b"partial certificate")),
            Err(io::Error::new(
                io::ErrorKind::ConnectionReset,
                "test connection reset",
            )),
        ],
        None,
    );
    let result = read_bounded_body(response).await;
    assert!(matches!(result, Err(Error::Other(_))));
    assert_eq!(polls.load(Ordering::Relaxed), 2);
}

#[test]
fn manual_expiry_observer_keeps_exact_ca_deadlines_at_order_location() {
    let observer = AcmeResponseObserver::default();
    let order = "https://ca.example.test/order/1";
    observer.observe(
        "https://ca.example.test/orders",
        Some(order),
        br#"{"status":"pending","expires":"2030-01-02T03:04:05Z"}"#,
    );
    assert_eq!(
        observer.expires_at(order).as_deref(),
        Some("2030-01-02T03:04:05Z")
    );
    for body in [
        br#"{"status":"pending"}"#.as_slice(),
        br#"{"status":"pending","expires":"tomorrow"}"#.as_slice(),
        br#"{"expires":"2030-01-02T03:04:05Z"}"#.as_slice(),
    ] {
        observer.observe("https://ca.example.test/auth/invalid", None, body);
    }
    assert!(
        observer
            .expires_at("https://ca.example.test/auth/invalid")
            .is_none()
    );
    assert!(
        observer
            .expires_at("https://ca.example.test/orders")
            .is_none()
    );
}
