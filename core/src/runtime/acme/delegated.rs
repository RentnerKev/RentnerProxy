use crate::runtime::{
    certificates::{
        CertificateEnvironment, CertificateError, CertificateIssueRequest, CertificateStore,
    },
    dns::{DnsDelegationBinding, DnsProvider, DnsRecordIntent},
    dns_delegation,
};
use std::{collections::BTreeMap, time::Duration};
use tokio::time::{Instant, sleep, timeout_at};

pub(super) async fn check_cancelled(
    store: &CertificateStore,
    id: &str,
) -> Result<(), CertificateError> {
    let metadata = store.get(id).await?;
    let operation = metadata
        .current_operation
        .ok_or(CertificateError::OperationInProgress)?;
    if store.delegated_cancel_requested(id, &operation.id).await? {
        return Err(CertificateError::AcmeCancelled);
    }
    Ok(())
}

pub(super) async fn present(
    store: &CertificateStore,
    id: &str,
    provider: &DnsProvider,
    intents: &mut Vec<DnsRecordIntent>,
    mut intent: DnsRecordIntent,
) -> Result<(), CertificateError> {
    check_cancelled(store, id).await?;
    if intents.iter().any(|pending| {
        pending.unconfirmed_write
            && pending.value == intent.value
            && pending.marker == intent.marker
            && pending
                .delegation
                .as_ref()
                .zip(intent.delegation.as_ref())
                .is_some_and(|(previous, current)| {
                    previous.zone_name == current.zone_name
                        && previous.target_owner == current.target_owner
                })
    }) {
        // Replaying the same ambiguous mutation could make a later read prove only
        // one of two writes, allowing the other to appear after authority is retired.
        return Err(CertificateError::DnsCleanupFailed);
    }
    intent.unconfirmed_write = true;
    intents.push(intent);
    store.set_pending_dns_records(id, intents.clone()).await?;
    let outcome = provider
        .present_tracked(intents.last().ok_or(CertificateError::DnsProviderInvalid)?)
        .await;
    if !outcome.as_ref().is_err_and(|error| error.unconfirmed) {
        if let Some(intent) = intents.last_mut() {
            intent.unconfirmed_write = false;
        }
        store.set_pending_dns_records(id, intents.clone()).await?;
    }
    outcome.map_err(|error| error.error)?;
    check_cancelled(store, id).await
}

pub(super) async fn bindings(
    request: &CertificateIssueRequest,
    provider: &DnsProvider,
) -> Result<BTreeMap<String, DnsDelegationBinding>, CertificateError> {
    let zone = provider.zone_name().await?;
    let mut bindings = BTreeMap::new();
    for domain in &request.domains {
        let name = domain.strip_prefix("*.").unwrap_or(domain);
        if bindings.contains_key(name) {
            continue;
        }
        let owner = format!("_acme-challenge.{name}");
        let binding = dns_delegation::resolve(&owner, &zone, request.environment).await?;
        bindings.insert(name.to_owned(), binding);
    }
    Ok(bindings)
}

pub(super) async fn recheck(
    binding: &DnsDelegationBinding,
    environment: CertificateEnvironment,
) -> Result<(), CertificateError> {
    let current =
        dns_delegation::resolve(&binding.original_owner, &binding.zone_name, environment).await?;
    if current != *binding {
        return Err(CertificateError::DnsDelegationInvalid);
    }
    Ok(())
}

pub(super) async fn wait_for_records(
    intents: &[DnsRecordIntent],
    environment: CertificateEnvironment,
    store: &CertificateStore,
    id: &str,
) -> Result<(), CertificateError> {
    let deadline = Instant::now() + Duration::from_secs(60);
    let mut last = CertificateError::DnsDelegationNotPropagated;
    loop {
        check_cancelled(store, id).await?;
        match timeout_at(
            deadline,
            dns_delegation::check_records(intents, environment),
        )
        .await
        {
            Ok(Ok(())) => return Ok(()),
            Ok(Err(
                error @ (CertificateError::DnsDelegationNotPropagated
                | CertificateError::DnsDelegationLookupFailed),
            )) => last = error,
            Ok(Err(error)) => return Err(error),
            Err(_) => return Err(last),
        }
        if Instant::now() + Duration::from_secs(2) >= deadline {
            return Err(last);
        }
        sleep(Duration::from_secs(2)).await;
    }
}
