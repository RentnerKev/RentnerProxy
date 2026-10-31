import { randomUUID } from 'node:crypto'
import { NOTIFICATION_LIMITS } from '@/config/notifications.config.ts'
import { describe, expect, test } from 'bun:test'
import {
    cancelHostAvailabilityIncidents,
    observeHostAvailabilityTransition,
} from '@/server/Notifications/host-availability.ts'
import {
    claimNotificationDelivery,
    createNotificationState,
    finishNotificationDelivery,
    observeNotificationSignals,
} from '@/server/Notifications/incident-engine.ts'
import { notificationStateSchema } from '@/server/Notifications/notification-state.validation.ts'
import type {
    HostAvailabilityNotificationTransition,
    NotificationEngineConfiguration,
    NotificationState,
} from '@/server/Notifications/Types/notification-state.types.ts'

const incidentId = '00000000-0000-4000-8000-000000000289'
const configuration: NotificationEngineConfiguration = {
    enabled: true,
    pausedAfterRestore: false,
    channels: [
        {
            id: '00000000-0000-4000-8000-000000000001',
            name: 'Host incidents',
            kind: 'webhook',
            revision: 1,
            enabled: true,
            events: ['host_availability'],
            minimumSeverity: 'error',
            thresholdSeconds: 0,
            recovery: true,
        },
    ],
}
const outage: HostAvailabilityNotificationTransition = {
    kind: 'outage',
    incidentId,
    proxyHostId: '00000000-0000-4000-8000-000000000002',
    startedAt: 1_000,
    occurredAt: 3_000,
    failures: 3,
    host: {
        policyId: '00000000-0000-4000-8000-000000000003',
        policyVersion: '00000000-0000-4000-8000-000000000004',
        contextProof: 'sha256:' + 'a'.repeat(64),
        contextRevision: 'sha256:' + 'b'.repeat(64),
        domain: 'service.example.test',
        failureCode: 'upstream_timeout',
        detectedAt: new Date(3_000).toISOString(),
        recoveryStartedAt: null,
        managementPath: '/proxy-hosts',
    },
}

function recover(at: number): HostAvailabilityNotificationTransition {
    return {
        ...outage,
        kind: 'recovery',
        occurredAt: at,
        host: { ...outage.host, recoveryStartedAt: new Date(at - 1_000).toISOString() },
    }
}

function restart(state: NotificationState) {
    return notificationStateSchema.parse(JSON.parse(JSON.stringify(state)))
}

function transition(
    state: NotificationState,
    event: HostAvailabilityNotificationTransition = outage,
    config = configuration,
) {
    return observeHostAvailabilityTransition(state, config, event, event.occurredAt, randomUUID)
}

describe('host availability transitions use the durable notification outbox', () => {
    test('one confirmed incident keeps its identity and failure count across replays and restarts', () => {
        let state = transition(createNotificationState())
        for (let poll = 0; poll < 20; poll++) {
            state = transition(restart(state))
            state = observeNotificationSignals(state, configuration, [], 4_000 + poll, randomUUID)
        }
        expect(state.incidents).toHaveLength(1)
        expect(state.incidents[0]).toMatchObject({
            id: incidentId,
            startedAt: 1_000,
            observedAt: 3_000,
            failures: 3,
        })
        expect(state.deliveries).toHaveLength(1)
        expect(state.deliveries[0]?.payload).toMatchObject({
            incidentId,
            category: 'host_availability',
            code: 'host_unavailable',
            resourceId: outage.proxyHostId,
            host: {
                domain: outage.host.domain,
                failureCode: 'upstream_timeout',
                managementPath: '/proxy-hosts',
            },
        })
        expect(state.deliveries[0]?.payload.host).not.toHaveProperty('policyId')
        expect(state.deliveries[0]?.payload.host).not.toHaveProperty('contextProof')
    })

    test('an outage and recovery while the sender is offline still deliver one ordered pair', () => {
        let state = transition(createNotificationState())
        state = transition(restart(state), recover(8_000))
        expect(state.deliveries.map((delivery) => delivery.payload.type)).toEqual(['incident'])
        const failure = claimNotificationDelivery(restart(state), configuration, 9_000, randomUUID)
        expect(failure.delivery?.payload.type).toBe('incident')
        state = finishNotificationDelivery(
            failure.state,
            configuration,
            failure.delivery!.leaseToken,
            { success: true },
            9_001,
        )
        const recovered = claimNotificationDelivery(
            restart(state),
            configuration,
            9_002,
            randomUUID,
        )
        expect(recovered.delivery?.payload).toMatchObject({
            incidentId,
            type: 'recovery',
            code: 'operation_recovered',
            startedAt: new Date(1_000).toISOString(),
            occurredAt: new Date(8_000).toISOString(),
            host: { recoveryStartedAt: new Date(7_000).toISOString() },
        })
        state = finishNotificationDelivery(
            recovered.state,
            configuration,
            recovered.delivery!.leaseToken,
            { success: true },
            9_003,
        )
        state = transition(restart(state), recover(8_000))
        expect(
            claimNotificationDelivery(state, configuration, 10_000, randomUUID).delivery,
        ).toBeNull()
        expect(state.deliveries.map((delivery) => delivery.payload.type)).toEqual([
            'incident',
            'recovery',
        ])
    })

    test.each([10_000, 61_000])(
        'a threshold uses actual outage duration at recovery (%s)',
        (recoveredAt) => {
            const config = {
                ...configuration,
                channels: configuration.channels.map((channel) => ({
                    ...channel,
                    thresholdSeconds: 60,
                })),
            }
            let state = transition(createNotificationState(), outage, config)
            expect(state.deliveries).toHaveLength(0)
            state = transition(restart(state), recover(recoveredAt), config)
            const result = claimNotificationDelivery(restart(state), config, 100_000, randomUUID)
            expect(result.delivery?.payload.type ?? null).toBe(
                recoveredAt === 61_000 ? 'incident' : null,
            )
        },
    )

    test('a recovery during disabled notifications closes the incident without a later stale outage', () => {
        let state = transition(createNotificationState())
        state = transition(state, recover(8_000), { ...configuration, enabled: false })
        expect(state.incidents[0]?.recoveredAt).toBe(8_000)
        expect(state.deliveries[0]?.status).toBe('cancelled')
        expect(
            claimNotificationDelivery(restart(state), configuration, 9_000, randomUUID).delivery,
        ).toBeNull()
    })

    test('an unobserved recovery and paused restore never invent an incident', () => {
        expect(transition(createNotificationState(), recover(8_000)).incidents).toEqual([])
        expect(
            transition(createNotificationState(), outage, {
                ...configuration,
                pausedAfterRestore: true,
            }).incidents,
        ).toEqual([])
    })

    test('disabled delivery suppresses both deferred outage debt and recovery debt when resumed', () => {
        const delayed = {
            ...configuration,
            channels: configuration.channels.map((channel) =>
                Object.assign({}, channel, { thresholdSeconds: 60 }),
            ),
        }
        let state = transition(createNotificationState(), outage, delayed)
        state = transition(state, recover(61_000), { ...delayed, enabled: false })
        expect(
            claimNotificationDelivery(restart(state), delayed, 100_000, randomUUID).delivery,
        ).toBeNull()
        const initial = transition(createNotificationState())
        const claimed = claimNotificationDelivery(initial, configuration, 4_000, randomUUID)
        state = finishNotificationDelivery(
            claimed.state,
            configuration,
            claimed.delivery!.leaseToken,
            { success: true },
            4_001,
        )
        state = transition(state, recover(8_000), { ...configuration, enabled: false })
        expect(
            claimNotificationDelivery(restart(state), configuration, 9_000, randomUUID).delivery,
        ).toBeNull()
    })

    test('revoked monitoring cancels pending work silently and ignores a late acknowledgement', () => {
        const state = transition(createNotificationState())
        const claimed = claimNotificationDelivery(state, configuration, 4_000, randomUUID)
        let cancelled = cancelHostAvailabilityIncidents(claimed.state, new Set([incidentId]), 5_000)
        expect(cancelled.incidents).toEqual([])
        expect(cancelled.deliveries[0]?.status).toBe('cancelled')
        cancelled = finishNotificationDelivery(
            cancelled,
            configuration,
            claimed.delivery!.leaseToken,
            { success: true },
            5_001,
        )
        cancelled = transition(restart(cancelled), recover(8_000))
        expect(
            claimNotificationDelivery(cancelled, configuration, 9_000, randomUUID).delivery,
        ).toBeNull()
    })

    test('retries preserve the notification ID and recovery waits for a successful failure delivery', () => {
        const state = transition(transition(createNotificationState()), recover(8_000))
        const first = claimNotificationDelivery(state, configuration, 9_000, randomUUID)
        let retried = finishNotificationDelivery(
            first.state,
            configuration,
            first.delivery!.leaseToken,
            { success: false, code: 'destination_unavailable', retryable: true },
            9_001,
        )
        expect(retried.deliveries).toHaveLength(1)
        const retry = claimNotificationDelivery(restart(retried), configuration, 39_001, randomUUID)
        expect(retry.delivery?.id).toBe(first.delivery?.id)
        retried = finishNotificationDelivery(
            retry.state,
            configuration,
            retry.delivery!.leaseToken,
            { success: true },
            39_002,
        )
        expect(
            claimNotificationDelivery(restart(retried), configuration, 39_003, randomUUID).delivery
                ?.payload.type,
        ).toBe('recovery')
    })

    test('a changed channel never receives an old recovery and a disabled recovery policy is respected', () => {
        let state = transition(createNotificationState())
        const failure = claimNotificationDelivery(state, configuration, 4_000, randomUUID)
        state = finishNotificationDelivery(
            failure.state,
            configuration,
            failure.delivery!.leaseToken,
            { success: true },
            4_001,
        )
        const changed = {
            ...configuration,
            channels: configuration.channels.map((channel) => ({ ...channel, revision: 2 })),
        }
        state = transition(state, recover(8_000), changed)
        expect(claimNotificationDelivery(state, changed, 9_000, randomUUID).delivery).toBeNull()
        const noRecovery = {
            ...configuration,
            channels: configuration.channels.map((channel) =>
                Object.assign({}, channel, { recovery: false }),
            ),
        }
        state = transition(failure.state, recover(8_000), noRecovery)
        state = finishNotificationDelivery(
            state,
            noRecovery,
            failure.delivery!.leaseToken,
            { success: true },
            9_000,
        )
        expect(claimNotificationDelivery(state, noRecovery, 9_001, randomUUID).delivery).toBeNull()
    })

    test('a full outbox defers a closed host outage until capacity returns', () => {
        const config = {
            ...configuration,
            channels: configuration.channels.map((channel) =>
                Object.assign({}, channel, { thresholdSeconds: 60 }),
            ),
        }
        let state = transition(createNotificationState(), outage, config)
        const other = transition(createNotificationState())
        state.deliveries = Array.from({ length: NOTIFICATION_LIMITS.deliveries }, () => {
            const id = randomUUID()
            return {
                ...other.deliveries[0]!,
                id,
                payload: { ...other.deliveries[0]!.payload, id, incidentId: randomUUID() },
            }
        })
        state = transition(state, recover(61_000), config)
        expect(state.incidents[0]?.recoveredAt).toBe(61_000)
        expect(state.deferredCount).toBeGreaterThan(0)
        state.deliveries = []
        const next = claimNotificationDelivery(restart(state), config, 62_000, randomUUID)
        expect(next.delivery?.payload.type).toBe('incident')
        expect(next.delivery?.payload.occurredAt).toBe(outage.host.detectedAt)
        state = finishNotificationDelivery(
            next.state,
            config,
            next.delivery!.leaseToken,
            { success: true },
            62_001,
        )
        expect(
            claimNotificationDelivery(restart(state), config, 62_002, randomUUID).delivery?.payload
                .type,
        ).toBe('recovery')
    })
})
