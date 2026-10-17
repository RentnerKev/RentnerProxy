use super::*;

#[tokio::test]
async fn private_configuration_status_events_and_actions_enforce_bearer_and_do_not_expose_credentials()
 {
    use crate::server::{AppState, app_with_state};
    use axum::{
        body::{Body, to_bytes},
        http::Request as HttpRequest,
    };
    use tower::ServiceExt;
    let mut fixture = Fixture::new(vec![]).await;
    let runtime = runtime(&mut fixture);
    let token = crate::config::Config::from_values(
        None,
        Some("0123456789abcdef0123456789abcdef"),
        None,
        None,
        None,
        false,
    )
    .unwrap()
    .controller_token
    .unwrap();
    let app = app_with_state(AppState::new(runtime.clone(), Some(token)));
    let send = |method: &str, path: &str, body: String, bearer: bool| {
        let mut request = HttpRequest::builder().method(method).uri(path);
        if bearer {
            request = request.header("authorization", "Bearer 0123456789abcdef0123456789abcdef");
        }
        request.body(Body::from(body)).unwrap()
    };
    for (method, path) in [
        ("GET", "/internal/v1/ddns/config"),
        ("PUT", "/internal/v1/ddns/config"),
        ("GET", "/internal/v1/ddns/status"),
        ("GET", "/internal/v1/ddns/events"),
        ("POST", "/internal/v1/ddns/enable"),
        ("POST", "/internal/v1/ddns/disable"),
        ("POST", "/internal/v1/ddns/sync"),
    ] {
        assert_eq!(
            app.clone()
                .oneshot(send(method, path, "{}".into(), false))
                .await
                .unwrap()
                .status(),
            401
        );
    }
    let payload = json!({"expectedRevision":0,"actorUserId":ACTOR,"configuration":{
        "intervalSeconds":300,"updateOnStart":true,"ipv4":true,"ipv6":false,
        "targets":[target(10,"example.com",RecordType::A,Selection::Create)]
    }});
    let response = app
        .clone()
        .oneshot(send(
            "PUT",
            "/internal/v1/ddns/config",
            payload.to_string(),
            true,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    assert_eq!(response.headers()["cache-control"], "no-store");
    assert_eq!(fixture.writes(), 0);
    for (path, revision, status) in [
        ("sync", 1, 409),
        ("enable", 1, 200),
        ("sync", 2, 200),
        ("sync", 2, 429),
        ("disable", 2, 200),
        ("sync", 3, 409),
    ] {
        let response = app
            .clone()
            .oneshot(send(
                "POST",
                &format!("/internal/v1/ddns/{path}"),
                json!({"expectedRevision":revision,"actorUserId":ACTOR}).to_string(),
                true,
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), status, "{path}");
        if status == 429 {
            assert!(
                response.headers()["retry-after"]
                    .to_str()
                    .unwrap()
                    .parse::<u32>()
                    .unwrap()
                    >= 1
            );
        }
    }
    for path in [
        "/internal/v1/ddns/status",
        "/internal/v1/ddns/events?after=0&limit=2",
    ] {
        let response = app
            .clone()
            .oneshot(send("GET", path, String::new(), true))
            .await
            .unwrap();
        assert_eq!(response.status(), 200);
        let bytes = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
        assert!(!String::from_utf8_lossy(&bytes).contains(SECRET));
    }
    assert_eq!(
        app.clone()
            .oneshot(send(
                "GET",
                "/internal/v1/ddns/events?limit=65",
                String::new(),
                true
            ))
            .await
            .unwrap()
            .status(),
        400
    );
    assert_eq!(
        app.oneshot(send(
            "PUT",
            "/internal/v1/ddns/config",
            "x".repeat(128 * 1024 + 1),
            true
        ))
        .await
        .unwrap()
        .status(),
        400
    );
}
