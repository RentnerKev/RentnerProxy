import { expect, test } from 'bun:test'
import { NOTIFICATION_LIMITS } from '@/config/notifications.config.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { getAllowedNotificationCategories } from '@/lib/Notifications/notification-access.ts'
import { getNotificationDeliveryState } from '@/lib/Notifications/delivery-state.ts'
import {
    cancelHostAvailabilityIncidents,
    observeHostAvailabilityTransition,
} from '@/server/Notifications/host-availability.ts'
import { enqueueBackupOutcomeNotifications } from '@/server/Notifications/backup-outcomes.ts'
import {
    createNotificationState,
    claimNotificationDelivery,
    finishNotificationDelivery,
} from '@/server/Notifications/incident-engine.ts'
import { filterNotificationConfigurationByOwnerAccess } from '@/server/Notifications/notification-access.ts'
import { notificationStateSchema } from '@/server/Notifications/notification-state.validation.ts'
import type { ManagedBackupAuditEvent } from '@/lib/Backups/Types/backups.types.ts'
import type { NotificationEngineConfiguration } from '@/server/Notifications/Types/notification-state.types.ts'
import type { StoredNotificationConfiguration } from '@/server/Notifications/Types/notification-internal.types.ts'

let counter = 100
const id = () => `00000000-0000-4000-8000-${String(counter++).padStart(12, '0')}`
const channel = {
    id: id(),
    name: 'Backup results',
    kind: 'webhook' as const,
    revision: 1,
    enabled: true,
    events: ['backup'] as const,
    minimumSeverity: 'warning' as const,
    thresholdSeconds: 0,
    recovery: true,
}
const configuration: NotificationEngineConfiguration = {
    enabled: true,
    pausedAfterRestore: false,
    channels: [channel],
}
const event = (
    kind: ManagedBackupAuditEvent['kind'] = 'succeeded',
    sequence = 1,
): ManagedBackupAuditEvent => ({ sequence, kind, jobId: id(), actorId: null, at: 1000 })
const enqueue = (events: ManagedBackupAuditEvent[], config = configuration) =>
    enqueueBackupOutcomeNotifications(createNotificationState(), config, events, 2000, id)

// These are terminal job results, not failure/recovery transitions.
test('the first successful backup creates an honest success delivery without a fake incident', () => {
    const outcome = event()
    const result = enqueue([outcome])
    expect(result.accepted).toBe(1)
    expect(result.queued).toBe(1)
    expect(result.state.incidents).toEqual([])
    expect(result.state.deliveries[0]?.payload).toMatchObject({
        category: 'backup',
        resourceId: outcome.jobId,
        type: 'success',
        severity: 'info',
        code: 'backup_succeeded',
        failures: 0,
    })
    expect(notificationStateSchema.safeParse(result.state).success).toBe(true)
    const delivery = result.state.deliveries[0]!
    expect(
        getNotificationDeliveryState(
            {
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
            },
            undefined,
        ),
    ).toBe('backup_succeeded')
})

test('failed and interrupted jobs each get a failure event and a later success needs no prior delivered failure', () => {
    const result = enqueue([event('failed'), event('interrupted', 2), event('succeeded', 3)])
    expect(result.state.deliveries.map((delivery) => delivery.payload.code)).toEqual([
        'backup_failed',
        'backup_failed',
        'backup_succeeded',
    ])
    expect(result.state.incidents).toHaveLength(0)
    expect(
        result.state.deliveries
            .map((delivery) => delivery.payload.incidentId)
            .every((value, index, all) => all.indexOf(value) === index),
    ).toBe(true)
})

test('subscription, severity and recovery settings are explicit for one-shot outcomes', () => {
    const critical = {
        ...configuration,
        channels: [{ ...channel, minimumSeverity: 'critical' as const }],
    }
    expect(enqueue([event('failed')], critical).queued).toBe(0)
    expect(enqueue([event('succeeded')], critical).queued).toBe(1)
    expect(
        enqueue([event('succeeded')], {
            ...configuration,
            channels: [{ ...channel, recovery: false }],
        }).queued,
    ).toBe(0)
    expect(
        enqueue([event('failed')], {
            ...configuration,
            channels: [{ ...channel, events: ['ddns'] }],
        }).queued,
    ).toBe(0)
})

test('failure threshold delays from outcome time and does not restart its clock on late ingestion', () => {
    const config = { ...configuration, channels: [{ ...channel, thresholdSeconds: 10 }] }
    const outcome = event('failed')
    const result = enqueueBackupOutcomeNotifications(
        createNotificationState(),
        config,
        [outcome],
        2000,
        id,
    )
    expect(result.state.deliveries[0]?.nextAttemptAt).toBe(11000)
    expect(claimNotificationDelivery(result.state, config, 10999, id).delivery).toBeNull()
    expect(claimNotificationDelivery(result.state, config, 11000, id).delivery?.payload.code).toBe(
        'backup_failed',
    )
    const late = enqueueBackupOutcomeNotifications(
        createNotificationState(),
        config,
        [outcome],
        12000,
        id,
    )
    expect(late.state.deliveries[0]?.nextAttemptAt).toBe(12000)
    expect(enqueue([event()], config).state.deliveries[0]?.nextAttemptAt).toBe(2000)
})

test.each([{ enabled: false }, { pausedAfterRestore: true }])(
    'disabled/restore-paused policy consumes audit events without later notification replay: %j',
    (policy) => {
        const result = enqueue([event('failed'), event()], { ...configuration, ...policy })
        expect(result.accepted).toBe(2)
        expect(result.queued).toBe(0)
        expect(result.state.deliveries).toHaveLength(0)
    },
)

test('backup category requires its domain view permission and owner revocation blocks pending queue claims', () => {
    expect(getAllowedNotificationCategories([PERMISSIONS.NOTIFICATIONS_MANAGE])).not.toContain(
        'backup',
    )
    expect(getAllowedNotificationCategories([PERMISSIONS.BACKUPS_VIEW])).toContain('backup')
    const ownerId = id()
    const stored: StoredNotificationConfiguration = {
        ...configuration,
        version: 1,
        revision: 1,
        channels: [
            {
                ...channel,
                ownerUserId: ownerId,
                destination: { ciphertext: 'fixture', iv: 'fixture' },
                hasAuthorization: false,
            },
        ],
    }
    const effective = filterNotificationConfigurationByOwnerAccess(
        stored,
        new Map([[ownerId, { permissions: [PERMISSIONS.APP_ACCESS] }]]),
    )
    expect(effective.channels).toHaveLength(0)
    expect(enqueue([event()], effective).queued).toBe(0)
    const pending = enqueue([event()]).state
    const revoked = claimNotificationDelivery(pending, effective, 2001, id)
    expect(revoked.delivery).toBeNull()
    expect(revoked.state.deliveries[0]?.status).toBe('cancelled')
})

test('standalone outcome deliveries retain existing durable retries and completion handling', () => {
    const state = enqueue([event()]).state
    const claimed = claimNotificationDelivery(state, configuration, 2000, id)
    expect(claimed.delivery?.payload.type).toBe('success')
    const retried = finishNotificationDelivery(
        claimed.state,
        configuration,
        claimed.delivery!.leaseToken,
        { success: false, code: 'destination_unavailable', retryable: true },
        2001,
    )
    expect(retried.deliveries[0]?.status).toBe('pending')
    const resumed = claimNotificationDelivery(
        notificationStateSchema.parse(JSON.parse(JSON.stringify(retried))),
        configuration,
        40000,
        id,
    )
    const delivered = finishNotificationDelivery(
        resumed.state,
        configuration,
        resumed.delivery!.leaseToken,
        { success: true },
        40001,
    )
    expect(delivered.deliveries[0]?.status).toBe('succeeded')
    expect(delivered.incidents).toHaveLength(0)
})

test('queue overflow stops at the accepted event prefix and never drops remaining outcomes', () => {
    const events = Array.from({ length: NOTIFICATION_LIMITS.deliveries + 1 }, (_, index) =>
        event('succeeded', index + 1),
    )
    const result = enqueue(events)
    expect(result.accepted).toBe(NOTIFICATION_LIMITS.deliveries)
    expect(result.queued).toBe(NOTIFICATION_LIMITS.deliveries)
    expect(result.state.deliveries.at(-1)?.payload.resourceId).toBe(events[255]!.jobId!)
    expect(
        result.state.deliveries.some(
            (delivery) => delivery.payload.resourceId === events[256]?.jobId,
        ),
    ).toBe(false)
})

test('partial fanout rejection leaves state and ID source untouched', () => {
    const initial = enqueue(
        Array.from({ length: 255 }, (_, index) => event('succeeded', index + 1)),
    ).state
    const before = structuredClone(initial)
    let ids = 0
    const result = enqueueBackupOutcomeNotifications(
        initial,
        { ...configuration, channels: [channel, { ...channel, id: id() }] },
        [event()],
        2000,
        () => {
            ids++
            return id()
        },
    )
    expect(result.accepted).toBe(0)
    expect(result.queued).toBe(0)
    expect(result.state).toEqual(before)
    expect(initial).toEqual(before)
    expect(ids).toBe(0)
})

test('nonterminal history is consumed and payloads contain only allowlisted outcome fields', () => {
    const outcome = event('failed')
    const result = enqueue([event('requested'), event('started'), outcome, event('pruned')])
    expect(result.accepted).toBe(4)
    expect(result.queued).toBe(1)
    expect(Object.keys(result.state.deliveries[0]!.payload).toSorted()).toEqual(
        [
            'category',
            'code',
            'failures',
            'id',
            'incidentId',
            'occurredAt',
            'resourceId',
            'schemaVersion',
            'severity',
            'startedAt',
            'type',
        ].toSorted(),
    )
})

test('maximum 86400 second delay preserves the real admission time and a full immutable retry lifetime', () => {
    const config = { ...configuration, channels: [{ ...channel, thresholdSeconds: 86400 }] }
    const outcome = event('failed')
    const now = outcome.at
    const due = now + 86400 * 1000
    const state = enqueueBackupOutcomeNotifications(
        createNotificationState(),
        config,
        [outcome],
        now,
        id,
    ).state
    expect(state.deliveries[0]).toMatchObject({
        createdAt: now,
        updatedAt: now,
        backupAvailableAt: due,
        nextAttemptAt: due,
    })
    expect(claimNotificationDelivery(state, config, due - 1, id).delivery).toBeNull()
    const first = claimNotificationDelivery(state, config, due, id)
    expect(first.delivery).not.toBeNull()
    const afterLease = claimNotificationDelivery(
        first.state,
        config,
        due + NOTIFICATION_LIMITS.leaseMs,
        id,
    )
    expect(afterLease.delivery).toBeNull()
    expect(afterLease.state.deliveries[0]?.status).toBe('pending')
    const retryAt = afterLease.state.deliveries[0]!.nextAttemptAt
    const retry = claimNotificationDelivery(afterLease.state, config, retryAt, id)
    expect(retry.delivery).not.toBeNull()
    const failed = finishNotificationDelivery(
        retry.state,
        config,
        retry.delivery!.leaseToken,
        { success: false, code: 'destination_unavailable', retryable: true },
        retryAt + 1,
    )
    expect(failed.deliveries[0]?.status).toBe('pending')
    expect(failed.deliveries[0]?.backupAvailableAt).toBe(due)
    const expired = claimNotificationDelivery(
        failed,
        config,
        due + NOTIFICATION_LIMITS.deliveryLifetimeMs,
        id,
    )
    expect(expired.delivery).toBeNull()
    expect(expired.state.deliveries[0]?.status).toBe('failed')
})

test('backup scheduling state cannot extend incident lifetimes or move beyond the configured maximum delay', () => {
    const state = enqueue([event()]).state
    const wrongCategory = structuredClone(state)
    wrongCategory.deliveries[0]!.payload = {
        ...wrongCategory.deliveries[0]!.payload,
        category: 'ddns',
    }
    expect(notificationStateSchema.safeParse(wrongCategory).success).toBe(false)
    state.deliveries[0]!.backupAvailableAt = state.deliveries[0]!.createdAt + 86400 * 1000 + 1
    expect(notificationStateSchema.safeParse(state).success).toBe(false)
})

test('host availability incidents and standalone backup outcomes coexist through claim and completion', () => {
    const mixed = {
        ...configuration,
        channels: [{ ...channel, events: ['backup', 'host_availability'] as const }],
    }
    const hostId = id()
    const hostIncidentId = id()
    const state = observeHostAvailabilityTransition(
        createNotificationState(),
        mixed,
        {
            kind: 'outage',
            incidentId: hostIncidentId,
            proxyHostId: hostId,
            startedAt: 1000,
            occurredAt: 2000,
            failures: 2,
            host: {
                policyId: id(),
                policyVersion: id(),
                contextProof: 'sha256:' + 'a'.repeat(64),
                contextRevision: 'sha256:' + 'b'.repeat(64),
                domain: 'upstream.example.test',
                failureCode: 'upstream_timeout',
                detectedAt: new Date(2000).toISOString(),
                recoveryStartedAt: null,
                managementPath: '/proxy-hosts',
            },
        },
        2000,
        id,
    )
    expect(state.incidents).toHaveLength(1)
    expect(state.deliveries).toHaveLength(1)
    const merged = enqueueBackupOutcomeNotifications(state, mixed, [event()], 2000, id)
    expect(merged.state.incidents).toHaveLength(1)
    expect(merged.state.deliveries).toHaveLength(2)
    expect(notificationStateSchema.safeParse(merged.state).success).toBe(true)
    const cancelledHost = cancelHostAvailabilityIncidents(
        merged.state,
        new Set([hostIncidentId]),
        2001,
    )
    const afterCancellation = claimNotificationDelivery(cancelledHost, mixed, 2002, id)
    expect(afterCancellation.delivery?.payload.category).toBe('backup')
    const backupRetried = finishNotificationDelivery(
        afterCancellation.state,
        mixed,
        afterCancellation.delivery!.leaseToken,
        { success: false, code: 'destination_unavailable', retryable: true },
        2003,
    )
    expect(
        backupRetried.deliveries.find((delivery) => delivery.payload.category === 'backup'),
    ).toMatchObject({ status: 'pending', backupAvailableAt: 2000 })
    const hostClaim = claimNotificationDelivery(merged.state, mixed, 2000, id)
    expect(hostClaim.delivery?.payload.category).toBe('host_availability')
    const hostDelivered = finishNotificationDelivery(
        hostClaim.state,
        mixed,
        hostClaim.delivery!.leaseToken,
        { success: true },
        2001,
    )
    const backupClaim = claimNotificationDelivery(hostDelivered, mixed, 2002, id)
    expect(backupClaim.delivery?.payload.category).toBe('backup')
    expect(backupClaim.delivery?.payload.host).toBeUndefined()
    const completed = finishNotificationDelivery(
        backupClaim.state,
        mixed,
        backupClaim.delivery!.leaseToken,
        { success: true },
        2003,
    )
    expect(completed.deliveries.map((delivery) => delivery.status)).toEqual([
        'succeeded',
        'succeeded',
    ])
    expect(completed.incidents[0]?.id).toBe(hostIncidentId)
    expect(completed.incidents[0]?.channels[0]?.failure).toBe('succeeded')
    expect(
        getAllowedNotificationCategories([PERMISSIONS.BACKUPS_VIEW, PERMISSIONS.PROXY_HOSTS_VIEW]),
    ).toEqual(['proxy_configuration', 'backup', 'host_availability'])
})
