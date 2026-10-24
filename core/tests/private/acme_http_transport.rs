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

fn assert_invalid_input(error: Error, message: &str) {
    let Error::Other(error) = error else {
        panic!("expected input error")
    };
    let error = error.downcast_ref::<io::Error>().unwrap();
    assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
    assert_eq!(error.to_string(), message);
}

#[tokio::test]
async fn insecure_missing_and_credentialed_origins_fail_before_transport() {
    let client = AcmeHttpClient::new(
        None,
        runtime(),
        "unused".to_owned(),
        CertificateEnvironment::Staging,
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
async fn oversized_outbound_body_fails_before_network_request() {
    let client = AcmeHttpClient::new(
        None,
        runtime(),
        "unused".to_owned(),
        CertificateEnvironment::Production,
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
            CertificateEnvironment::Staging
        )
        .is_err()
    );
    let cert = rcgen::generate_simple_self_signed(vec!["ca.example.test".to_owned()]).unwrap();
    assert!(
        AcmeHttpClient::new(
            Some(cert.cert.pem().as_bytes()),
            runtime(),
            "unused".to_owned(),
            CertificateEnvironment::Staging
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
