use super::{
    CrowdSecDashboardQuery, DashboardData, metric_sample, parse_decisions, parse_metrics,
    snapshot_for,
};

#[test]
fn parses_real_bouncer_counter_and_decision_gauge_without_other_metrics() {
    let body = br#"
# HELP crowdsec_requests_blocked Blocked requests
# TYPE crowdsec_requests_blocked counter
crowdsec_requests_blocked{server="http",origin="crowdsec",remediation="ban",ip_type="v4"} 12
crowdsec_requests_blocked{server="https",origin="CAPI",remediation="ban",ip_type="v6"} 3
crowdsec_decisions_active{origin="crowdsec",ip_type="v4"} 5
crowdsec_decisions_active{origin="CAPI",ip_type="v6"} 2
caddy_http_requests_total{server="http"} 1000
"#;
    let metrics = parse_metrics(body).expect("CrowdSec metrics should parse");
    assert_eq!(metrics.blocked_requests, Some(15));
    assert_eq!(metrics.active_decisions, Some(7));
    assert_eq!(metrics.blocked_by_origin[0].origin, "crowdsec");
    assert_eq!(metrics.blocked_by_origin[0].count, 12);
    assert_eq!(metrics.decisions_by_origin[0].count, 5);
}

#[test]
fn absent_metrics_are_unknown_not_zero() {
    assert!(parse_metrics(b"caddy_http_requests_total 100\n").is_none());
    let metrics = parse_metrics(b"# TYPE crowdsec_requests_blocked counter\n").unwrap();
    assert_eq!(metrics.blocked_requests, Some(0));
    assert_eq!(metrics.active_decisions, None);
    assert!(parse_metrics(b"crowdsec_requests_blocked{origin=\"local\"} NaN\n").is_none());
    assert!(metric_sample("crowdsec_requests_blocked{origin=\"local\"} 1").is_some());
}

#[test]
fn missing_blocked_counter_is_zero_when_bouncer_gauge_is_available() {
    let metrics =
        parse_metrics(b"crowdsec_decisions_active{origin=\"CAPI\",ip_type=\"ipv4\"} 15002\n")
            .expect("active bouncer gauge should parse");
    assert_eq!(metrics.blocked_requests, Some(0));
    assert!(metrics.blocked_by_origin.is_empty());
    assert_eq!(metrics.active_decisions, Some(15_002));
}

#[test]
fn lists_only_active_ip_and_network_bans_with_bounded_metadata() {
    let body = br#"[
      {"id":1,"type":"ban","scope":"Ip","value":"203.0.113.4","origin":"crowdsec","scenario":"http-bf","duration":"2h15m"},
      {"id":2,"type":"captcha","scope":"Ip","value":"203.0.113.5","origin":"crowdsec","scenario":"http-bf","duration":"1h"},
      {"id":3,"type":"ban","scope":"ip","value":"2001:db8::/64","origin":"CAPI","scenario":"community","duration":"30m"},
      {"id":4,"type":"ban","scope":"Country","value":"DE","origin":"CAPI","scenario":"community","duration":"1h"},
      {"id":5,"type":"ban","scope":"Ip","value":"not-an-ip","origin":"crowdsec","scenario":"http-bf","duration":"1h"}
    ]"#;
    let decisions = parse_decisions(body).expect("valid LAPI response");
    assert_eq!(decisions.len(), 2);
    assert_eq!(decisions[0].id, 3);
    assert_eq!(decisions[0].scope, "Range");
    assert_eq!(decisions[0].value, "2001:db8::/64");
    assert_eq!(decisions[1].duration, "2h15m");
}

#[test]
fn empty_lapi_response_is_zero_but_malformed_is_unavailable() {
    assert_eq!(parse_decisions(b"null").unwrap().len(), 0);
    assert_eq!(parse_decisions(b"[]").unwrap().len(), 0);
    assert!(parse_decisions(b"{}").is_none());
    assert!(parse_decisions(b"not json").is_none());
}

#[test]
fn pages_and_filters_all_active_bans_without_undercounting() {
    let rows = (1..=55)
        .map(|id| {
            serde_json::json!({
                "id": id,
                "type": "ban",
                "scope": "Ip",
                "value": format!("203.0.113.{id}"),
                "origin": if id % 2 == 0 { "CAPI" } else { "crowdsec" },
                "scenario": "http-bf",
                "duration": "2h"
            })
        })
        .collect::<Vec<_>>();
    let body = serde_json::to_vec(&rows).unwrap();
    let decisions = parse_decisions(&body).unwrap();
    let data = DashboardData {
        collected_at: 1,
        metrics: None,
        decisions: Some(decisions),
    };
    let query = CrowdSecDashboardQuery {
        offset: 15,
        limit: 15,
        search: String::new(),
        origin: String::new(),
        scope: String::new(),
    };
    let page = snapshot_for(&data, &query).decisions.unwrap();
    assert_eq!(page.total, 55);
    assert_eq!(page.filtered_total, 55);
    assert_eq!(page.entries.len(), 15);
    assert_eq!(page.entries[0].id, 40);

    let filtered = snapshot_for(
        &data,
        &CrowdSecDashboardQuery {
            offset: 0,
            limit: 15,
            search: "203.0.113.24".to_owned(),
            origin: "capi".to_owned(),
            scope: "Ip".to_owned(),
        },
    )
    .decisions
    .unwrap();
    assert_eq!(filtered.total, 55);
    assert_eq!(filtered.filtered_total, 1);
    assert_eq!(filtered.entries[0].id, 24);
}

#[test]
fn validates_bounded_dashboard_queries() {
    let mut query = CrowdSecDashboardQuery::default();
    assert!(query.validate());
    query.limit = 101;
    assert!(!query.validate());
    query.limit = 15;
    query.search = "bad\nquery".to_owned();
    assert!(!query.validate());
}

#[test]
fn accepts_only_valid_optional_country_codes() {
    let body = br#"[
      {"id":1,"type":"ban","scope":"Ip","value":"203.0.113.4","origin":"crowdsec","scenario":"http-bf","duration":"2h","country":"de"},
      {"id":2,"type":"ban","scope":"Ip","value":"203.0.113.5","origin":"crowdsec","scenario":"http-bf","duration":"2h","country_code":"../DE"}
    ]"#;
    let decisions = parse_decisions(body).unwrap();
    assert_eq!(decisions[0].country_code, None);
    assert_eq!(decisions[1].country_code.as_deref(), Some("DE"));
}

#[test]
fn supports_prometheus_counter_total_suffix() {
    let metrics = parse_metrics(b"crowdsec_requests_blocked_total{origin=\"CAPI\"} 7\n")
        .expect("Prometheus counter suffix should parse");
    assert_eq!(metrics.blocked_requests, Some(7));
    assert_eq!(metrics.active_decisions, None);
}
