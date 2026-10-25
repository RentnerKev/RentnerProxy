import { createHash } from 'node:crypto'
import { NOTIFICATION_LIMITS, NOTIFICATION_SEVERITIES } from '@/config/notifications.config.ts'
import type {
    NotificationDeliveryResult,
    NotificationObservation,
    NotificationPayload,
    NotificationStatus,
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
                        channel.events.includes(incident.category) &&
                        channel.recovery,
                ),
        )
    )
}

export function createNotificationState(): NotificationState {
    return {
        version: 1,
        proxyApplyPending: null,
        incidents: [],
        deliveries: [],
        deferredCount: 0,
        saturationCount: 0,
    }
}

function isActive(delivery: NotificationQueuedDelivery) {
    return delivery.status === 'pending' || delivery.status === 'inflight'
}

function markTerminal(state: NotificationState, delivery: NotificationQueuedDelivery) {
    if (delivery.payload.type === 'test') return
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
    const leaseLost = delivery.status === 'inflight'
    delivery.status = status
    delivery.error =
        status === 'cancelled' ? 'cancelled' : leaseLost ? 'timeout' : (delivery.error ?? 'timeout')
    delivery.updatedAt = nowMs
    delivery.leaseToken = null
    delivery.leaseExpiresAt = null
    markTerminal(state, delivery)
}

function isSupersededManualDelivery(
    state: NotificationState,
    delivery: NotificationQueuedDelivery,
): boolean {
    if (delivery.payload.code !== 'certificate_renewal_manual_dns_required') return false
    const incident = state.incidents.find((item) => item.id === delivery.payload.incidentId)
    if (!incident || incident.recoveredAt === null) return false
    return incident.channels.some(
        (marker) =>
            marker.channelId === delivery.channelId &&
            marker.channelRevision === delivery.channelRevision &&
            marker.recovery === 'failed',
    )
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
                    channel.revision === delivery.channelRevision &&
                    channel.events.includes(delivery.payload.category),
            )
        // An admitted network attempt may finish, but cannot be claimed again after policy revocation.
        if (
            delivery.status === 'inflight' &&
            delivery.leaseExpiresAt !== null &&
            delivery.leaseExpiresAt > nowMs
        )
            continue
        if (!allowed || isSupersededManualDelivery(state, delivery)) {
            terminate(state, delivery, 'cancelled', nowMs)
        } else if (delivery.payload.type === 'test') {
            // A manual test is one attempt, never a delayed background send after a crash.
            terminate(state, delivery, 'failed', nowMs)
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

export function reserveNotificationDeliverySlot(state: NotificationState) {
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
            if (!channel.enabled || !channel.events.includes(incident.category)) continue
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
            if (!reserveNotificationDeliverySlot(state)) {
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
                      ? (incident.code ?? 'certificate_renewal_failed')
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
            (observation.source === 'event' &&
                nowMs - observedAt >= NOTIFICATION_LIMITS.retentionMs) ||
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
        let current = matching.find((incident) => incident.recoveredAt === null)
        const lastObservedAt = Math.max(
            -1,
            ...matching.map((incident) => incident.recoveredAt ?? incident.observedAt),
        )
        if (observedAt < lastObservedAt) continue
        let health = observation.health
        let startedAt = observedAt
        if (observation.category === 'proxy_configuration') {
            const pending = next.proxyApplyPending
            if (pending && observedAt < pending.observedAt) continue
            if (health === 'pending') {
                if (!observation.desiredRevision || observation.desiredRevision.length > 128)
                    continue
                if (!pending || pending.desiredRevision !== observation.desiredRevision) {
                    next.proxyApplyPending = {
                        desiredRevision: observation.desiredRevision,
                        since: observedAt,
                        observedAt,
                    }
                    continue
                }
                pending.observedAt = observedAt
                if (observedAt - pending.since < NOTIFICATION_LIMITS.proxyApplyGraceMs) continue
                health = 'failing'
                startedAt = pending.since
            } else if (health === 'healthy') next.proxyApplyPending = null
        }
        if (health === 'pending') continue
        const evidence = createHash('sha256').update(observation.evidence).digest('hex')
        if (health === 'healthy' && current?.evidence === evidence) continue
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
        if (health === 'healthy') {
            if (current) {
                current.recoveredAt = observedAt
                current.recoveryEvidence = evidence
            }
            continue
        }
        if (
            current &&
            (current.code !== observation.code ||
                (observation.code === 'certificate_renewal_manual_dns_required' &&
                    current.evidence !== evidence))
        ) {
            // A new TXT request or a terminal failure is a distinct actionable condition.
            // Preserve an elapsed threshold when the same renewal moves from waiting to failure.
            // Supersession is silent; only an activated certificate reports recovery.
            if (
                current.code === 'certificate_renewal_manual_dns_required' &&
                observation.code === undefined
            )
                startedAt = current.startedAt
            current.recoveredAt = observedAt
            current.recoveryEvidence = evidence
            for (const delivery of next.deliveries) {
                if (delivery.payload.incidentId === current.id && delivery.status === 'pending')
                    terminate(next, delivery, 'cancelled', nowMs)
            }
            for (const marker of current.channels) marker.recovery ??= 'failed'
            current = undefined
        }
        if (current) {
            if (observation.code === undefined) delete current.code
            else current.code = observation.code
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
            startedAt,
            observedAt,
            evidence,
            failures: Math.max(1, observation.failures),
            recoveredAt: null,
            recoveryEvidence: null,
            ...(observation.code ? { code: observation.code } : {}),
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
        } else if (isSupersededManualDelivery(next, delivery)) {
            terminate(next, delivery, 'cancelled', nowMs)
        } else {
            delivery.error = result.code
            const channelAllowed =
                configuration.enabled &&
                !configuration.pausedAfterRestore &&
                configuration.channels.some(
                    (channel) =>
                        channel.enabled &&
                        channel.id === delivery.channelId &&
                        channel.revision === delivery.channelRevision &&
                        channel.events.includes(delivery.payload.category),
                )
            const terminalCode = [
                'destination_blocked',
                'redirect_denied',
                'payload_limit',
                'configuration_unavailable',
            ].includes(result.code)
            if (
                result.retryable &&
                delivery.payload.type !== 'test' &&
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

export function summarizeNotificationState(state: NotificationState): NotificationStatus {
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
            category: delivery.payload.category,
            resourceId: delivery.payload.resourceId,
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
