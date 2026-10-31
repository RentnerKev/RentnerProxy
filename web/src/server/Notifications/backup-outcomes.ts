import { NOTIFICATION_LIMITS, NOTIFICATION_SEVERITIES } from '@/config/notifications.config.ts'
import type { ManagedBackupAuditEvent } from '@/lib/Backups/Types/backups.types.ts'
import type {
    NotificationEngineConfiguration,
    NotificationQueuedDelivery,
    NotificationState,
} from './Types/notification-state.types.ts'
import { reserveNotificationDeliverySlot } from './incident-engine.ts'
import { notificationStateSchema } from './notification-state.validation.ts'

export function enqueueBackupOutcomeNotifications(
    state: NotificationState,
    configuration: NotificationEngineConfiguration,
    events: readonly ManagedBackupAuditEvent[],
    now: number,
    makeId: () => string,
) {
    let next = structuredClone(state)
    let queued = 0
    for (let index = 0; index < events.length; index++) {
        const event = events[index]!
        const success = event.kind === 'succeeded'
        if (
            (!success && event.kind !== 'failed' && event.kind !== 'interrupted') ||
            !event.jobId ||
            !configuration.enabled ||
            configuration.pausedAfterRestore
        )
            continue
        const channels = configuration.channels.filter(
            (channel) =>
                channel.enabled &&
                channel.events.includes('backup') &&
                (success
                    ? channel.recovery
                    : NOTIFICATION_SEVERITIES.indexOf(channel.minimumSeverity) <=
                      NOTIFICATION_SEVERITIES.indexOf('error')),
        )
        if (channels.length === 0) continue
        const candidate = structuredClone(next)
        const added: NotificationQueuedDelivery[] = []
        let placeholderSequence = 0
        const placeholder = () => {
            let value: string
            do {
                value = `00000000-0000-4000-8000-${String(++placeholderSequence).padStart(12, '0')}`
            } while (candidate.deliveries.some((delivery) => delivery.id === value))
            return value
        }
        // Preflight the complete fanout before consuming IDs or modifying accepted state.
        const incidentId = placeholder()
        for (const channel of channels) {
            if (!reserveNotificationDeliverySlot(candidate))
                return { state: next, accepted: index, queued }
            const id = placeholder()
            const delivery: NotificationQueuedDelivery = {
                id,
                channelId: channel.id,
                channelRevision: channel.revision,
                payload: {
                    schemaVersion: 1,
                    id,
                    incidentId,
                    type: success ? 'success' : 'incident',
                    category: 'backup',
                    severity: success ? 'info' : 'error',
                    resourceId: event.jobId,
                    code: success ? 'backup_succeeded' : 'backup_failed',
                    occurredAt: new Date(event.at).toISOString(),
                    startedAt: new Date(event.at).toISOString(),
                    failures: success ? 0 : 1,
                },
                backupAvailableAt: success
                    ? now
                    : Math.max(now, event.at + channel.thresholdSeconds * 1000),
                status: 'pending',
                attempts: 0,
                createdAt: now,
                updatedAt: now,
                // Backup failures are terminal events: the threshold delays dispatch, rather than inventing an ongoing outage.
                nextAttemptAt: success
                    ? now
                    : Math.max(now, event.at + channel.thresholdSeconds * 1000),
                leaseToken: null,
                leaseExpiresAt: null,
                error: null,
            }
            candidate.deliveries.push(delivery)
            added.push(delivery)
        }
        if (
            !notificationStateSchema.safeParse(candidate).success ||
            new TextEncoder().encode(JSON.stringify(candidate)).byteLength >
                NOTIFICATION_LIMITS.stateBytes - NOTIFICATION_LIMITS.deliveries * 256
        )
            return { state: next, accepted: index, queued }
        const outcomeId = makeId()
        for (const delivery of added) {
            const id = makeId()
            delivery.id = id
            delivery.payload = { ...delivery.payload, id, incidentId: outcomeId }
        }
        next = notificationStateSchema.parse(candidate)
        queued += added.length
    }
    return { state: next, accepted: events.length, queued }
}
