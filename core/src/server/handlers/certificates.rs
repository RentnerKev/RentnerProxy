use super::{no_store_json, no_store_status_json};
use crate::{
    proxy::{TrustedCaValidationRequest, is_canonical_uuid_v7, validate_trusted_ca_pem},
    runtime::{
        CertificateError, CertificateImportRequest, CertificateIssueRequest, CertificateMetadata,
    },
    server::{AppState, error::ApiError},
};
use axum::{
    body::Bytes,
    extract::{Path, Query, Request, rejection::BytesRejection},
    http::StatusCode,
    response::Response,
};
use serde::{Deserialize, Serialize};

pub(in crate::server) async fn list_certificates(state: AppState) -> Result<Response, ApiError> {
    Ok(no_store_json(CertificateListResponse {
        certificates: state
            .runtime
            .certificates()
            .await
            .map_err(ApiError::certificate)?,
    }))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CertificateEventsQuery {
    after: Option<String>,
    limit: Option<usize>,
}

pub(in crate::server) async fn certificate_events(
    request: Request,
    state: AppState,
) -> Result<Response, ApiError> {
    if request.uri().query().is_some_and(|query| query.len() > 256) {
        return Err(ApiError::validation_failed());
    }
    let Query(query) = Query::<CertificateEventsQuery>::try_from_uri(request.uri())
        .map_err(|_| ApiError::validation_failed())?;
    let limit = query.limit.unwrap_or(100);
    if !(1..=200).contains(&limit)
        || query.after.as_deref().is_some_and(|cursor| {
            let Some((id, sequence)) = cursor.split_once(':') else {
                return true;
            };
            !is_canonical_uuid_v7(id)
                || sequence.is_empty()
                || sequence.len() > 20
                || !sequence.bytes().all(|byte| byte.is_ascii_digit())
                || sequence.parse::<u64>().is_err()
        })
    {
        return Err(ApiError::validation_failed());
    }
    Ok(no_store_json(
        state
            .runtime
            .certificate_events(query.after.as_deref(), limit)
            .await
            .map_err(ApiError::certificate)?,
    ))
}

pub(in crate::server) async fn certificate_store_status(state: AppState) -> Response {
    let readiness = state.runtime.certificate_store_readiness().await;
    no_store_status_json(
        if readiness == crate::runtime::CertificateStoreReadiness::Ready {
            StatusCode::OK
        } else {
            StatusCode::SERVICE_UNAVAILABLE
        },
        serde_json::json!({ "readiness": readiness }),
    )
}

pub(in crate::server) async fn get_certificate(
    Path(id): Path<String>,
    state: AppState,
) -> Result<Response, ApiError> {
    certificate_id(&id)?;
    Ok(no_store_json(
        state
            .runtime
            .certificate(&id)
            .await
            .map_err(ApiError::certificate)?,
    ))
}

pub(in crate::server) async fn validate_trusted_ca(
    body: Result<Bytes, BytesRejection>,
) -> Result<Response, ApiError> {
    let body = body.map_err(|_| ApiError::invalid_trusted_ca())?;
    let request = serde_json::from_slice::<TrustedCaValidationRequest>(&body)
        .map_err(|_| ApiError::invalid_trusted_ca())?;
    Ok(no_store_json(
        validate_trusted_ca_pem(&request.pem).map_err(|_| ApiError::invalid_trusted_ca())?,
    ))
}
pub(in crate::server) async fn import_certificate(
    Path(id): Path<String>,
    state: AppState,
    body: Result<Bytes, BytesRejection>,
) -> Result<Response, ApiError> {
    certificate_id(&id)?;
    let body = body.map_err(|_| ApiError::certificate(CertificateError::InvalidCertificate))?;
    let request = serde_json::from_slice::<CertificateImportRequest>(&body)
        .map_err(|_| ApiError::certificate(CertificateError::InvalidCertificate))?;
    Ok(no_store_json(
        state
            .runtime
            .import_certificate(&id, request)
            .await
            .map_err(ApiError::certificate)?,
    ))
}

pub(in crate::server) async fn issue_certificate(
    Path(id): Path<String>,
    state: AppState,
    body: Result<Bytes, BytesRejection>,
) -> Result<Response, ApiError> {
    certificate_id(&id)?;
    let body = body.map_err(|_| ApiError::certificate(CertificateError::AcmeDomainInvalid))?;
    let request = serde_json::from_slice::<CertificateIssueRequest>(&body)
        .map_err(|_| ApiError::certificate(CertificateError::AcmeDomainInvalid))?;
    let metadata = state
        .runtime
        .start_acme_issue(id, request, state.challenges.clone())
        .await
        .map_err(ApiError::certificate)?;
    Ok(no_store_status_json(StatusCode::ACCEPTED, metadata))
}

pub(in crate::server) async fn renew_certificate(
    Path(id): Path<String>,
    state: AppState,
    body: Result<Bytes, BytesRejection>,
) -> Result<Response, ApiError> {
    certificate_id(&id)?;
    let body = body.map_err(|_| ApiError::certificate(CertificateError::AcmeFailed))?;
    if !body.is_empty() && serde_json::from_slice::<serde_json::Value>(&body).is_err() {
        return Err(ApiError::certificate(CertificateError::AcmeFailed));
    }
    let metadata = state
        .runtime
        .start_acme_renewal(id, state.challenges.clone())
        .await
        .map_err(ApiError::certificate)?;
    Ok(no_store_status_json(StatusCode::ACCEPTED, metadata))
}

pub(in crate::server) async fn delete_certificate(
    Path(id): Path<String>,
    state: AppState,
) -> Result<Response, ApiError> {
    certificate_id(&id)?;
    state
        .runtime
        .delete_certificate(&id)
        .await
        .map_err(ApiError::certificate)?;
    Ok(no_store_json(DeletedCertificateResponse { deleted: true }))
}

fn certificate_id(id: &str) -> Result<(), ApiError> {
    if is_canonical_uuid_v7(id) {
        Ok(())
    } else {
        Err(ApiError::certificate(CertificateError::NotFound))
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CertificateListResponse {
    certificates: Vec<CertificateMetadata>,
}

#[derive(Serialize)]
struct DeletedCertificateResponse {
    deleted: bool,
}
