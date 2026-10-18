import { describe, expect, test } from 'bun:test'
import { NOTIFICATION_LIMITS } from '@/config/notifications.config.ts'
import { claimNotificationTestDelivery } from '@/server/Notifications/notification-test.ts'
import {
    claimNotificationDelivery,
    createNotificationState,
    finishNotificationDelivery,
    observeNotificationSignals,
} from '@/server/Notifications/incident-engine.ts'
import { notificationStateSchema } from '@/server/Notifications/notification-state.validation.ts'
import type { NotificationEngineConfiguration } from '@/server/Notifications/Types/notification-state.types.ts'

const channelId = '00000000-0000-4000-8000-000000000001'
const configuration: NotificationEngineConfiguration = {
    enabled: true,
    pausedAfterRestore: false,
    channels: [
        {
            id: channelId,
            name: 'Personal',
            kind: 'email',
            revision: 1,
            enabled: true,
            events: ['ddns'],
            minimumSeverity: 'error',
            thresholdSeconds: 0,
            recovery: true,
        },
    ],
}
const makeId = () => crypto.randomUUID()

describe('explicit notification probes', () => {
    test('creates an isolated durable single-attempt lease, without an incident', () => {
        const initial = createNotificationState()
        const claimed = claimNotificationTestDelivery(
            initial,
            configuration,
            channelId,
            1_000,
            makeId,
        )
        expect(initial.deliveries).toHaveLength(0)
        expect(claimed.state.incidents).toHaveLength(0)
        expect(claimed.delivery.payload).toMatchObject({
            type: 'test',
            code: 'notification_test',
            resourceId: 'test',
            failures: 0,
        })
        const restored = notificationStateSchema.parse(JSON.parse(JSON.stringify(claimed.state)))
        expect(restored.deliveries[0]).toMatchObject({ status: 'inflight', attempts: 1 })
        expect(
            claimNotificationDelivery(restored, configuration, 1_001, makeId).delivery,
        ).toBeNull()
    })

    test('does not retry a failed probe even if the transport marks it retryable', () => {
        const claimed = claimNotificationTestDelivery(
            createNotificationState(),
            configuration,
            channelId,
            1_000,
            makeId,
        )
        const state = finishNotificationDelivery(
            claimed.state,
            configuration,
            claimed.delivery.leaseToken,
            { success: false, code: 'smtp_unavailable', retryable: true },
            1_001,
        )
        expect(state.deliveries[0]).toMatchObject({
            status: 'failed',
            error: 'smtp_unavailable',
            attempts: 1,
        })
        expect(claimNotificationDelivery(state, configuration, 100_000, makeId).delivery).toBeNull()
        expect(state.incidents).toHaveLength(0)
    })

    test('expires a lost manual lease without sending it after restart', () => {
        const claimed = claimNotificationTestDelivery(
            createNotificationState(),
            configuration,
            channelId,
            1_000,
            makeId,
        )
        const result = claimNotificationDelivery(
            claimed.state,
            configuration,
            1_000 + NOTIFICATION_LIMITS.leaseMs,
            makeId,
        )
        expect(result.delivery).toBeNull()
        expect(result.state.deliveries[0]).toMatchObject({
            status: 'failed',
            error: 'timeout',
            attempts: 1,
        })
    })

    test('requires an enabled channel and explicit restore reactivation', () => {
        for (const config of [
            { ...configuration, enabled: false },
            { ...configuration, enabled: false, pausedAfterRestore: true },
            {
                ...configuration,
                channels: configuration.channels.map((channel) => ({ ...channel, enabled: false })),
            },
            { ...configuration, channels: [] },
        ])
            expect(() =>
                claimNotificationTestDelivery(
                    createNotificationState(),
                    config,
                    channelId,
                    1_000,
                    makeId,
                ),
            ).toThrow()
    })

    test('does not evict active deliveries when the outbox is saturated', () => {
        const state = createNotificationState()
        for (let index = 0; index < NOTIFICATION_LIMITS.deliveries; index++) {
            const probe = claimNotificationTestDelivery(
                state,
                configuration,
                channelId,
                1_000,
                makeId,
            )
            state.deliveries = probe.state.deliveries
        }
        expect(() =>
            claimNotificationTestDelivery(state, configuration, channelId, 1_001, makeId),
        ).toThrow()
        expect(state.deliveries).toHaveLength(NOTIFICATION_LIMITS.deliveries)
        expect(notificationStateSchema.safeParse(state).success).toBe(true)
    })

    test('revoking a category cancels queued alerts and prevents a retry or recovery', () => {
        const state = observeNotificationSignals(
            createNotificationState(),
            configuration,
            [
                {
                    source: 'event',
                    category: 'ddns',
                    resourceId: 'host',
                    health: 'failing',
                    severity: 'error',
                    occurredAt: new Date(1_000).toISOString(),
                    evidence: 'outage',
                    failures: 1,
                },
            ],
            1_000,
            makeId,
        )
        const revoked: NotificationEngineConfiguration = {
            ...configuration,
            channels: configuration.channels.map((channel) => ({
                ...channel,
                events: ['certificate_renewal'],
            })),
        }
        const cancelled = claimNotificationDelivery(state, revoked, 1_001, makeId)
        expect(cancelled.delivery).toBeNull()
        expect(cancelled.state.deliveries[0]?.status).toBe('cancelled')
        const inflight = claimNotificationDelivery(state, configuration, 1_001, makeId)
        const finished = finishNotificationDelivery(
            inflight.state,
            revoked,
            inflight.delivery!.leaseToken,
            { success: false, code: 'timeout', retryable: true },
            1_002,
        )
        expect(finished.deliveries[0]?.status).toBe('failed')
        const delivered = finishNotificationDelivery(
            inflight.state,
            configuration,
            inflight.delivery!.leaseToken,
            { success: true },
            1_002,
        )
        const recovered = observeNotificationSignals(
            delivered,
            revoked,
            [
                {
                    source: 'event',
                    category: 'ddns',
                    resourceId: 'host',
                    health: 'healthy',
                    severity: 'error',
                    occurredAt: new Date(2_000).toISOString(),
                    evidence: 'healthy',
                    failures: 0,
                },
            ],
            2_000,
            makeId,
        )
        expect(recovered.deliveries).toHaveLength(1)
    })
})
