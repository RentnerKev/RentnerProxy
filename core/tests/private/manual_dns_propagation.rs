use super::*;
use hickory_resolver::proto::{
    op::{Message, ResponseCode},
    rr::{
        Name, Record,
        rdata::{CNAME, TXT},
    },
};
use std::sync::{
    Arc,
    atomic::{AtomicBool, AtomicUsize, Ordering},
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, UdpSocket},
    task::JoinHandle,
};

struct Fixture {
    address: SocketAddr,
    tasks: Vec<JoinHandle<()>>,
    queries: Arc<AtomicUsize>,
}

impl Drop for Fixture {
    fn drop(&mut self) {
        for task in &self.tasks {
            task.abort();
        }
    }
}

impl Fixture {
    async fn start(handler: impl Fn(Message, bool) -> Message + Send + Sync + 'static) -> Self {
        let udp = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let address = udp.local_addr().unwrap();
        let tcp = TcpListener::bind(address).await.unwrap();
        let handler = Arc::new(handler);
        let queries = Arc::new(AtomicUsize::new(0));
        let udp_handler = handler.clone();
        let udp_queries = queries.clone();
        let udp_task = tokio::spawn(async move {
            let mut bytes = vec![0; 65535];
            loop {
                let (length, peer) = udp.recv_from(&mut bytes).await.unwrap();
                udp_queries.fetch_add(1, Ordering::SeqCst);
                let request = Message::from_vec(&bytes[..length]).unwrap();
                let response = udp_handler(request, false).to_vec().unwrap();
                udp.send_to(&response, peer).await.unwrap();
            }
        });
        let tcp_queries = queries.clone();
        let tcp_task = tokio::spawn(async move {
            loop {
                let (mut stream, _) = tcp.accept().await.unwrap();
                let length = stream.read_u16().await.unwrap();
                let mut bytes = vec![0; usize::from(length)];
                stream.read_exact(&mut bytes).await.unwrap();
                tcp_queries.fetch_add(1, Ordering::SeqCst);
                let request = Message::from_vec(&bytes).unwrap();
                let response = handler(request, true).to_vec().unwrap();
                stream
                    .write_u16(u16::try_from(response.len()).unwrap())
                    .await
                    .unwrap();
                stream.write_all(&response).await.unwrap();
            }
        });
        Self {
            address,
            tasks: vec![udp_task, tcp_task],
            queries,
        }
    }

    fn resolver(&self) -> TokioResolver {
        resolver(Some(self.address)).unwrap()
    }
}

fn response(request: &Message) -> Message {
    let mut answer = Message::response(request.metadata.id, request.metadata.op_code);
    answer.metadata.recursion_desired = request.metadata.recursion_desired;
    answer.metadata.recursion_available = true;
    answer.metadata.authoritative = true;
    answer.add_queries(request.queries.clone());
    answer
}

fn txt(chunks: &[&str]) -> RData {
    RData::TXT(TXT::new(
        chunks.iter().map(|value| (*value).to_owned()).collect(),
    ))
}

fn values(values: &[&str]) -> BTreeSet<Vec<u8>> {
    values
        .iter()
        .map(|value| value.as_bytes().to_vec())
        .collect()
}

fn groups(owner: &str, expected: &[&str]) -> ExpectedRecords {
    BTreeMap::from([(owner.to_owned(), values(expected))])
}

fn record(identifier: &str, value: &str) -> ManualDnsRecord {
    ManualDnsRecord {
        identifier: identifier.to_owned(),
        owner: format!(
            "_acme-challenge.{}",
            identifier.strip_prefix("*.").unwrap_or(identifier)
        ),
        value: value.to_owned(),
        expires_at: "2026-10-25T00:00:00Z".to_owned(),
    }
}

#[test]
fn joins_chunks_and_requires_all_complete_values() {
    let answers = [
        txt(&["first", "-value"]),
        txt(&["second"]),
        txt(&["unrelated"]),
    ];
    assert!(match_values(&answers, &values(&["first-value", "second"])).is_ok());
    assert!(matches!(
        match_values(&answers, &values(&["first"])),
        Err(CertificateError::ManualDnsNotPropagated)
    ));
    assert!(matches!(
        match_values(&answers, &values(&["first-value", "missing"])),
        Err(CertificateError::ManualDnsNotPropagated)
    ));
    assert!(matches!(
        match_values(&[], &values(&["first-value"])),
        Err(CertificateError::ManualDnsNotPropagated)
    ));
}

#[test]
fn bounds_txt_bytes_and_record_count_even_for_unrelated_values() {
    let huge = "x".repeat(MAX_TXT_BYTES + 1);
    assert!(matches!(
        match_values(&[txt(&[&huge])], &values(&["x"])),
        Err(CertificateError::ManualDnsLookupFailed)
    ));
    let many = vec![txt(&["x"]); MAX_TXT_RECORDS + 1];
    assert!(matches!(
        match_values(&many, &values(&["x"])),
        Err(CertificateError::ManualDnsLookupFailed)
    ));
}

#[test]
fn groups_apex_wildcard_and_rejects_untrusted_owner_or_excessive_records() {
    let a = "a".repeat(43);
    let b = "b".repeat(43);
    let grouped =
        expected_records(&[record("example.com", &a), record("*.example.com", &b)]).unwrap();
    assert_eq!(grouped.len(), 1);
    assert_eq!(grouped["_acme-challenge.example.com."].len(), 2);
    let mut tampered = record("example.com", &a);
    tampered.owner = "_acme-challenge.other.example.com".to_owned();
    assert!(expected_records(&[tampered]).is_err());
    assert!(expected_records(&vec![record("example.com", &a); MAX_RECORDS + 1]).is_err());
    assert!(expected_records(&[]).is_err());
    let long_domain = [
        "a".repeat(63),
        "b".repeat(63),
        "c".repeat(63),
        "d".repeat(50),
    ]
    .join(".");
    assert!(expected_records(&[record(&long_domain, &a)]).is_err());
    assert!(expected_records(&vec![record("example.com", &a); MAX_RECORDS]).is_ok());
}

#[test]
fn test_override_is_staging_loopback_only_and_requires_valid_acme_fixture() {
    let check = |environment, address: &str, directory: &str, root: &str| {
        configured_test_address(
            environment,
            Some(address.to_owned()),
            Some(directory.to_owned()),
            Some(root.to_owned()),
        )
    };
    let root = std::env::temp_dir()
        .join("fixture-root.pem")
        .to_string_lossy()
        .into_owned();
    assert_eq!(
        check(
            CertificateEnvironment::Staging,
            "127.0.0.1:5053",
            "https://localhost:14000/dir",
            &root
        )
        .unwrap(),
        Some("127.0.0.1:5053".parse().unwrap())
    );
    assert!(
        check(
            CertificateEnvironment::Staging,
            "[::1]:5053",
            "https://localhost/dir",
            &root
        )
        .is_ok()
    );
    for address in [
        "192.0.2.1:53",
        "0.0.0.0:53",
        "127.0.0.1:0",
        "localhost:53",
        " 127.0.0.1:53",
    ] {
        assert!(
            check(
                CertificateEnvironment::Staging,
                address,
                "https://localhost/dir",
                &root
            )
            .is_err()
        );
    }
    for directory in [
        "http://localhost/dir",
        "https://user@localhost/dir",
        "https://localhost/dir?x=1",
        " https://localhost/dir",
    ] {
        assert!(
            check(
                CertificateEnvironment::Staging,
                "127.0.0.1:53",
                directory,
                &root
            )
            .is_err()
        );
    }
    assert!(
        check(
            CertificateEnvironment::Production,
            "127.0.0.1:53",
            "https://localhost/dir",
            &root
        )
        .is_err()
    );
    assert!(
        check(
            CertificateEnvironment::Staging,
            "127.0.0.1:53",
            "https://localhost/dir",
            "relative.pem"
        )
        .is_err()
    );
    assert!(
        configured_test_address(
            CertificateEnvironment::Staging,
            Some("127.0.0.1:53".to_owned()),
            None,
            None
        )
        .is_err()
    );
    assert!(
        configured_test_address(
            CertificateEnvironment::Production,
            None,
            Some("https://localhost/dir".to_owned()),
            None
        )
        .is_err()
    );
}

#[tokio::test]
async fn queries_one_owner_for_multiple_values_and_observes_fresh_retries() {
    let propagated = Arc::new(AtomicBool::new(false));
    let state = propagated.clone();
    let fixture = Fixture::start(move |request, _| {
        let mut answer = response(&request);
        if state.load(Ordering::SeqCst) {
            answer.add_answer(Record::from_rdata(
                request.queries[0].name().clone(),
                3600,
                txt(&["apex"]),
            ));
            answer.add_answer(Record::from_rdata(
                request.queries[0].name().clone(),
                3600,
                txt(&["wild", "card"]),
            ));
            answer.add_answer(Record::from_rdata(
                request.queries[0].name().clone(),
                3600,
                txt(&["unrelated"]),
            ));
        } else {
            answer.metadata.response_code = ResponseCode::NXDomain;
        }
        answer
    })
    .await;
    let resolver = fixture.resolver();
    let expected = groups("_acme-challenge.example.com.", &["apex", "wildcard"]);
    assert!(matches!(
        check_with_resolver(expected.clone(), resolver.clone(), LOOKUP_TIMEOUT).await,
        Err(CertificateError::ManualDnsNotPropagated)
    ));
    propagated.store(true, Ordering::SeqCst);
    assert!(
        check_with_resolver(expected, resolver, LOOKUP_TIMEOUT)
            .await
            .is_ok()
    );
    assert_eq!(fixture.queries.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn follows_cname_to_txt_target() {
    let fixture = Fixture::start(|request, _| {
        let mut answer = response(&request);
        let owner = request.queries[0].name().clone();
        let data = if owner
            .to_ascii()
            .eq_ignore_ascii_case("_acme-challenge.example.com.")
        {
            RData::CNAME(CNAME(Name::from_ascii("delegate.example.net.").unwrap()))
        } else {
            txt(&["right-value"])
        };
        answer.add_answer(Record::from_rdata(owner, 60, data));
        answer
    })
    .await;
    assert!(
        check_with_resolver(
            groups("_acme-challenge.example.com.", &["right-value"]),
            fixture.resolver(),
            LOOKUP_TIMEOUT
        )
        .await
        .is_ok()
    );
    assert_eq!(fixture.queries.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn cname_loop_fails_with_bounded_queries() {
    let fixture = Fixture::start(|request, _| {
        let mut answer = response(&request);
        let owner = request.queries[0].name().clone();
        let target = if owner
            .to_ascii()
            .eq_ignore_ascii_case("_acme-challenge.example.com.")
        {
            "loop.example.net."
        } else {
            "_acme-challenge.example.com."
        };
        answer.add_answer(Record::from_rdata(
            owner,
            60,
            RData::CNAME(CNAME(Name::from_ascii(target).unwrap())),
        ));
        answer
    })
    .await;
    let result = timeout(
        Duration::from_secs(2),
        check_with_resolver(
            groups("_acme-challenge.example.com.", &["value"]),
            fixture.resolver(),
            Duration::from_millis(500),
        ),
    )
    .await
    .unwrap();
    assert!(result.is_err());
    assert!(fixture.queries.load(Ordering::SeqCst) <= 16);
}

#[tokio::test]
async fn truncated_udp_retries_over_tcp() {
    let fixture = Fixture::start(|request, tcp| {
        let mut answer = response(&request);
        if tcp {
            answer.add_answer(Record::from_rdata(
                request.queries[0].name().clone(),
                60,
                txt(&["value"]),
            ));
        } else {
            answer.metadata.truncation = true;
        }
        answer
    })
    .await;
    assert!(
        check_with_resolver(
            groups("_acme-challenge.example.com.", &["value"]),
            fixture.resolver(),
            LOOKUP_TIMEOUT
        )
        .await
        .is_ok()
    );
    assert_eq!(fixture.queries.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn unreachable_and_silent_servers_fail_within_lookup_deadline() {
    let silent = UdpSocket::bind("127.0.0.1:0").await.unwrap();
    let address = silent.local_addr().unwrap();
    let result = timeout(
        Duration::from_secs(1),
        check_with_resolver(
            groups("_acme-challenge.example.com.", &["value"]),
            resolver(Some(address)).unwrap(),
            Duration::from_millis(50),
        ),
    )
    .await
    .unwrap();
    assert!(matches!(
        result,
        Err(CertificateError::ManualDnsLookupFailed)
    ));
    drop(silent);
    let result = timeout(
        Duration::from_secs(1),
        check_with_resolver(
            groups("_acme-challenge.example.com.", &["value"]),
            resolver(Some(address)).unwrap(),
            Duration::from_millis(50),
        ),
    )
    .await
    .unwrap();
    assert!(matches!(
        result,
        Err(CertificateError::ManualDnsLookupFailed)
    ));
}

#[tokio::test]
async fn rejects_txt_for_unrelated_owner_and_distinguishes_servfail() {
    for servfail in [false, true] {
        let fixture = Fixture::start(move |request, _| {
            let mut answer = response(&request);
            if servfail {
                answer.metadata.response_code = ResponseCode::ServFail;
            } else {
                answer.add_answer(Record::from_rdata(
                    Name::from_ascii("wrong.example.net.").unwrap(),
                    60,
                    txt(&["value"]),
                ));
            }
            answer
        })
        .await;
        let result = check_with_resolver(
            groups("_acme-challenge.example.com.", &["value"]),
            fixture.resolver(),
            LOOKUP_TIMEOUT,
        )
        .await;
        if servfail {
            assert!(matches!(
                result,
                Err(CertificateError::ManualDnsLookupFailed)
            ));
        } else {
            assert!(matches!(
                result,
                Err(CertificateError::ManualDnsNotPropagated)
            ));
        }
    }
}

#[tokio::test]
async fn total_deadline_bounds_many_slow_owners_and_limits_concurrency() {
    let silent = UdpSocket::bind("127.0.0.1:0").await.unwrap();
    let address = silent.local_addr().unwrap();
    let queries = Arc::new(AtomicUsize::new(0));
    let observed = queries.clone();
    let receiver = tokio::spawn(async move {
        let mut bytes = [0; 4096];
        loop {
            silent.recv_from(&mut bytes).await.unwrap();
            observed.fetch_add(1, Ordering::SeqCst);
        }
    });
    let expected = (0..MAX_RECORDS)
        .map(|i| {
            (
                format!("_acme-challenge.host{i}.example.com."),
                values(&["value"]),
            )
        })
        .collect();
    let result = timeout(
        Duration::from_secs(1),
        check_with_deadline(
            expected,
            resolver(Some(address)).unwrap(),
            Duration::from_secs(2),
            Duration::from_millis(100),
        ),
    )
    .await
    .unwrap();
    receiver.abort();
    assert!(matches!(
        result,
        Err(CertificateError::ManualDnsLookupFailed)
    ));
    let sent = queries.load(Ordering::SeqCst);
    assert!(
        sent > 0 && sent <= MAX_CONCURRENT_OWNERS,
        "unexpected concurrent query count: {sent}"
    );
}
