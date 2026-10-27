use super::*;
use hickory_resolver::{
    config::{NameServerConfig, ResolverConfig},
    net::runtime::TokioRuntimeProvider,
    proto::{
        op::Message,
        rr::{
            Record,
            rdata::{CAA, CNAME, MX, NS, SOA, SRV, TXT},
        },
    },
};
use std::{net::SocketAddr, sync::Arc};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, UdpSocket},
    task::JoinHandle,
};

const ORIGINAL: &str = "_acme-challenge.example.com";
const ZONE: &str = "validation.example.net";
const TARGET: &str = "proof.validation.example.net";

struct Fixture {
    address: SocketAddr,
    tasks: Vec<JoinHandle<()>>,
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
        let udp_handler = handler.clone();
        let udp_task = tokio::spawn(async move {
            let mut bytes = vec![0; 65535];
            loop {
                let (length, peer) = udp.recv_from(&mut bytes).await.unwrap();
                let request = Message::from_vec(&bytes[..length]).unwrap();
                let response = udp_handler(request, false).to_vec().unwrap();
                udp.send_to(&response, peer).await.unwrap();
            }
        });
        let tcp_task = tokio::spawn(async move {
            loop {
                let (mut stream, _) = tcp.accept().await.unwrap();
                let length = stream.read_u16().await.unwrap();
                let mut bytes = vec![0; usize::from(length)];
                stream.read_exact(&mut bytes).await.unwrap();
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
        }
    }
    fn resolver(&self) -> TokioResolver {
        let mut server = NameServerConfig::udp_and_tcp(self.address.ip());
        for connection in &mut server.connections {
            connection.port = self.address.port();
        }
        let mut builder = TokioResolver::builder_with_config(
            ResolverConfig::from_name_servers(vec![server]),
            TokioRuntimeProvider::default(),
        );
        let opts = builder.options_mut();
        opts.timeout = LOOKUP_TIMEOUT;
        opts.attempts = 1;
        opts.cache_size = 0;
        opts.preserve_intermediates = false;
        builder.build().unwrap()
    }
}
fn name(value: &str) -> Name {
    Name::from_ascii(format!("{value}.")).unwrap()
}
fn record(owner: &str, data: RData) -> Record {
    Record::from_rdata(name(owner), 0, data)
}
fn soa(zone: &str) -> Record {
    record(
        zone,
        RData::SOA(SOA::new(
            name("ns.example.net"),
            name("hostmaster.example.net"),
            1,
            60,
            60,
            300,
            0,
        )),
    )
}
fn response(request: &Message) -> Message {
    let mut answer = Message::response(request.metadata.id, request.metadata.op_code);
    answer.metadata.recursion_desired = request.metadata.recursion_desired;
    answer.metadata.recursion_available = true;
    answer.metadata.authoritative = true;
    answer.add_queries(request.queries.clone());
    answer
}
fn fixture_response(
    request: Message,
    chain: &[&str],
    zone: &str,
    chunks: Option<&[&str]>,
) -> Message {
    let mut answer = response(&request);
    let query = &request.queries[0];
    let owner = canonical_name(query.name()).unwrap();
    match query.query_type() {
        RecordType::CNAME => {
            if let Some(pair) = chain.windows(2).find(|pair| pair[0] == owner) {
                answer.add_answer(record(&owner, RData::CNAME(CNAME(name(pair[1])))));
            } else {
                answer.add_authority(soa(zone));
            }
        }
        RecordType::SOA => {
            if owner == zone {
                answer.add_answer(soa(zone));
            } else {
                answer.add_authority(soa(zone));
            }
        }
        RecordType::NS => {
            answer.add_answer(record(zone, RData::NS(NS(name("ns.example.net")))));
        }
        RecordType::TXT => {
            for pair in chain.windows(2) {
                answer.add_answer(record(pair[0], RData::CNAME(CNAME(name(pair[1])))));
            }
            if let Some(chunks) = chunks {
                answer.add_answer(record(
                    chain.last().unwrap(),
                    RData::TXT(TXT::new(chunks.iter().map(|x| (*x).to_owned()).collect())),
                ));
            } else {
                answer.add_authority(soa(zone));
            }
        }
        _ => {}
    }
    answer
}

#[tokio::test]
async fn resolves_single_and_multiple_cnames_over_udp_and_tcp() {
    for chain in [
        vec![ORIGINAL, TARGET],
        vec![ORIGINAL, "intermediate.example.net", TARGET],
    ] {
        let expected = chain.iter().map(|x| (*x).to_owned()).collect::<Vec<_>>();
        let fixture = Fixture::start(move |request, tcp| {
            if !tcp {
                let mut answer = response(&request);
                answer.metadata.truncation = true;
                return answer;
            }
            fixture_response(request, &chain, ZONE, None)
        })
        .await;
        let binding = resolve_with_resolver(ORIGINAL, ZONE, &fixture.resolver())
            .await
            .unwrap();
        assert_eq!(binding.target_owner, TARGET);
        assert_eq!(binding.cname_chain, expected);
    }
}

#[tokio::test]
async fn ns_delegation_keeps_original_owner_at_underscore_zone_apex() {
    let fixture = Fixture::start(|request, _| {
        fixture_response(request, &[ORIGINAL], ORIGINAL, Some(&["proof"]))
    })
    .await;
    let resolver = fixture.resolver();
    let binding = resolve_with_resolver(ORIGINAL, ORIGINAL, &resolver)
        .await
        .unwrap();
    assert_eq!(binding.target_owner, ORIGINAL);
    assert_eq!(binding.cname_chain, vec![ORIGINAL]);
    check_owner(&binding, &BTreeSet::from([b"proof".to_vec()]), &resolver)
        .await
        .unwrap();
}

#[tokio::test]
async fn rejects_cycles_and_multiple_targets_independently() {
    for cycle in [true, false] {
        let fixture = Fixture::start(move |request, _| {
            let chain = if cycle {
                vec![ORIGINAL, TARGET, ORIGINAL]
            } else {
                vec![ORIGINAL, TARGET]
            };
            let mut answer = fixture_response(request.clone(), &chain, ZONE, None);
            if !cycle
                && request.queries[0].query_type() == RecordType::CNAME
                && canonical_name(request.queries[0].name()).unwrap() == ORIGINAL
            {
                answer.add_answer(record(
                    ORIGINAL,
                    RData::CNAME(CNAME(name("other.example.net"))),
                ));
            }
            answer
        })
        .await;
        assert!(matches!(
            resolve_with_resolver(ORIGINAL, ZONE, &fixture.resolver()).await,
            Err(CertificateError::DnsDelegationInvalid)
        ));
    }
}

#[tokio::test]
async fn rejects_acyclic_alias_data_conflicts_in_every_section() {
    // The alias is otherwise valid and acyclic, so only the coexisting data
    // distinguishes these cases from resolves_single_and_multiple_cnames.
    let conflicts = [
        RData::TXT(TXT::new(vec!["conflict".to_owned()])),
        RData::MX(MX::new(10, name("mail.example.net"))),
        RData::CAA(CAA::new_issue(false, Some(name("ca.example.net")), vec![])),
        RData::SRV(SRV::new(1, 1, 443, name("service.example.net"))),
    ];
    for data in conflicts {
        for section in 0..3 {
            let conflict_data = data.clone();
            let fixture = Fixture::start(move |request, _| {
                let mut answer = fixture_response(request.clone(), &[ORIGINAL, TARGET], ZONE, None);
                if request.queries[0].query_type() == RecordType::CNAME
                    && canonical_name(request.queries[0].name()).unwrap() == ORIGINAL
                {
                    let conflicting = record(ORIGINAL, conflict_data.clone());
                    match section {
                        0 => {
                            answer.add_answer(conflicting);
                        }
                        1 => {
                            answer.add_authority(conflicting);
                        }
                        _ => {
                            answer.add_additional(conflicting);
                        }
                    }
                }
                answer
            })
            .await;
            assert!(
                matches!(
                    resolve_with_resolver(ORIGINAL, ZONE, &fixture.resolver()).await,
                    Err(CertificateError::DnsDelegationInvalid)
                ),
                "section {section}, data {data:?}"
            );
        }
    }
}

#[test]
fn only_alias_dnssec_metadata_types_are_exempt_from_conflicts() {
    for kind in [RecordType::RRSIG, RecordType::NSEC, RecordType::SIG] {
        assert!(cname_metadata_type(kind));
    }
    for kind in [
        RecordType::MX,
        RecordType::CAA,
        RecordType::SRV,
        RecordType::DNSKEY,
        RecordType::NSEC3,
        RecordType::NSEC3PARAM,
        RecordType::Unknown(65280),
    ] {
        assert!(!cname_metadata_type(kind));
    }
}
#[tokio::test]
async fn rejects_direct_zone_false_delegation_wrong_zone_cut_and_missing_ns() {
    let fixture =
        Fixture::start(|request, _| fixture_response(request, &[ORIGINAL], "example.com", None))
            .await;
    assert!(
        resolve_with_resolver(ORIGINAL, "example.com", &fixture.resolver())
            .await
            .is_err()
    );
    let fixture = Fixture::start(|request, _| {
        fixture_response(
            request,
            &[ORIGINAL, TARGET],
            "proof.validation.example.net",
            None,
        )
    })
    .await;
    assert!(
        resolve_with_resolver(ORIGINAL, ZONE, &fixture.resolver())
            .await
            .is_err()
    );
    let fixture = Fixture::start(|request, _| {
        if request.queries[0].query_type() == RecordType::NS {
            return response(&request);
        }
        fixture_response(request, &[ORIGINAL, TARGET], ZONE, None)
    })
    .await;
    assert!(
        resolve_with_resolver(ORIGINAL, ZONE, &fixture.resolver())
            .await
            .is_err()
    );
}

#[tokio::test]
async fn requires_all_logical_txt_values_and_rechecks_persisted_binding() {
    let fixture = Fixture::start(|request, _| {
        fixture_response(request, &[ORIGINAL, TARGET], ZONE, Some(&["chunk", "ed"]))
    })
    .await;
    let resolver = fixture.resolver();
    let binding = resolve_with_resolver(ORIGINAL, ZONE, &resolver)
        .await
        .unwrap();
    check_owner(&binding, &BTreeSet::from([b"chunked".to_vec()]), &resolver)
        .await
        .unwrap();
    for values in [
        BTreeSet::from([b"chunk".to_vec()]),
        BTreeSet::from([b"chunked".to_vec(), b"missing".to_vec()]),
    ] {
        assert!(matches!(
            check_owner(&binding, &values, &resolver).await,
            Err(CertificateError::DnsDelegationNotPropagated)
        ));
    }
    let mut changed = binding.clone();
    changed.cname_chain.insert(1, "old.example.net".to_owned());
    assert!(matches!(
        check_owner(&changed, &BTreeSet::new(), &resolver).await,
        Err(CertificateError::DnsDelegationInvalid)
    ));
    let fixture =
        Fixture::start(|request, _| fixture_response(request, &[ORIGINAL, TARGET], ZONE, None))
            .await;
    assert!(matches!(
        check_owner(
            &binding,
            &BTreeSet::from([b"missing".to_vec()]),
            &fixture.resolver()
        )
        .await,
        Err(CertificateError::DnsDelegationNotPropagated)
    ));
}

#[tokio::test]
async fn unrelated_txt_owner_cannot_satisfy_challenge() {
    let fixture = Fixture::start(|request, _| {
        let mut answer =
            fixture_response(request.clone(), &[ORIGINAL, TARGET], ZONE, Some(&["wrong"]));
        if request.queries[0].query_type() == RecordType::TXT {
            answer.add_answer(record(
                "unrelated.example.net",
                RData::TXT(TXT::new(vec!["expected".to_owned()])),
            ));
        }
        answer
    })
    .await;
    let resolver = fixture.resolver();
    let binding = resolve_with_resolver(ORIGINAL, ZONE, &resolver)
        .await
        .unwrap();
    assert!(matches!(
        check_owner(&binding, &BTreeSet::from([b"expected".to_vec()]), &resolver).await,
        Err(CertificateError::DnsDelegationNotPropagated)
    ));
}

#[tokio::test]
async fn lookup_deadline_bounds_silent_dns() {
    let socket = UdpSocket::bind("127.0.0.1:0").await.unwrap();
    let fixture = Fixture {
        address: socket.local_addr().unwrap(),
        tasks: vec![],
    };
    let resolver = fixture.resolver();
    let began = tokio::time::Instant::now();
    let result = timeout(
        Duration::from_secs(4),
        resolve_with_resolver(ORIGINAL, ZONE, &resolver),
    )
    .await
    .unwrap();
    assert!(matches!(
        result,
        Err(CertificateError::DnsDelegationLookupFailed)
    ));
    assert!(began.elapsed() < Duration::from_secs(4));
}

#[tokio::test]
async fn bounded_cname_hops_reject_a_ninth_alias() {
    let fixture = Fixture::start(|request, _| {
        let mut answer = response(&request);
        let owner = canonical_name(request.queries[0].name()).unwrap();
        let index = if owner == ORIGINAL {
            0
        } else {
            owner
                .strip_prefix('n')
                .unwrap()
                .split('.')
                .next()
                .unwrap()
                .parse::<usize>()
                .unwrap()
        };
        answer.add_answer(record(
            &owner,
            RData::CNAME(CNAME(name(&format!(
                "n{}.validation.example.net",
                index + 1
            )))),
        ));
        answer
    })
    .await;
    assert!(matches!(
        resolve_with_resolver(ORIGINAL, ZONE, &fixture.resolver()).await,
        Err(CertificateError::DnsDelegationInvalid)
    ));
}
