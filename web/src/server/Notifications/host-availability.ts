import { createHash } from 'node:crypto'
import { NotificationDomainError } from './notification.errors.ts'
import {
    appendNotificationIncident,
    admitNotificationIncidents,
    observeNotificationSignals,
} from './incident-engine.ts'
import type {
    HostAvailabilityNotificationTransition,
    NotificationEngineConfiguration,
    NotificationState,
} from './Types/notification-state.types.ts'

export function cancelHostAvailabilityIncidents(
    state: NotificationState,
    incidentIds: ReadonlySet<string>,
    now: number,
): NotificationState {
    if (incidentIds.size === 0) return state
    const next = structuredClone(state)
    next.incidents = next.incidents.filter(
        (incident) => incident.category !== 'host_availability' || !incidentIds.has(incident.id),
    )
    for (const delivery of next.deliveries) {
        if (
            delivery.payload.category === 'host_availability' &&
            incidentIds.has(delivery.payload.incidentId) &&
            (delivery.status === 'pending' || delivery.status === 'inflight')
        ) {
            delivery.status = 'cancelled'
            delivery.error = 'cancelled'
            delivery.updatedAt = now
            delivery.leaseToken = null
            delivery.leaseExpiresAt = null
        }
    }
    return next
}

export function observeHostAvailabilityTransition(
    state: NotificationState,
    configuration: NotificationEngineConfiguration,
    transition: HostAvailabilityNotificationTransition,
    now: number,
    makeId: () => string,
): NotificationState {
    if (
        transition.kind === 'outage' &&
        (!configuration.enabled || configuration.pausedAfterRestore)
    )
        return state
    let next = structuredClone(state)
    if (transition.kind === 'outage') {
        if (next.incidents.some((incident) => incident.id === transition.incidentId)) return state
        next = cancelHostAvailabilityIncidents(
            next,
            new Set(
                next.incidents
                    .filter(
                        (incident) =>
                            incident.category === 'host_availability' &&
                            incident.resourceId === transition.proxyHostId &&
                            incident.recoveredAt === null,
                    )
                    .map((incident) => incident.id),
            ),
            now,
        )
        const admitted = appendNotificationIncident(next, configuration, {
            id: transition.incidentId,
            category: 'host_availability',
            resourceId: transition.proxyHostId,
            severity: 'error',
            startedAt: transition.startedAt,
            observedAt: transition.occurredAt,
            evidence: transition.incidentId,
            failures: transition.failures,
            recoveredAt: null,
            recoveryEvidence: null,
            channels: [],
            host: {
                ...transition.host,
                subscriptions: configuration.channels
                    .filter(
                        (channel) =>
                            channel.enabled && channel.events.includes('host_availability'),
                    )
                    .map((channel) => ({
                        channelId: channel.id,
                        channelRevision: channel.revision,
                    })),
            },
        })
        if (!admitted) throw new NotificationDomainError('configuration_unavailable')
    } else {
        // Admit a threshold-qualified outage before closing it, even when the sender was offline.
        const incident = next.incidents.find(
            (candidate) => candidate.id === transition.incidentId && candidate.host,
        )
        if (!incident || incident.recoveredAt !== null) return next
        const subscriptions =
            configuration.enabled && !configuration.pausedAfterRestore
                ? (incident.host?.subscriptions ?? []).filter((subscription) =>
                      configuration.channels.some(
                          (channel) =>
                              channel.enabled &&
                              channel.events.includes('host_availability') &&
                              channel.id === subscription.channelId &&
                              channel.revision === subscription.channelRevision,
                      ),
                  )
                : []
        if (!configuration.enabled || configuration.pausedAfterRestore)
            for (const marker of incident.channels) marker.recovery ??= 'failed'
        admitNotificationIncidents(
            next,
            {
                ...configuration,
                channels: configuration.channels.filter((channel) =>
                    subscriptions.some(
                        (subscription) =>
                            subscription.channelId === channel.id &&
                            subscription.channelRevision === channel.revision,
                    ),
                ),
            },
            transition.occurredAt,
            makeId,
            incident.id,
        )
        incident.recoveredAt = transition.occurredAt
        incident.recoveryEvidence = createHash('sha256')
            .update(`${transition.incidentId}:recovered`)
            .digest('hex')
        incident.host = { ...transition.host, subscriptions }
    }
    return observeNotificationSignals(next, configuration, [], now, makeId)
}
