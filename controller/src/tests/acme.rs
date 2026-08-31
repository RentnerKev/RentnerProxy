use std::path::PathBuf;

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{
        Method, Request, StatusCode,
        header::{CACHE_CONTROL, CONTENT_TYPE, HOST},
    },
};
use tower::ServiceExt;

use crate::{
    runtime::{ProxyRuntime, RuntimeSettings},
    server::{AppState, app_with_state, challenges::ChallengeStore},
};

const DOMAIN_ONE: &str = "one.example.test";
const DOMAIN_TWO: &str = "two.example.test";
const TOKEN_ONE: &str = "token-one_123";
const TOKEN_TWO: &str = "token-two_456";

fn challenge_value(token: &str, proof: &str) -> String {
    format!("{token}.{proof}")
}

fn test_app() -> (Router, ChallengeStore) {
    let runtime = ProxyRuntime::new(
        RuntimeSettings::new(PathBuf::from("acme-challenge-test"), 18_080),
        None,
    );
    let state = AppState::new(runtime, None);
    let challenges = state.challenges.clone();
    (app_with_state(state), challenges)
}

fn challenge_request(method: Method, host: &str, token: &str) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(format!("/.well-known/acme-challenge/{token}"))
        .header(HOST, host)
        .body(Body::empty())
        .unwrap()
}

async fn response_body(response: axum::response::Response) -> Vec<u8> {
    to_bytes(response.into_body(), 4_096)
        .await
        .unwrap()
        .to_vec()
}

#[tokio::test]
async fn challenge_store_scopes_by_domain_and_token_without_overwrite() {
    let store = ChallengeStore::new();
    let value_one = challenge_value(TOKEN_ONE, "proof-one");
    let value_two = challenge_value(TOKEN_ONE, "proof-two");

    store
        .insert(
            DOMAIN_ONE.to_owned(),
            TOKEN_ONE.to_owned(),
            value_one.clone(),
        )
        .await
        .unwrap();
    store
        .insert(
            DOMAIN_TWO.to_owned(),
            TOKEN_ONE.to_owned(),
            value_two.clone(),
        )
        .await
        .unwrap();

    assert_eq!(
        store.get(DOMAIN_ONE, TOKEN_ONE).await.as_deref(),
        Some(value_one.as_str())
    );
    assert_eq!(
        store.get(DOMAIN_TWO, TOKEN_ONE).await.as_deref(),
        Some(value_two.as_str())
    );
    assert_eq!(store.get(DOMAIN_ONE, TOKEN_TWO).await, None);
    assert_eq!(store.get(DOMAIN_TWO, TOKEN_TWO).await, None);

    assert!(
        store
            .insert(
                DOMAIN_ONE.to_owned(),
                TOKEN_ONE.to_owned(),
                challenge_value(TOKEN_ONE, "attacker-proof"),
            )
            .await
            .is_err()
    );
    assert_eq!(
        store.get(DOMAIN_ONE, TOKEN_ONE).await.as_deref(),
        Some(value_one.as_str())
    );
}

#[tokio::test]
async fn challenge_store_rejects_invalid_inputs_and_enforces_length_caps() {
    let store = ChallengeStore::new();
    let valid = |domain: &str, token: &str, value: String| {
        let domain = domain.to_owned();
        let token = token.to_owned();
        let store = store.clone();
        async move { store.insert(domain, token, value).await }
    };

    assert!(
        valid(
            "Upper.Example.test",
            TOKEN_ONE,
            challenge_value(TOKEN_ONE, "proof")
        )
        .await
        .is_err()
    );
    assert!(
        valid("127.0.0.1", TOKEN_ONE, challenge_value(TOKEN_ONE, "proof"))
            .await
            .is_err()
    );
    assert!(valid(DOMAIN_ONE, "", "x".to_owned()).await.is_err());
    assert!(
        valid(
            DOMAIN_ONE,
            "token+invalid",
            challenge_value("token+invalid", "proof")
        )
        .await
        .is_err()
    );
    assert!(
        valid(DOMAIN_ONE, &"t".repeat(129), "x".to_owned())
            .await
            .is_err()
    );
    assert!(
        valid(DOMAIN_ONE, TOKEN_ONE, format!("{TOKEN_ONE}.bad!"))
            .await
            .is_err()
    );
    assert!(
        valid(DOMAIN_ONE, TOKEN_ONE, format!("{TOKEN_ONE}."))
            .await
            .is_err()
    );
    assert!(
        valid(DOMAIN_ONE, TOKEN_ONE, "different-token.proof".to_owned())
            .await
            .is_err()
    );

    let max_token = "t".repeat(128);
    let max_proof = "p".repeat(2_048 - max_token.len() - 1);
    assert!(
        valid(
            "length.example.test",
            &max_token,
            challenge_value(&max_token, &max_proof),
        )
        .await
        .is_ok()
    );
    assert!(
        valid(
            "too-long.example.test",
            TOKEN_TWO,
            format!("{TOKEN_TWO}.{}", "p".repeat(2_048)),
        )
        .await
        .is_err()
    );
}

#[tokio::test]
async fn removing_a_challenge_removes_only_that_entry() {
    let store = ChallengeStore::new();
    store
        .insert(
            DOMAIN_ONE.to_owned(),
            TOKEN_ONE.to_owned(),
            challenge_value(TOKEN_ONE, "proof-one"),
        )
        .await
        .unwrap();
    store
        .insert(
            DOMAIN_TWO.to_owned(),
            TOKEN_ONE.to_owned(),
            challenge_value(TOKEN_ONE, "proof-two"),
        )
        .await
        .unwrap();

    store.remove(DOMAIN_ONE, TOKEN_ONE).await;

    assert_eq!(store.get(DOMAIN_ONE, TOKEN_ONE).await, None);
    assert_eq!(
        store.get(DOMAIN_TWO, TOKEN_ONE).await.as_deref(),
        Some(challenge_value(TOKEN_ONE, "proof-two").as_str()),
    );
}

#[tokio::test]
async fn public_challenge_get_is_unauthed_exact_host_scoped_and_uncached() {
    let (router, challenges) = test_app();
    let value = challenge_value(TOKEN_ONE, "proof-one");
    challenges
        .insert(DOMAIN_ONE.to_owned(), TOKEN_ONE.to_owned(), value.clone())
        .await
        .unwrap();

    let mut request = challenge_request(Method::GET, DOMAIN_ONE, TOKEN_ONE);
    request.headers_mut().insert(
        "authorization",
        "Bearer intentionally-wrong".parse().unwrap(),
    );
    let response = router.clone().oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers().get(CACHE_CONTROL).unwrap(), "no-store");
    assert_eq!(
        response.headers().get(CONTENT_TYPE).unwrap(),
        "text/plain; charset=utf-8"
    );
    assert_eq!(response_body(response).await, value.as_bytes());

    let response = router
        .clone()
        .oneshot(challenge_request(
            Method::GET,
            "other.example.test",
            TOKEN_ONE,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);

    let response = router
        .oneshot(challenge_request(Method::GET, DOMAIN_ONE, TOKEN_TWO))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn public_challenge_writer_methods_are_rejected_and_remove_returns_404() {
    let (router, challenges) = test_app();
    challenges
        .insert(
            DOMAIN_ONE.to_owned(),
            TOKEN_ONE.to_owned(),
            challenge_value(TOKEN_ONE, "proof-one"),
        )
        .await
        .unwrap();

    let response = router
        .clone()
        .oneshot(challenge_request(Method::POST, DOMAIN_ONE, TOKEN_ONE))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::METHOD_NOT_ALLOWED);

    challenges.remove(DOMAIN_ONE, TOKEN_ONE).await;
    let response = router
        .oneshot(challenge_request(Method::GET, DOMAIN_ONE, TOKEN_ONE))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}
