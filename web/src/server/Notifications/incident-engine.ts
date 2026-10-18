import { createHash } from 'node:crypto'
import { NOTIFICATION_LIMITS, NOTIFICATION_SEVERITIES } from '@/config/notifications.config.ts'
import type {
    NotificationDeliveryResult,
    NotificationObservation,
    NotificationPayload,
} from '@/lib/Notifications/Types/notifications.types.ts'
import type {
    NotificationIncident,
    NotificationClaimedDelivery,
    NotificationEngineConfiguration,
    NotificationQueuedDelivery,
    NotificationState,
} from './Types/notification-state.types.ts'

function recoveryOwed(
    incident: NotificationIncident,
    configuration: NotificationEngineConfiguration,
) {
    return (
        incident.recoveredAt !== null &&
        incident.channels.some(
            (marker) =>
                marker.failure === 'succeeded' &&
                marker.recovery === null &&
                configuration.channels.some(
                    (channel) =>
                        channel.id === marker.channelId &&
                        channel.revision === marker.channelRevision &&
                        channel.enabled &&
                        channel.recovery,
                ),
        )
    )
}

export function createNotificationState(): NotificationState {
    return { version: 1, incidents: [], deliveries: [], deferredCount: 0, saturationCount: 0 }
}

function isActive(delivery: NotificationQueuedDelivery) {
    return delivery.status === 'pending' || delivery.status === 'inflight'
}

function markTerminal(state: NotificationState, delivery: NotificationQueuedDelivery) {
    const incident = state.incidents.find((item) => item.id === delivery.payload.incidentId)
    const marker = incident?.channels.find(
        (item) =>
            item.channelId === delivery.channelId &&
            item.channelRevision === delivery.channelRevision,
    )
    if (!marker) return
    const status = delivery.status === 'succeeded' ? 'succeeded' : 'failed'
    if (delivery.payload.type === 'incident') marker.failure = status
    else marker.recovery = status
}

function terminate(
    state: NotificationState,
    delivery: NotificationQueuedDelivery,
    status: 'failed' | 'cancelled',
    nowMs: number,
) {
    delivery.status = status
    delivery.error = status === 'cancelled' ? 'cancelled' : 'timeout'
    delivery.updatedAt = nowMs
    delivery.leaseToken = null
    delivery.leaseExpiresAt = null
    markTerminal(state, delivery)
}

function reconcile(
    state: NotificationState,
    configuration: NotificationEngineConfiguration,
    nowMs: number,
) {
    state.deferredCount = 0
    for (const delivery of state.deliveries) {
        if (!isActive(delivery)) continue
        const allowed =
            configuration.enabled &&
            !configuration.pausedAfterRestore &&
            configuration.channels.some(
                (channel) =>
                    channel.enabled &&
                    channel.id === delivery.channelId &&
                    channel.revision === delivery.channelRevision,
            )
        // An admitted network attempt may finish, but cannot be claimed again after policy revocation.
        if (
            delivery.status === 'inflight' &&
            delivery.leaseExpiresAt !== null &&
            delivery.leaseExpiresAt > nowMs
        )
            continue
        if (!allowed) {
            terminate(state, delivery, 'cancelled', nowMs)
        } else if (
            nowMs - delivery.createdAt >= NOTIFICATION_LIMITS.deliveryLifetimeMs ||
            delivery.attempts >= NOTIFICATION_LIMITS.attempts
        ) {
            terminate(state, delivery, 'failed', nowMs)
        } else if (delivery.status === 'inflight') {
            delivery.status = 'pending'
            delivery.leaseToken = null
            delivery.leaseExpiresAt = null
            delivery.nextAttemptAt = nowMs + retryDelay(delivery.attempts)
            delivery.updatedAt = nowMs
        }
    }
    // Markers live with their incident, independently of the bounded delivery history.
    for (const incident of state.incidents) {
        incident.channels = incident.channels.filter((marker) =>
            configuration.channels.some(
                (channel) =>
                    channel.id === marker.channelId && channel.revision === marker.channelRevision,
            ),
        )
    }
    state.deliveries = state.deliveries.filter(
        (delivery) =>
            isActive(delivery) || nowMs - delivery.updatedAt < NOTIFICATION_LIMITS.retentionMs,
    )
    state.incidents = state.incidents.filter(
        (incident) =>
            incident.recoveredAt === null ||
            nowMs - incident.recoveredAt < NOTIFICATION_LIMITS.retentionMs ||
            state.deliveries.some(
                (delivery) => isActive(delivery) && delivery.payload.incidentId === incident.id,
            ),
    )
}

function retryDelay(attempts: number) {
    return Math.min(
        NOTIFICATION_LIMITS.retryMaximumMs,
        NOTIFICATION_LIMITS.retryInitialMs * 2 ** Math.max(0, attempts - 1),
    )
}

function makeRoom(state: NotificationState) {
    if (state.deliveries.length < NOTIFICATION_LIMITS.deliveries) return true
    const oldestTerminal = state.deliveries.findIndex((delivery) => !isActive(delivery))
    if (oldestTerminal < 0) return false
    state.deliveries.splice(oldestTerminal, 1)
    return true
}

function defer(state: NotificationState) {
    state.deferredCount += 1
    state.saturationCount = Math.min(Number.MAX_SAFE_INTEGER, state.saturationCount + 1)
}

function withinStateLimit(state: NotificationState) {
    // Reserve room for persisted leases, terminal errors, and counters after admission.
    return (
        new TextEncoder().encode(JSON.stringify(state)).byteLength <=
        NOTIFICATION_LIMITS.stateBytes - NOTIFICATION_LIMITS.deliveries * 256
    )
}

function admit(
    state: NotificationState,
    configuration: NotificationEngineConfiguration,
    nowMs: number,
    makeId: () => string,
) {
    if (!configuration.enabled || configuration.pausedAfterRestore) return
    for (const incident of state.incidents) {
        for (const channel of configuration.channels) {
            if (!channel.enabled) continue
            let marker = incident.channels.find(
                (item) =>
                    item.channelId === channel.id && item.channelRevision === channel.revision,
            )
            const recovery = incident.recoveredAt !== null
            if (recovery) {
                if (
                    !marker ||
                    marker.failure !== 'succeeded' ||
                    marker.recovery !== null ||
                    !channel.recovery
                )
                    continue
            } else {
                if (
                    marker ||
                    !channel.events.includes(incident.category) ||
                    NOTIFICATION_SEVERITIES.indexOf(incident.severity) <
                        NOTIFICATION_SEVERITIES.indexOf(channel.minimumSeverity) ||
                    nowMs - incident.startedAt < channel.thresholdSeconds * 1_000
                )
                    continue
            }
            if (!makeRoom(state)) {
                defer(state)
                continue
            }
            const id = makeId()
            const payload: NotificationPayload = {
                schemaVersion: 1,
                id,
                incidentId: incident.id,
                type: recovery ? 'recovery' : 'incident',
                category: incident.category,
                severity: recovery ? 'info' : incident.severity,
                resourceId: incident.resourceId,
                code: recovery
                    ? 'operation_recovered'
                    : incident.category === 'certificate_renewal'
                      ? 'certificate_renewal_failed'
                      : incident.category === 'ddns'
                        ? 'ddns_update_failed'
                        : 'proxy_apply_failed',
                occurredAt: new Date(incident.recoveredAt ?? incident.observedAt).toISOString(),
                startedAt: new Date(incident.startedAt).toISOString(),
                failures: incident.failures,
            }
            if (
                new TextEncoder().encode(JSON.stringify(payload)).byteLength >
                NOTIFICATION_LIMITS.payloadBytes
            ) {
                defer(state)
                continue
            }
            const existingMarker = marker
            if (marker) marker.recovery = 'pending'
            else {
                marker = {
                    channelId: channel.id,
                    channelRevision: channel.revision,
                    failure: 'pending',
                    recovery: null,
                }
                incident.channels.push(marker)
            }
            state.deliveries.push({
                id,
                channelId: channel.id,
                channelRevision: channel.revision,
                payload,
                status: 'pending',
                attempts: 0,
                createdAt: nowMs,
                updatedAt: nowMs,
                nextAttemptAt: nowMs,
                leaseToken: null,
                leaseExpiresAt: null,
                error: null,
            })
            if (!withinStateLimit(state)) {
                state.deliveries.pop()
                if (existingMarker) existingMarker.recovery = null
                else incident.channels.pop()
                defer(state)
            }
        }
    }
}

export function observeNotificationSignals(
    state: NotificationState,
    configuration: NotificationEngineConfiguration,
    observations: readonly NotificationObservation[],
    nowMs: number,
    makeId: () => string,
): NotificationState {
    const next = structuredClone(state)
    reconcile(next, configuration, nowMs)
    for (const observation of observations.toSorted(
        (left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt),
    )) {
        const observedAt = Date.parse(observation.occurredAt)
        if (
            !Number.isSafeInteger(observedAt) ||
            observedAt < 0 ||
            observedAt > nowMs ||
            nowMs - observedAt >= NOTIFICATION_LIMITS.retentionMs ||
            observation.resourceId.length === 0 ||
            observation.resourceId.length > 512 ||
            observation.evidence.length > 512 ||
            !Number.isSafeInteger(observation.failures) ||
            observation.failures < 0
        )
            continue
        const matching = next.incidents.filter(
            (incident) =>
                incident.category === observation.category &&
                incident.resourceId === observation.resourceId,
        )
        const current = matching.find((incident) => incident.recoveredAt === null)
        const lastObservedAt = Math.max(
            -1,
            ...matching.map((incident) => incident.recoveredAt ?? incident.observedAt),
        )
        if (observedAt < lastObservedAt) continue
        const evidence = createHash('sha256').update(observation.evidence).digest('hex')
        if (observation.health === 'healthy' && current?.evidence === evidence) continue
        // Only an equal source timestamp can be a replay of a closed transition. The same
        // runtime state at a later time may be a new outage after a real recovery.
        if (
            !current &&
            observedAt === lastObservedAt &&
            matching.some(
                (incident) =>
                    (incident.recoveredAt ?? incident.observedAt) === observedAt &&
                    (incident.evidence === evidence || incident.recoveryEvidence === evidence),
            )
        )
            continue
        if (observation.health === 'healthy') {
            if (current) {
                current.recoveredAt = observedAt
                current.recoveryEvidence = evidence
            }
            continue
        }
        if (current) {
            if (current.evidence !== evidence)
                current.failures = Math.min(
                    Number.MAX_SAFE_INTEGER,
                    Math.max(current.failures + 1, observation.failures),
                )
            current.evidence = evidence
            current.observedAt = observedAt
            current.severity = observation.severity
            continue
        }
        if (next.incidents.length >= NOTIFICATION_LIMITS.incidents) {
            const resolved = next.incidents.findIndex(
                (incident) =>
                    incident.recoveredAt !== null &&
                    !recoveryOwed(incident, configuration) &&
                    !next.deliveries.some(
                        (delivery) =>
                            isActive(delivery) && delivery.payload.incidentId === incident.id,
                    ),
            )
            if (resolved < 0) {
                defer(next)
                continue
            }
            next.incidents.splice(resolved, 1)
        }
        next.incidents.push({
            id: makeId(),
            category: observation.category,
            resourceId: observation.resourceId,
            severity: observation.severity,
            startedAt: observedAt,
            observedAt,
            evidence,
            failures: Math.max(1, observation.failures),
            recoveredAt: null,
            recoveryEvidence: null,
            channels: [],
        })
        if (!withinStateLimit(next)) {
            next.incidents.pop()
            defer(next)
        }
    }
    admit(next, configuration, nowMs, makeId)
    return next
}

export function claimNotificationDelivery(
    state: NotificationState,
    configuration: NotificationEngineConfiguration,
    nowMs: number,
    makeId: () => string,
): { state: NotificationState; delivery: NotificationClaimedDelivery | null } {
    const next = structuredClone(state)
    reconcile(next, configuration, nowMs)
    admit(next, configuration, nowMs, makeId)
    if (!configuration.enabled || configuration.pausedAfterRestore)
        return { state: next, delivery: null }
    const delivery = next.deliveries.find(
        (item) => item.status === 'pending' && item.nextAttemptAt <= nowMs,
    )
    if (!delivery) return { state: next, delivery: null }
    const leaseToken = makeId()
    delivery.status = 'inflight'
    delivery.attempts += 1
    delivery.updatedAt = nowMs
    delivery.leaseToken = leaseToken
    delivery.leaseExpiresAt = nowMs + NOTIFICATION_LIMITS.leaseMs
    return {
        state: next,
        delivery: {
            id: delivery.id,
            channelId: delivery.channelId,
            channelRevision: delivery.channelRevision,
            payload: structuredClone(delivery.payload),
            leaseToken,
        },
    }
}

export function finishNotificationDelivery(
    state: NotificationState,
    configuration: NotificationEngineConfiguration,
    leaseToken: string,
    result: NotificationDeliveryResult,
    nowMs: number,
): NotificationState {
    const next = structuredClone(state)
    const delivery = next.deliveries.find(
        (item) =>
            item.status === 'inflight' &&
            item.leaseToken === leaseToken &&
            item.leaseExpiresAt !== null &&
            item.leaseExpiresAt > nowMs,
    )
    if (delivery) {
        delivery.updatedAt = nowMs
        delivery.leaseToken = null
        delivery.leaseExpiresAt = null
        if (result.success) {
            delivery.status = 'succeeded'
            delivery.error = null
            markTerminal(next, delivery)
        } else {
            delivery.error = result.code
            const channelAllowed =
                configuration.enabled &&
                !configuration.pausedAfterRestore &&
                configuration.channels.some(
                    (channel) =>
                        channel.enabled &&
                        channel.id === delivery.channelId &&
                        channel.revision === delivery.channelRevision,
                )
            const terminalCode = [
                'destination_blocked',
                'redirect_denied',
                'payload_limit',
                'configuration_unavailable',
            ].includes(result.code)
            if (
                result.retryable &&
                !terminalCode &&
                channelAllowed &&
                delivery.attempts < NOTIFICATION_LIMITS.attempts &&
                nowMs - delivery.createdAt < NOTIFICATION_LIMITS.deliveryLifetimeMs
            ) {
                delivery.status = 'pending'
                const retryAfter =
                    result.retryAfterMs !== undefined && Number.isFinite(result.retryAfterMs)
                        ? Math.max(0, result.retryAfterMs)
                        : 0
                delivery.nextAttemptAt =
                    nowMs +
                    Math.min(
                        NOTIFICATION_LIMITS.retryMaximumMs,
                        Math.max(retryDelay(delivery.attempts), retryAfter),
                    )
            } else {
                delivery.status = 'failed'
                markTerminal(next, delivery)
            }
        }
    }
    reconcile(next, configuration, nowMs)
    return next
}

export function summarizeNotificationState(state: NotificationState) {
    return {
        incidents: state.incidents.map(
            ({
                evidence: _evidence,
                recoveryEvidence: _recoveryEvidence,
                channels: _channels,
                ...incident
            }) => incident,
        ),
        deliveries: state.deliveries.slice(-50).map((delivery) => ({
            id: delivery.id,
            incidentId: delivery.payload.incidentId,
            channelId: delivery.channelId,
            channelRevision: delivery.channelRevision,
            type: delivery.payload.type,
            status: delivery.status,
            attempts: delivery.attempts,
            updatedAt: delivery.updatedAt,
            error: delivery.error,
        })),
        deferredCount: state.deferredCount,
        saturationCount: state.saturationCount,
        pendingCount: state.deliveries.filter(isActive).length,
    }
}
