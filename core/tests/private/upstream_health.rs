use super::*;
use crate::models::{UpstreamMember, UpstreamSelectionPolicy};
use serde_json::{Value, json};

fn unknown() -> PoolHealth {
    PoolHealth::unknown(
        "018f2f52-7c1b-7cc0-9f3c-6a9952c54019",
        &format!("sha256:{}", "a".repeat(64)),
        &UpstreamPool {
            policy: UpstreamSelectionPolicy::First,
            members: vec![
                UpstreamMember {
                    host: "backend.internal".into(),
                    port: 4000,
                },
                UpstreamMember {
                    host: "2001:db8::1".into(),
                    port: 4001,
                },
            ],
            failover: None,
        },
    )
}

/// Builds independently identified Caddy-instance observations over the same DNS/IPv6
/// member tuples, so tests can vary agreement without changing the desired pool.
fn observation(states: &[[bool; 2]]) -> Value {
    json!({
        "host_id":"018f2f52-7c1b-7cc0-9f3c-6a9952c54019", "revision":format!("sha256:{}", "a".repeat(64)),
        "observations":states.iter().enumerate().map(|(index, states)| json!({
            "instance":format!("instance-{index}"),
            "members":[
                {"index":0,"address":"backend.internal:4000","healthy":states[0],"available":states[0]},
                {"index":1,"address":"[2001:db8::1]:4001","healthy":states[1],"available":states[1]},
            ],
        })).collect::<Vec<_>>(),
    })
}

/// Requires instance agreement per member rather than treating partial or conflicting
/// samples as healthy/all-down; one agreed available member still makes the pool usable.
#[test]
fn routing_availability_requires_agreement_for_each_member() {
    for (states, expected, members) in [
        (
            vec![[true, false], [true, false]],
            PoolState::Available,
            [MemberState::Available, MemberState::Unavailable],
        ),
        (
            vec![[false, false], [false, false]],
            PoolState::AllUnavailable,
            [MemberState::Unavailable; 2],
        ),
        (
            vec![[true, false], [false, false]],
            PoolState::Unknown,
            [MemberState::Unknown, MemberState::Unavailable],
        ),
        (
            vec![[true, false], [true, true]],
            PoolState::Available,
            [MemberState::Available, MemberState::Unknown],
        ),
    ] {
        let mut health = unknown();
        health.observe(&serde_json::to_vec(&observation(&states)).unwrap());
        assert_eq!(health.state, expected);
        assert_eq!(
            health
                .members
                .iter()
                .map(|member| member.state)
                .collect::<Vec<_>>(),
            members
        );
        assert!(health.observed_at.is_some());
    }
}

/// Rejects stale identities, incomplete tuples and ambiguous/oversized instance sets.
/// Invalid samples must retain unknown members and no observation timestamp, preventing
/// malformed telemetry from being presented as a current availability decision.
#[test]
fn missing_stale_ambiguous_or_malformed_observations_never_report_all_down_or_healthy() {
    let valid = observation(&[[true, false]]);
    let mut cases = vec![json!({}), observation(&[])];
    for path in ["host_id", "revision"] {
        let mut invalid = valid.clone();
        invalid[path] = json!("different");
        cases.push(invalid);
    }
    for (field, value) in [
        ("index", json!(1)),
        ("address", json!("wrong:4000")),
        ("healthy", json!(false)),
    ] {
        let mut invalid = valid.clone();
        invalid["observations"][0]["members"][0][field] = value;
        cases.push(invalid);
    }
    let mut missing = valid.clone();
    missing["observations"][0]["members"] = json!([]);
    cases.push(missing);
    let mut duplicated = valid.clone();
    duplicated["observations"] = json!([valid["observations"][0], valid["observations"][0]]);
    cases.push(duplicated);
    let mut oversized = valid;
    oversized["observations"] = json!(
        (0..65)
            .map(|_| oversized["observations"][0].clone())
            .collect::<Vec<_>>()
    );
    cases.push(oversized);
    for invalid in cases {
        let mut health = unknown();
        health.observe(&serde_json::to_vec(&invalid).unwrap());
        assert_eq!(health.state, PoolState::Unknown);
        assert!(health.observed_at.is_none());
        assert!(
            health
                .members
                .iter()
                .all(|member| member.state == MemberState::Unknown)
        );
    }
    let mut health = unknown();
    health.observe(b"invalid JSON");
    assert_eq!(health.state, PoolState::Unknown);
}

/// Distinguishes routing capacity from probe health: a healthy but unavailable member
/// cannot make an otherwise unavailable pool appear capable of accepting a request.
#[test]
fn capacity_is_unavailable_even_while_caddy_considers_a_member_healthy() {
    let mut raw = observation(&[[true, false]]);
    raw["observations"][0]["members"][0]["available"] = json!(false);
    let mut health = unknown();
    health.observe(&serde_json::to_vec(&raw).unwrap());
    assert_eq!(health.state, PoolState::AllUnavailable);
}

/// Exhausts all observation permits before lookup to prove concurrent polling is
/// rejected as busy instead of consuming unbounded controller or Caddy resources.
#[tokio::test]
async fn polling_admission_is_bounded() {
    let runtime = ProxyRuntime::new(
        super::super::RuntimeSettings::new(
            std::env::temp_dir().join("pool-health-admission-test"),
            8080,
        ),
        None,
    );
    let _permits = runtime
        .upstream_health_admission
        .acquire_many(8)
        .await
        .unwrap();
    assert!(matches!(
        runtime.upstream_health("unknown").await,
        Err(RuntimeError::Busy)
    ));
}
