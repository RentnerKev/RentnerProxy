use super::*;
use models::{Error, Issue, Status};

#[test]
fn opt_in_is_exact_and_private_metadata_never_reaches_candidates() {
    for enable in [None, Some("false"), Some("TRUE"), Some("1")] {
        let mut value = container('a');
        let labels = value["Config"]["Labels"].as_object_mut().unwrap();
        labels.remove("rentnerproxy.enable");
        if let Some(enable) = enable {
            labels.insert("rentnerproxy.enable".into(), json!(enable));
        }
        assert!(labels::candidate(serde_json::from_value(value).unwrap()).is_none());
    }
    let result = candidate(container('a'));
    assert!(result.issues.is_empty());
    assert_eq!(result.target.as_ref().unwrap().port, 8080);
    let serialized = serde_json::to_string(&result).unwrap();
    assert!(!serialized.contains("SYNTHETIC"));
}

#[test]
fn domains_and_references_are_validated_without_echoing_rejected_values() {
    for value in [
        "",
        "https://example.com",
        "*.example.com",
        "a..example.com",
        "a.example,a.example",
        "a.example,",
        "127.0.0.1",
        "0x7f000001",
        "2130706433",
        "127.000.000.001",
        "hello world",
    ] {
        let mut data = container('a');
        data["Config"]["Labels"]["rentnerproxy.domains"] = json!(value);
        assert!(
            candidate(data).issues.contains(&Issue::InvalidDomains),
            "{value}"
        );
    }
    let mut data = container('a');
    data["Config"]["Labels"]["rentnerproxy.domains"] = json!(" B.example, a.EXAMPLE ");
    data["Config"]["Labels"]["rentnerproxy.certificate"] = json!(ACTOR);
    data["Config"]["Labels"]["rentnerproxy.access-policy"] = json!("untrusted/payload");
    let result = candidate(data);
    assert_eq!(result.domains, ["a.example", "b.example"]);
    assert_eq!(result.certificate_id.as_deref(), Some(ACTOR));
    assert_eq!(result.issues, [Issue::InvalidAccessPolicyReference]);
}

#[test]
fn ports_are_explicit_or_unambiguous_tcp_ports() {
    for (ports, expected) in [
        (json!({}), Issue::MissingPort),
        (json!({"53/udp":{}}), Issue::MissingPort),
        (json!({"80/tcp":{},"443/tcp":{}}), Issue::AmbiguousPort),
    ] {
        let mut data = container('a');
        data["Config"]["ExposedPorts"] = ports;
        assert!(candidate(data).issues.contains(&expected));
    }
    for port in ["0", "65536", "-1", "80/tcp", " 80", "080"] {
        let mut data = container('a');
        data["Config"]["Labels"]["rentnerproxy.port"] = json!(port);
        assert!(candidate(data).issues.contains(&Issue::InvalidPort));
    }
    let mut data = container('a');
    data["Config"]["Labels"]["rentnerproxy.port"] = json!("443");
    data["Config"]["Labels"]["rentnerproxy.protocol"] = json!("https");
    assert_eq!(candidate(data).target.unwrap().scheme, "https");
}

#[test]
fn networks_require_an_attached_unambiguous_address_and_no_host_or_shared_namespace() {
    let mut data = container('a');
    data["NetworkSettings"]["Networks"]["other"] = json!({"IPAddress":"172.23.0.5"});
    assert!(
        candidate(data.clone())
            .issues
            .contains(&Issue::AmbiguousNetwork)
    );
    data["Config"]["Labels"]["rentnerproxy.network"] = json!("proxy");
    assert!(candidate(data.clone()).issues.is_empty());
    data["Config"]["Labels"]["rentnerproxy.network"] = json!("missing");
    assert!(candidate(data).issues.contains(&Issue::MissingNetwork));
    for mode in ["host", "none", "container:other", "service:other"] {
        let mut data = container('a');
        data["HostConfig"]["NetworkMode"] = json!(mode);
        assert!(
            candidate(data)
                .issues
                .contains(&Issue::UnsupportedNetworkMode)
        );
    }
    for address in [
        "",
        "0.0.0.0",
        "127.0.0.1",
        "169.254.0.1",
        "224.0.0.1",
        "::1",
        "::ffff:127.0.0.1",
    ] {
        let mut data = container('a');
        data["NetworkSettings"]["Networks"]["proxy"]["IPAddress"] = json!(address);
        assert!(candidate(data).issues.contains(&Issue::MissingAddress));
    }
    let mut data = container('a');
    data["NetworkSettings"]["Networks"]["proxy"] = json!({"GlobalIPv6Address":"fd00::5"});
    assert_eq!(candidate(data).target.unwrap().address, "fd00::5");
}

#[test]
fn unsupported_labels_stopped_containers_and_domain_conflicts_are_actionable() {
    let mut data = container('a');
    data["Config"]["Labels"]["rentnerproxy.surprise"] = json!("x");
    data["State"]["Running"] = json!(false);
    let mut candidates = vec![candidate(data), candidate(container('b'))];
    labels::conflicts(&mut candidates);
    assert_eq!(
        candidates[0].issues,
        [
            Issue::UnsupportedLabel,
            Issue::ContainerNotRunning,
            Issue::DomainConflict
        ]
    );
    assert_eq!(candidates[1].issues, [Issue::DomainConflict]);
    let mut data = container('a');
    data["Config"]["Labels"]["com.docker.swarm.service.id"] = json!("swarm");
    assert!(
        candidate(data)
            .issues
            .contains(&Issue::UnsupportedOrchestrator)
    );
    let mut data = container('a');
    data["Config"]["Labels"]["rentnerproxy.protocol"] = json!("ftp");
    let result = candidate(data);
    assert!(result.target.is_none());
    assert!(result.issues.contains(&Issue::InvalidProtocol));
}

#[test]
fn docker_null_maps_and_paused_containers_are_not_usable_targets() {
    let mut data = container('a');
    data["NetworkSettings"]["Networks"] = Value::Null;
    assert!(candidate(data).issues.contains(&Issue::MissingNetwork));
    let mut data = container('a');
    data["Config"]["Labels"] = Value::Null;
    assert!(labels::candidate(serde_json::from_value(data).unwrap()).is_none());
    for key in ["Paused", "Restarting"] {
        let mut data = container('a');
        data["State"][key] = json!(true);
        assert!(candidate(data).issues.contains(&Issue::ContainerNotRunning));
    }
}

#[test]
fn rust_and_web_share_the_management_snapshot_fixture() {
    let snapshot = models::Snapshot {
        configuration: models::Document {
            version: 1,
            revision: 1,
            settings: models::Configuration {
                enabled: true,
                endpoint: Some("http://docker-proxy:2375".into()),
            },
        },
        status: Status::Ready,
        stale: false,
        error: None,
        candidates: vec![candidate(container('a'))],
    };
    let expected: Value = serde_json::from_str(include_str!(
        "../../fixtures/docker-discovery-snapshot.json"
    ))
    .unwrap();
    assert_eq!(serde_json::to_value(snapshot).unwrap(), expected);
}

#[test]
fn endpoint_contract_rejects_credentials_paths_redirect_inputs_and_unsupported_transports() {
    for value in [
        "unix:///var/run/docker.sock",
        "tcp://docker:2375",
        "http://user:pass@docker:2375",
        "http://docker/path",
        "http://docker/?",
        "http://docker/#",
        "http://docker:0",
        "http://docker/\n",
        "http://docker/\\path",
    ] {
        assert_eq!(
            client::validate_endpoint(value),
            Err(Error::InvalidInput),
            "{value}"
        );
    }
    for value in [
        "http://docker-socket-proxy:2375",
        "http://127.0.0.1:2375/",
        "https://docker.example.com:2376",
    ] {
        assert_eq!(client::validate_endpoint(value), Ok(()));
    }
}

#[test]
fn event_parser_bounds_partial_lines_deduplicates_and_ignores_unrelated_events() {
    let event = format!(
        "{}\n",
        json!({"Type":"container","Action":"start","Actor":{"ID":"a".repeat(64)},"timeNano":123})
    );
    let mut decoder = client::Events::default();
    assert!(!decoder.push(&event.as_bytes()[..20]).unwrap());
    assert!(decoder.push(&event.as_bytes()[20..]).unwrap());
    assert!(!decoder.push(event.as_bytes()).unwrap());
    assert_eq!(
        decoder.push(&vec![b'x'; 16_385]),
        Err(Error::InvalidResponse)
    );
    let mut decoder = client::Events::default();
    assert!(!decoder.push(format!("{}\n", json!({"Type":"container","Action":"exec_start","Actor":{"ID":"a".repeat(64)},"timeNano":124})).as_bytes()).unwrap());
    assert_eq!(decoder.push(b"garbage\n"), Err(Error::InvalidResponse));
}

#[tokio::test]
async fn configuration_is_optional_revision_guarded_durable_and_restore_requires_explicit_activation()
 {
    let path = directory();
    let discovery = Discovery::new(path.clone());
    assert!(matches!(
        discovery.status().await.unwrap().status,
        Status::Disabled
    ));
    let value = discovery
        .save(save(Some("http://docker-proxy:2375".into()), false, 0))
        .await
        .unwrap();
    assert_eq!(value.configuration.revision, 1);
    assert!(matches!(
        discovery.save(save(None, false, 0)).await,
        Err(Error::Conflict)
    ));
    let restarted = Discovery::new(path.clone());
    assert_eq!(restarted.status().await.unwrap().configuration.revision, 1);
    std::fs::write(
        path.join("docker-discovery-restore-paused"),
        "explicit activation required",
    )
    .unwrap();
    assert!(matches!(
        restarted.status().await.unwrap().status,
        Status::Paused
    ));
    assert!(matches!(
        restarted
            .save(save(Some("http://docker-proxy:2375".into()), true, 1))
            .await,
        Err(Error::Conflict)
    ));
    restarted.save(save(None, false, 1)).await.unwrap();
    assert!(path.join("docker-discovery-restore-paused").exists());
    let mut request = save(Some("http://docker-proxy:2375".into()), true, 2);
    request.acknowledge_restore = true;
    restarted.save(request).await.unwrap();
    assert!(!path.join("docker-discovery-restore-paused").exists());
    restarted.stop().await;
    assert!(matches!(
        restarted.save(save(None, false, 3)).await,
        Err(Error::Stopping)
    ));
    std::fs::remove_dir_all(path).unwrap();
}
