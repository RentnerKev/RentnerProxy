use ring::rand::{SecureRandom, SystemRandom};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

use super::{CertificateError, CertificateIndex};

pub(crate) const MAX_EVENT_PAGE: usize = 200;
pub(crate) const MAX_EVENTS: usize = 10_000;
const EVENT_JOURNAL_VERSION: u8 = 1;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum OperationKind {
    Issue,
    Renew,
    Import,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum CertificateOperationStage {
    Queued,
    CreatingOrder,
    PreparingChallenge,
    WaitingForValidation,
    Finalizing,
    CertificateReady,
    Applying,
    Applied,
    RetryScheduled,
    Failed,
    NeedsAttention,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CurrentOperation {
    pub(crate) id: String,
    pub(crate) kind: OperationKind,
    pub(crate) stage: CertificateOperationStage,
    pub(crate) started_at: String,
    pub(crate) updated_at: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum CertificateEventKind {
    Accepted,
    Started,
    Issued,
    Activated,
    Renewed,
    RetryScheduled,
    Failed,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CertificateEvent {
    pub(crate) id: String,
    pub(crate) operation_id: String,
    pub(crate) certificate_id: String,
    pub(crate) kind: CertificateEventKind,
    pub(crate) stage: CertificateOperationStage,
    pub(crate) occurred_at: String,
    pub(crate) error_code: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CertificateEventPage {
    pub(crate) events: Vec<CertificateEvent>,
    pub(crate) next_cursor: Option<String>,
    pub(crate) has_more: bool,
    pub(crate) reset_required: bool,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum CertificateStoreReadiness {
    #[default]
    NotReady,
    Ready,
    InitializationFailed,
    Corrupt,
}

pub(crate) fn new_uuid_v7() -> Result<String, CertificateError> {
    let millis = u64::try_from(OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000)
        .map_err(|_| CertificateError::StoreUnavailable)?;
    let mut bytes = [0_u8; 16];
    SystemRandom::new()
        .fill(&mut bytes)
        .map_err(|_| CertificateError::StoreUnavailable)?;
    bytes[0] = (millis >> 40) as u8;
    bytes[1] = (millis >> 32) as u8;
    bytes[2] = (millis >> 24) as u8;
    bytes[3] = (millis >> 16) as u8;
    bytes[4] = (millis >> 8) as u8;
    bytes[5] = millis as u8;
    bytes[6] = (bytes[6] & 0x0f) | 0x70;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    Ok(format_uuid(bytes))
}

pub(crate) fn new_operation(kind: OperationKind) -> Result<CurrentOperation, CertificateError> {
    let now = OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .map_err(|_| CertificateError::StoreUnavailable)?;
    Ok(CurrentOperation {
        id: new_uuid_v7()?,
        kind,
        stage: CertificateOperationStage::Queued,
        started_at: now.clone(),
        updated_at: now,
    })
}

pub(crate) fn event_kind_for_stage(
    stage: CertificateOperationStage,
) -> Option<CertificateEventKind> {
    match stage {
        CertificateOperationStage::CertificateReady => Some(CertificateEventKind::Issued),
        CertificateOperationStage::RetryScheduled => Some(CertificateEventKind::RetryScheduled),
        CertificateOperationStage::Failed | CertificateOperationStage::NeedsAttention => {
            Some(CertificateEventKind::Failed)
        }
        CertificateOperationStage::Queued
        | CertificateOperationStage::CreatingOrder
        | CertificateOperationStage::PreparingChallenge
        | CertificateOperationStage::WaitingForValidation
        | CertificateOperationStage::Finalizing
        | CertificateOperationStage::Applying
        | CertificateOperationStage::Applied => None,
    }
}

pub(crate) fn append_event(
    index: &mut CertificateIndex,
    operation_id: &str,
    certificate_id: &str,
    kind: CertificateEventKind,
    stage: CertificateOperationStage,
    error_code: Option<String>,
) -> Result<(), CertificateError> {
    let Some(operation) = index
        .certificates
        .get(certificate_id)
        .and_then(|entry| entry.metadata.current_operation.as_ref())
    else {
        return Err(CertificateError::StoreUnavailable);
    };
    if operation.id != operation_id {
        return Err(CertificateError::StoreUnavailable);
    }
    let same_event = |event: &CertificateEvent| {
        event.operation_id == operation_id
            && event.certificate_id == certificate_id
            && event.kind == kind
            && event.stage == stage
            && event.error_code == error_code
    };
    let one_shot = matches!(
        kind,
        CertificateEventKind::Accepted
            | CertificateEventKind::Started
            | CertificateEventKind::Issued
            | CertificateEventKind::Activated
            | CertificateEventKind::Renewed
    );
    if one_shot && index.events.iter().any(same_event) {
        return Ok(());
    }
    let mut occurred_at = OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .map_err(|_| CertificateError::StoreUnavailable)?;
    if let Some(previous) = index.events.last()
        && let (Ok(previous), Ok(current)) = (
            OffsetDateTime::parse(&previous.occurred_at, &Rfc3339),
            OffsetDateTime::parse(&occurred_at, &Rfc3339),
        )
        && current < previous
    {
        occurred_at = previous
            .format(&Rfc3339)
            .map_err(|_| CertificateError::StoreUnavailable)?;
    }
    let event = CertificateEvent {
        id: new_uuid_v7()?,
        operation_id: operation_id.to_owned(),
        certificate_id: certificate_id.to_owned(),
        kind,
        stage,
        occurred_at,
        error_code,
    };
    index.events.push(event);
    index.event_sequence = index.event_sequence.saturating_add(1);
    if index.events.len() > MAX_EVENTS {
        let remove = index.events.len() - MAX_EVENTS;
        index.events.drain(..remove);
    }
    Ok(())
}

pub(crate) fn journal_is_valid(index: &CertificateIndex) -> bool {
    if index.event_journal_version != EVENT_JOURNAL_VERSION
        || index.store_id.is_empty()
        || !super::is_canonical_uuid_v7(&index.store_id)
        || index.events.len() > MAX_EVENTS
        || index.event_sequence < index.events.len() as u64
    {
        return false;
    }
    let mut previous_at = None;
    let mut event_ids = BTreeSet::new();
    index.events.iter().all(|event| {
        let valid = super::is_canonical_uuid_v7(&event.id)
            && event_ids.insert(event.id.clone())
            && super::is_canonical_uuid_v7(&event.operation_id)
            && super::is_canonical_uuid_v7(&event.certificate_id)
            && event.error_code.as_ref().is_none_or(|code| {
                (1..=128).contains(&code.len())
                    && code.bytes().all(|byte| {
                        byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_'
                    })
                    && known_error_code(code)
            })
            && super::valid_timestamp(&event.occurred_at)
            && previous_at.is_none_or(|previous| {
                OffsetDateTime::parse(&event.occurred_at, &Rfc3339)
                    .is_ok_and(|current| current >= previous)
            });
        if valid {
            previous_at = OffsetDateTime::parse(&event.occurred_at, &Rfc3339).ok();
        }
        valid
    })
}

fn known_error_code(code: &str) -> bool {
    matches!(
        code,
        "invalid_certificate"
            | "key_mismatch"
            | "certificate_expired"
            | "domain_mismatch"
            | "certificate_not_found"
            | "certificate_in_use"
            | "operation_in_progress"
            | "acme_terms_required"
            | "acme_domain_invalid"
            | "acme_failed"
            | "acme_dns_required"
            | "dns_provider_invalid"
            | "dns_provider_unavailable"
            | "dns_provider_unauthorized"
            | "dns_cleanup_failed"
            | "dns_credentials_unavailable"
            | "runtime_apply_failed"
            | "certificate_store_unavailable"
    )
}

pub(crate) fn current_operation_is_valid(operation: &CurrentOperation) -> bool {
    super::is_canonical_uuid_v7(&operation.id)
        && super::valid_timestamp(&operation.started_at)
        && super::valid_timestamp(&operation.updated_at)
}

pub(crate) fn events_page(
    index: &CertificateIndex,
    after: Option<&str>,
    limit: usize,
) -> Result<CertificateEventPage, CertificateError> {
    let limit = limit.min(MAX_EVENT_PAGE);
    let first_sequence = index
        .event_sequence
        .saturating_sub(index.events.len() as u64);
    let mut reset_required = false;
    let start_sequence = match after {
        None => first_sequence,
        Some(cursor) => match decode_cursor(cursor, &index.store_id) {
            Some(sequence) if sequence >= first_sequence && sequence <= index.event_sequence => {
                sequence
            }
            _ => {
                reset_required = true;
                first_sequence
            }
        },
    };
    let start = start_sequence.saturating_sub(first_sequence) as usize;
    let events = index
        .events
        .iter()
        .skip(start)
        .take(limit)
        .cloned()
        .collect::<Vec<_>>();
    let next_sequence = start_sequence.saturating_add(events.len() as u64);
    let has_more = next_sequence < index.event_sequence;
    let next_cursor = Some(encode_cursor(&index.store_id, next_sequence));
    Ok(CertificateEventPage {
        events,
        next_cursor,
        has_more,
        reset_required,
    })
}

pub(crate) fn encode_cursor(store_id: &str, sequence: u64) -> String {
    format!("{store_id}:{sequence}")
}

fn decode_cursor(cursor: &str, store_id: &str) -> Option<u64> {
    let (cursor_store, sequence) = cursor.rsplit_once(':')?;
    if cursor_store != store_id || cursor_store.len() != 36 {
        return None;
    }
    sequence.parse().ok()
}

fn format_uuid(bytes: [u8; 16]) -> String {
    let mut output = String::with_capacity(36);
    for (index, byte) in bytes.into_iter().enumerate() {
        if matches!(index, 4 | 6 | 8 | 10) {
            output.push('-');
        }
        output.push_str(&format!("{byte:02x}"));
    }
    output
}
