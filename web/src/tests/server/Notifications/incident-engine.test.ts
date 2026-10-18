import { describe, expect, test } from 'bun:test'
import { NOTIFICATION_LIMITS } from '@/config/notifications.config.ts'
import {
    claimNotificationDelivery,
    createNotificationState,
    finishNotificationDelivery,
    observeNotificationSignals,
    summarizeNotificationState,
} from '@/server/Notifications/incident-engine.ts'
import { notificationStateSchema } from '@/server/Notifications/notification-state.validation.ts'
import type {
    NotificationEngineConfiguration,
    NotificationState,
} from '@/server/Notifications/Types/notification-state.types.ts'
import type { NotificationObservation } from '@/lib/Notifications/Types/notifications.types.ts'

let sequence = 0
const makeId = () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`
const channelId = '00000000-0000-4000-8000-000000000000'
const configuration: NotificationEngineConfiguration = {
    enabled: true,
    pausedAfterRestore: false,
    channels: [
        {
            id: channelId,
            name: 'Office',
            kind: 'webhook',
            revision: 1,
            enabled: true,
            events: ['ddns'],
            minimumSeverity: 'error',
            thresholdSeconds: 0,
            recovery: true,
        },
    ],
}
const observation = (
    at: number,
    health: 'healthy' | 'failing' = 'failing',
    evidence = health === 'healthy' ? 'healthy-attempt-1' : 'attempt-1',
): NotificationObservation => ({
    source: 'event',
    category: 'ddns',
    resourceId: 'host-1',
    health,
    severity: 'error',
    occurredAt: new Date(at).toISOString(),
    evidence,
    failures: 1,
})
const observe = (state: NotificationState, at: number, health: 'healthy' | 'failing' = 'failing') =>
    observeNotificationSignals(state, configuration, [observation(at, health)], at, makeId)

const proxySignal = (at: number, health: 'failing' | 'healthy'): NotificationObservation => ({
    ...observation(at, health, health),
    category: 'proxy_configuration',
    resourceId: 'instance',
})

const pendingProxy = (at: number, desiredRevision = 'revision-1'): NotificationObservation => ({
    ...proxySignal(at, 'failing'),
    source: 'snapshot',
    health: 'pending',
    desiredRevision,
    evidence: `pending:${desiredRevision}`,
})

describe('durable notification incidents and outbox', () => {
    test('thresholds and repeated evidence survive JSON restart without poll failures', () => {
        const config = {
            ...configuration,
            channels: configuration.channels.map((channel) => ({
                ...channel,
                thresholdSeconds: 60,
            })),
        }
        let state = observeNotificationSignals(
            createNotificationState(),
            config,
            [observation(1_000)],
            1_000,
            makeId,
        )
        expect(state.deliveries).toHaveLength(0)
        state = notificationStateSchema.parse(JSON.parse(JSON.stringify(state)))
        state = observeNotificationSignals(state, config, [observation(2_000)], 61_000, makeId)
        expect(state.incidents[0]?.failures).toBe(1)
        expect(state.deliveries).toHaveLength(1)
        state = observeNotificationSignals(state, config, [observation(3_000)], 62_000, makeId)
        expect(state.deliveries).toHaveLength(1)
        expect(state.incidents[0]?.failures).toBe(1)
    })

    test('severity and category subscriptions decide admission', () => {
        let state = observeNotificationSignals(
            createNotificationState(),
            configuration,
            [{ ...observation(1_000), severity: 'warning' }],
            1_000,
            makeId,
        )
        expect(state.deliveries).toHaveLength(0)
        state = observeNotificationSignals(
            state,
            configuration,
            [observation(2_000, 'failing', 'attempt-2')],
            2_000,
            makeId,
        )
        expect(state.deliveries).toHaveLength(1)
        const unsubscribed = observeNotificationSignals(
            createNotificationState(),
            configuration,
            [{ ...observation(1_000), category: 'proxy_configuration' }],
            1_000,
            makeId,
        )
        expect(unsubscribed.deliveries).toHaveLength(0)
    })

    test('distinct evidence orders same-second recovery before failure ACK while repeated evidence stays idempotent', () => {
        const claimed = claimNotificationDelivery(
            observe(createNotificationState(), 1_000),
            configuration,
            1_000,
            makeId,
        )
        let state = observeNotificationSignals(
            claimed.state,
            configuration,
            [observation(1_000, 'healthy', 'attempt-1')],
            1_001,
            makeId,
        )
        expect(state.incidents[0]?.recoveredAt).toBeNull()
        state = observeNotificationSignals(
            state,
            configuration,
            [observation(999, 'healthy', 'older-health')],
            1_002,
            makeId,
        )
        expect(state.incidents[0]?.recoveredAt).toBeNull()
        state = observeNotificationSignals(
            state,
            configuration,
            [observation(1_000, 'healthy', 'actual-recovery')],
            1_003,
            makeId,
        )
        expect(state.incidents[0]?.recoveredAt).toBe(1_000)
        expect(state.deliveries).toHaveLength(1)
        state = notificationStateSchema.parse(JSON.parse(JSON.stringify(state)))
        state = observeNotificationSignals(
            state,
            configuration,
            [observation(1_000)],
            1_004,
            makeId,
        )
        expect(state.incidents).toHaveLength(1)
        state = finishNotificationDelivery(
            state,
            configuration,
            claimed.delivery!.leaseToken,
            { success: true },
            1_005,
        )
        const recovered = claimNotificationDelivery(state, configuration, 1_006, makeId)
        expect(recovered.delivery?.payload.type).toBe('recovery')
        expect(recovered.delivery?.payload.occurredAt).toBe(claimed.delivery?.payload.occurredAt)
        expect(recovered.delivery?.payload.incidentId).toBe(claimed.delivery?.payload.incidentId)
        state = observeNotificationSignals(
            recovered.state,
            configuration,
            [observation(1_000, 'failing', 'new-attempt')],
            1_007,
            makeId,
        )
        expect(state.incidents).toHaveLength(2)
        expect(state.incidents.at(-1)?.recoveredAt).toBeNull()
    })

    test('unknown and stale healthy observations cannot recover a source', () => {
        let state = observe(createNotificationState(), 2_000)
        state = observeNotificationSignals(state, configuration, [], 3_000, makeId)
        state = observeNotificationSignals(
            state,
            configuration,
            [observation(1_000, 'healthy')],
            3_000,
            makeId,
        )
        expect(state.incidents[0]?.recoveredAt).toBeNull()
        state = observe(state, 4_000, 'healthy')
        expect(state.incidents[0]?.recoveredAt).toBe(4_000)
        expect(state.deliveries).toHaveLength(1)
    })

    test('recovery waits for acknowledged failure and carries its incident ID', () => {
        let state = observe(createNotificationState(), 1_000)
        const claimed = claimNotificationDelivery(state, configuration, 1_000, makeId)
        state = observe(claimed.state, 2_000, 'healthy')
        expect(state.deliveries).toHaveLength(1)
        state = finishNotificationDelivery(
            state,
            configuration,
            claimed.delivery!.leaseToken,
            { success: true },
            3_000,
        )
        const recovery = claimNotificationDelivery(state, configuration, 3_000, makeId)
        expect(recovery.delivery?.payload.type).toBe('recovery')
        expect(recovery.delivery?.payload.incidentId).toBe(claimed.delivery?.payload.incidentId)
        expect(notificationStateSchema.safeParse(recovery.state).success).toBe(true)
        expect(JSON.stringify(summarizeNotificationState(recovery.state))).not.toContain(
            recovery.delivery!.leaseToken,
        )
    })

    test('terminal failure and expired leases do not acknowledge or unblock recovery', () => {
        const claimed = claimNotificationDelivery(
            observe(createNotificationState(), 1_000),
            configuration,
            1_000,
            makeId,
        )
        let state = observe(claimed.state, 2_000, 'healthy')
        state = finishNotificationDelivery(
            state,
            configuration,
            claimed.delivery!.leaseToken,
            { success: false, code: 'destination_blocked', retryable: false },
            3_000,
        )
        expect(claimNotificationDelivery(state, configuration, 4_000, makeId).delivery).toBeNull()
        const another = claimNotificationDelivery(
            observe(createNotificationState(), 1_000),
            configuration,
            1_000,
            makeId,
        )
        state = finishNotificationDelivery(
            another.state,
            configuration,
            another.delivery!.leaseToken,
            { success: true },
            1_000 + NOTIFICATION_LIMITS.leaseMs,
        )
        expect(state.deliveries[0]?.status).toBe('pending')
        const reclaimed = claimNotificationDelivery(
            state,
            configuration,
            1_000 + NOTIFICATION_LIMITS.leaseMs + NOTIFICATION_LIMITS.retryInitialMs,
            makeId,
        )
        expect(reclaimed.delivery?.id).toBe(another.delivery?.id)
        expect(reclaimed.delivery?.leaseToken).not.toBe(another.delivery?.leaseToken)
        state = finishNotificationDelivery(
            reclaimed.state,
            configuration,
            another.delivery!.leaseToken,
            { success: true },
            125_000,
        )
        expect(state.deliveries[0]?.status).toBe('inflight')
    })

    test('retry backoff caps Retry-After, exhausts attempts and expires TTL', () => {
        let state = observe(createNotificationState(), 1_000)
        let now = 1_000
        for (let attempt = 0; attempt < NOTIFICATION_LIMITS.attempts; attempt += 1) {
            const claim = claimNotificationDelivery(state, configuration, now, makeId)
            expect(claim.delivery).not.toBeNull()
            state = finishNotificationDelivery(
                claim.state,
                configuration,
                claim.delivery!.leaseToken,
                {
                    success: false,
                    code: 'timeout',
                    retryable: true,
                    retryAfterMs: Number.MAX_SAFE_INTEGER,
                },
                now + 1,
            )
            expect(state.deliveries[0]!.nextAttemptAt).toBeLessThanOrEqual(
                now + 1 + NOTIFICATION_LIMITS.retryMaximumMs,
            )
            now += NOTIFICATION_LIMITS.retryMaximumMs + 1
        }
        expect(state.deliveries[0]?.status).toBe('failed')
        expect(state.incidents).toHaveLength(1)
        const expired = claimNotificationDelivery(
            observe(createNotificationState(), 1_000),
            configuration,
            1_000 + NOTIFICATION_LIMITS.deliveryLifetimeMs,
            makeId,
        )
        expect(expired.delivery).toBeNull()
        expect(expired.state.deliveries[0]?.status).toBe('failed')
    })

    test('disable and restore pause cancel queued work; revision changes admit only fresh work', () => {
        const state = observe(createNotificationState(), 1_000)
        for (const config of [
            { ...configuration, enabled: false },
            { ...configuration, pausedAfterRestore: true },
        ]) {
            const disabled = claimNotificationDelivery(state, config, 2_000, makeId)
            expect(disabled.delivery).toBeNull()
            expect(disabled.state.deliveries[0]?.status).toBe('cancelled')
        }
        const revised = {
            ...configuration,
            channels: configuration.channels.map((channel) => ({ ...channel, revision: 2 })),
        }
        const claim = claimNotificationDelivery(state, revised, 2_000, makeId)
        expect(claim.delivery?.channelRevision).toBe(2)
        expect(claim.state.deliveries[0]?.status).toBe('cancelled')
        expect(claim.state.incidents[0]?.channels).toHaveLength(1)
    })

    test('full queues defer admission and pruning terminal history never repeats a failure', () => {
        const observations = Array.from(
            { length: NOTIFICATION_LIMITS.deliveries + 1 },
            (_, index) => ({ ...observation(1_000), resourceId: `host-${index}` }),
        )
        let state = observeNotificationSignals(
            createNotificationState(),
            configuration,
            observations,
            1_000,
            makeId,
        )
        expect(state.deliveries).toHaveLength(NOTIFICATION_LIMITS.deliveries)
        expect(state.deferredCount).toBe(1)
        expect(state.incidents.at(-1)?.channels).toHaveLength(0)
        const first = claimNotificationDelivery(state, configuration, 1_000, makeId)
        state = finishNotificationDelivery(
            first.state,
            configuration,
            first.delivery!.leaseToken,
            { success: true },
            1_001,
        )
        state = observeNotificationSignals(state, configuration, [], 1_002, makeId)
        expect(state.incidents.at(-1)?.channels).toHaveLength(1)
        expect(state.deliveries.some((delivery) => delivery.id === first.delivery!.id)).toBe(false)
        state = observeNotificationSignals(state, configuration, observations, 2_000, makeId)
        expect(state.incidents[0]?.channels[0]?.failure).toBe('succeeded')
        expect(state.deliveries).toHaveLength(NOTIFICATION_LIMITS.deliveries)
    })

    test('an admitted inflight attempt can finish after removal without creating a recovery', () => {
        const claimed = claimNotificationDelivery(
            observe(createNotificationState(), 1_000),
            configuration,
            1_000,
            makeId,
        )
        const removed = { ...configuration, channels: [] }
        let state = observeNotificationSignals(
            claimed.state,
            removed,
            [observation(2_000, 'healthy')],
            2_000,
            makeId,
        )
        state = finishNotificationDelivery(
            state,
            removed,
            claimed.delivery!.leaseToken,
            { success: true },
            3_000,
        )
        expect(state.deliveries[0]?.status).toBe('succeeded')
        expect(claimNotificationDelivery(state, configuration, 4_000, makeId).delivery).toBeNull()
    })

    test('keeps the actual receiver failure when a pending delivery expires', () => {
        const claimed = claimNotificationDelivery(
            observe(createNotificationState(), 1_000),
            configuration,
            1_000,
            makeId,
        )
        const failed = finishNotificationDelivery(
            claimed.state,
            configuration,
            claimed.delivery!.leaseToken,
            { success: false, code: 'http_rejected', retryable: true },
            1_001,
        )
        const expired = claimNotificationDelivery(
            failed,
            configuration,
            1_000 + NOTIFICATION_LIMITS.deliveryLifetimeMs,
            makeId,
        )
        expect(expired.delivery).toBeNull()
        expect(expired.state.deliveries[0]?.status).toBe('failed')
        expect(summarizeNotificationState(expired.state).deliveries[0]?.error).toBe('http_rejected')
    })

    test('security rejection is terminal even if incorrectly labelled retryable', () => {
        const claimed = claimNotificationDelivery(
            observe(createNotificationState(), 1_000),
            configuration,
            1_000,
            makeId,
        )
        const state = finishNotificationDelivery(
            claimed.state,
            configuration,
            claimed.delivery!.leaseToken,
            { success: false, code: 'destination_blocked', retryable: true },
            1_001,
        )
        expect(state.deliveries[0]?.status).toBe('failed')
    })

    test('active incidents survive saturation while removable resolved history yields space', () => {
        const observations = Array.from(
            { length: NOTIFICATION_LIMITS.incidents + 1 },
            (_, index) => ({ ...observation(1_000), resourceId: `host-${index}` }),
        )
        const disabled = { ...configuration, enabled: false }
        let state = observeNotificationSignals(
            createNotificationState(),
            disabled,
            observations,
            1_000,
            makeId,
        )
        expect(state.incidents).toHaveLength(NOTIFICATION_LIMITS.incidents)
        expect(state.deferredCount).toBe(1)
        state = observeNotificationSignals(
            state,
            disabled,
            [
                { ...observation(2_000, 'healthy'), resourceId: 'host-0' },
                { ...observation(2_000), resourceId: 'host-new' },
            ],
            2_000,
            makeId,
        )
        expect(state.incidents).toHaveLength(NOTIFICATION_LIMITS.incidents)
        expect(state.incidents.some((incident) => incident.resourceId === 'host-new')).toBe(true)
        expect(state.incidents.some((incident) => incident.resourceId === 'host-1')).toBe(true)
    })

    test('detects repeated proxy outage and recovery cycles with identical runtime evidence', () => {
        const config = {
            ...configuration,
            channels: configuration.channels.map((channel) => ({
                ...channel,
                events: ['proxy_configuration' as const],
            })),
        }
        let state = observeNotificationSignals(
            createNotificationState(),
            config,
            [proxySignal(1_000, 'failing')],
            1_000,
            makeId,
        )
        state = observeNotificationSignals(
            state,
            config,
            [proxySignal(2_000, 'failing')],
            2_000,
            makeId,
        )
        expect(state.incidents[0]?.failures).toBe(1)
        expect(state.incidents[0]?.observedAt).toBe(2_000)
        state = observeNotificationSignals(
            state,
            config,
            [proxySignal(1_500, 'healthy')],
            2_000,
            makeId,
        )
        expect(state.incidents[0]?.recoveredAt).toBeNull()
        state = observeNotificationSignals(
            state,
            config,
            [
                proxySignal(3_000, 'healthy'),
                proxySignal(4_000, 'failing'),
                proxySignal(5_000, 'healthy'),
            ],
            5_000,
            makeId,
        )
        expect(state.incidents).toHaveLength(2)
        expect(state.incidents.map((incident) => incident.recoveredAt)).toEqual([3_000, 5_000])
    })

    test('confirms a proxy apply only after durable grace, including a restart', () => {
        const config = {
            ...configuration,
            channels: configuration.channels.map((channel) => ({
                ...channel,
                events: ['proxy_configuration' as const],
            })),
        }
        let state = observeNotificationSignals(
            createNotificationState(),
            config,
            [pendingProxy(1_000)],
            1_000,
            makeId,
        )
        expect(state.incidents).toHaveLength(0)
        state = notificationStateSchema.parse(JSON.parse(JSON.stringify(state)))
        state = observeNotificationSignals(state, config, [pendingProxy(30_999)], 30_999, makeId)
        expect(state.deliveries).toHaveLength(0)
        state = observeNotificationSignals(state, config, [pendingProxy(31_000)], 31_000, makeId)
        expect(state.deliveries).toHaveLength(1)
        expect(state.incidents[0]?.startedAt).toBe(1_000)
        expect(state.incidents[0]?.observedAt).toBe(31_000)
    })

    test('restarts proxy grace for a new desired revision and clears it only after verified health', () => {
        const config = {
            ...configuration,
            channels: configuration.channels.map((channel) => ({
                ...channel,
                events: ['proxy_configuration' as const],
            })),
        }
        let state = observeNotificationSignals(
            createNotificationState(),
            config,
            [pendingProxy(1_000)],
            1_000,
            makeId,
        )
        state = observeNotificationSignals(
            state,
            config,
            [pendingProxy(30_000, 'revision-2')],
            30_000,
            makeId,
        )
        expect(state.proxyApplyPending?.since).toBe(30_000)
        state = observeNotificationSignals(state, config, [], 70_000, makeId)
        expect(state.incidents).toHaveLength(0)
        state = observeNotificationSignals(
            state,
            config,
            [proxySignal(29_000, 'healthy')],
            70_000,
            makeId,
        )
        expect(state.proxyApplyPending).not.toBeNull()
        state = observeNotificationSignals(
            state,
            config,
            [proxySignal(70_000, 'healthy')],
            70_000,
            makeId,
        )
        expect(state.proxyApplyPending).toBeNull()
        expect(state.incidents).toHaveLength(0)
    })

    test('proxy grace and channel duration thresholds share the same failure start', () => {
        const config = {
            ...configuration,
            channels: configuration.channels.map((channel) => ({
                ...channel,
                events: ['proxy_configuration' as const],
                thresholdSeconds: 60,
            })),
        }
        let state = observeNotificationSignals(
            createNotificationState(),
            config,
            [pendingProxy(1_000)],
            1_000,
            makeId,
        )
        state = observeNotificationSignals(state, config, [pendingProxy(31_000)], 31_000, makeId)
        expect(state.incidents).toHaveLength(1)
        expect(state.deliveries).toHaveLength(0)
        expect(
            claimNotificationDelivery(state, config, 61_000, makeId).delivery?.payload.startedAt,
        ).toBe(new Date(1_000).toISOString())
    })

    test('same-time repeated evidence can escalate severity without counting another attempt', () => {
        const config = {
            ...configuration,
            channels: configuration.channels.map((channel) => ({
                ...channel,
                minimumSeverity: 'critical' as const,
            })),
        }
        let state = observeNotificationSignals(
            createNotificationState(),
            config,
            [observation(1_000)],
            1_000,
            makeId,
        )
        expect(state.deliveries).toHaveLength(0)
        state = observeNotificationSignals(
            state,
            config,
            [{ ...observation(1_000), severity: 'critical' }],
            1_000,
            makeId,
        )
        expect(state.incidents[0]?.failures).toBe(1)
        expect(state.deliveries).toHaveLength(1)
    })

    test('shutdown cancellation remains retryable and survives a JSON restart', () => {
        const claimed = claimNotificationDelivery(
            observe(createNotificationState(), 1_000),
            configuration,
            1_000,
            makeId,
        )
        let state = finishNotificationDelivery(
            claimed.state,
            configuration,
            claimed.delivery!.leaseToken,
            { success: false, code: 'cancelled', retryable: true },
            1_001,
        )
        state = notificationStateSchema.parse(JSON.parse(JSON.stringify(state)))
        expect(state.deliveries[0]?.status).toBe('pending')
        const retried = claimNotificationDelivery(
            state,
            configuration,
            1_001 + NOTIFICATION_LIMITS.retryInitialMs,
            makeId,
        )
        expect(retried.delivery?.id).toBe(claimed.delivery!.id)
        expect(retried.delivery?.leaseToken).not.toBe(claimed.delivery!.leaseToken)
    })

    test('retains an acknowledged incident whose recovery is deferred by a saturated outbox', () => {
        const signals = Array.from({ length: NOTIFICATION_LIMITS.incidents }, (_, index) => ({
            ...observation(1_000),
            resourceId: `host-${index}`,
        }))
        let state = observeNotificationSignals(
            createNotificationState(),
            configuration,
            signals,
            1_000,
            makeId,
        )
        const claimed = claimNotificationDelivery(state, configuration, 1_000, makeId)
        state = finishNotificationDelivery(
            claimed.state,
            configuration,
            claimed.delivery!.leaseToken,
            { success: true },
            1_001,
        )
        state = observeNotificationSignals(state, configuration, [], 1_002, makeId)
        state = observeNotificationSignals(
            state,
            configuration,
            [{ ...observation(2_000, 'healthy'), resourceId: 'host-0' }],
            2_000,
            makeId,
        )
        expect(state.deliveries.filter((delivery) => delivery.status === 'pending')).toHaveLength(
            NOTIFICATION_LIMITS.deliveries,
        )
        state = observeNotificationSignals(
            state,
            configuration,
            [{ ...observation(3_000), resourceId: 'new-host' }],
            3_000,
            makeId,
        )
        expect(
            state.incidents.find((incident) => incident.resourceId === 'host-0')?.channels[0]
                ?.failure,
        ).toBe('succeeded')
        expect(state.incidents.some((incident) => incident.resourceId === 'new-host')).toBeFalse()
        expect(state.deferredCount).toBeGreaterThan(0)
    })

    test('keeps long-standing current failures actionable while rejecting expired journal history', () => {
        const now = NOTIFICATION_LIMITS.retentionMs + 2_000
        const config = {
            ...configuration,
            channels: configuration.channels.map((channel) =>
                Object.assign({}, channel, {
                    events: ['ddns' as const, 'certificate_renewal' as const],
                }),
            ),
        }
        const old = observation(1_000)
        expect(
            observeNotificationSignals(createNotificationState(), config, [old], now, makeId)
                .incidents,
        ).toHaveLength(0)
        const state = observeNotificationSignals(
            createNotificationState(),
            config,
            [
                { ...old, source: 'snapshot', category: 'ddns', severity: 'critical' },
                {
                    ...old,
                    source: 'snapshot',
                    category: 'certificate_renewal',
                    severity: 'critical',
                },
            ],
            now,
            makeId,
        )
        expect(state.incidents).toHaveLength(2)
        expect(state.deliveries).toHaveLength(2)
        expect(state.incidents.every((incident) => incident.startedAt === 1_000)).toBeTrue()
    })

    test('state validation rejects secrets, unbounded arrays, invalid times and duplicate open incidents', () => {
        const state = observe(createNotificationState(), 1_000)
        expect(
            notificationStateSchema.safeParse({ ...state, destination: 'private' }).success,
        ).toBe(false)
        expect(
            notificationStateSchema.safeParse({
                ...state,
                incidents: [...state.incidents, { ...state.incidents[0], id: makeId() }],
            }).success,
        ).toBe(false)
        expect(
            notificationStateSchema.safeParse({ ...state, deferredCount: Infinity }).success,
        ).toBe(false)
        expect(
            notificationStateSchema.safeParse({
                ...state,
                deliveries: Array(NOTIFICATION_LIMITS.deliveries + 1).fill(state.deliveries[0]),
            }).success,
        ).toBe(false)
    })
})
