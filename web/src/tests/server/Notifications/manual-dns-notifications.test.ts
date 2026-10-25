import { expect, test } from 'bun:test'
import { NOTIFICATION_LIMITS } from '@/config/notifications.config.ts'
import {
    certificateEventObservations,
    certificateSnapshotObservations,
} from '@/server/Notifications/observations.ts'
import {
    claimNotificationDelivery,
    createNotificationState,
    finishNotificationDelivery,
    observeNotificationSignals,
} from '@/server/Notifications/incident-engine.ts'
import { notificationStateSchema } from '@/server/Notifications/notification-state.validation.ts'
import type { ControllerCertificateMetadata } from '@/server/Controller/Types/certificates.types.ts'
import type { NotificationEngineConfiguration } from '@/server/Notifications/Types/notification-state.types.ts'

const now = Date.parse('2026-10-25T12:00:00Z')
const iso = (at: number) => new Date(at).toISOString()
const id = '0198d98a-0000-7000-8000-000000000001'
const operationId = '0198d98a-0000-7000-8000-000000000002'
let sequence = 20
const makeId = () => `0198d98a-0000-7000-8000-${String(++sequence).padStart(12, '0')}`
const configuration: NotificationEngineConfiguration = {
    enabled: true,
    pausedAfterRestore: false,
    channels: [
        {
            id,
            name: 'Operator',
            kind: 'email',
            revision: 1,
            enabled: true,
            events: ['certificate_renewal'],
            minimumSeverity: 'error',
            thresholdSeconds: 0,
            recovery: true,
        },
    ],
}
function manual(): ControllerCertificateMetadata {
    return {
        id,
        source: 'acme',
        environment: 'production',
        domains: ['example.com'],
        status: 'valid',
        operation: 'renewing',
        issuedAt: iso(now - 86_400_000),
        expiresAt: iso(now + 86_400_000),
        issuer: 'Fixture',
        fingerprint: 'sha256:' + 'a'.repeat(64),
        candidate: null,
        lastErrorCode: null,
        lastActivatedAt: iso(now - 86_400_000),
        updatedAt: iso(now),
        currentOperation: {
            id: operationId,
            kind: 'renew',
            dnsMode: 'manual',
            stage: 'awaiting_dns',
            startedAt: iso(now - 60_000),
            updatedAt: iso(now),
            manualDns: {
                challengeSetId: makeId(),
                status: 'awaiting_input',
                expiresAt: iso(now + 3_600_000),
                records: [
                    {
                        identifier: 'example.com',
                        owner: '_acme-challenge.example.com',
                        value: 'b'.repeat(43),
                        expiresAt: iso(now + 3_600_000),
                    },
                ],
                lastCheckedAt: null,
                lastErrorCode: null,
            },
        },
    }
}

test('fresh manual renewal creates an action-required incident once across restart and propagation retries', () => {
    const certificate = manual()
    const observations = certificateSnapshotObservations([certificate], now)
    expect(observations).toHaveLength(1)
    expect(observations[0]?.code).toBe('certificate_renewal_manual_dns_required')
    expect(JSON.stringify(observations)).not.toContain('b'.repeat(43))
    let state = observeNotificationSignals(
        createNotificationState(),
        configuration,
        observations,
        now,
        makeId,
    )
    const claimed = claimNotificationDelivery(state, configuration, now, makeId)
    state = finishNotificationDelivery(
        claimed.state,
        configuration,
        claimed.delivery!.leaseToken,
        { success: true },
        now + 1,
    )
    state = notificationStateSchema.parse(JSON.parse(JSON.stringify(state)))
    const retry = {
        ...certificate,
        lastErrorCode: 'manual_dns_not_propagated' as const,
        lastErrorAt: iso(now + 60_000),
        currentOperation: {
            ...certificate.currentOperation!,
            updatedAt: iso(now + 60_000),
            manualDns: {
                ...certificate.currentOperation!.manualDns!,
                lastCheckedAt: iso(now + 60_000),
                lastErrorCode: 'manual_dns_not_propagated' as const,
            },
        },
    }
    const repeated = certificateSnapshotObservations([retry], now + 60_000)
    expect(repeated[0]?.evidence).toBe(observations[0]?.evidence)
    expect(repeated[0]?.occurredAt).toBe(observations[0]?.occurredAt)
    expect(
        certificateEventObservations(
            [
                {
                    id: makeId(),
                    certificateId: id,
                    operationId,
                    operationKind: 'renew',
                    kind: 'retry_scheduled',
                    stage: 'awaiting_dns',
                    occurredAt: iso(now + 60_000),
                    errorCode: 'manual_dns_not_propagated',
                },
            ],
            [retry],
            now + 60_000,
        ),
    ).toEqual([])
    state = observeNotificationSignals(state, configuration, repeated, now + 60_000, makeId)
    expect(state.deliveries).toHaveLength(1)
    expect(state.incidents[0]?.failures).toBe(1)
    expect(state.incidents[0]?.recoveredAt).toBeNull()
    expect(state.deliveries[0]?.payload.code).toBe('certificate_renewal_manual_dns_required')
    const checking = {
        ...retry,
        currentOperation: {
            ...retry.currentOperation,
            manualDns: { ...retry.currentOperation.manualDns, status: 'checking_dns' as const },
        },
    }
    expect(certificateSnapshotObservations([checking], now + 60_000)).toEqual([])
    const complete = {
        ...retry,
        operation: 'idle' as const,
        lastErrorCode: null,
        lastActivatedAt: iso(now + 120_000),
        currentOperation: {
            ...retry.currentOperation,
            stage: 'applied' as const,
            manualDns: { ...retry.currentOperation.manualDns, status: 'complete' as const },
        },
    }
    state = observeNotificationSignals(
        state,
        configuration,
        certificateSnapshotObservations([complete], now + 120_000),
        now + 120_000,
        makeId,
    )
    expect(state.incidents[0]?.recoveredAt).toBe(now + 120_000)
    expect(state.deliveries.map((delivery) => delivery.payload.code)).toEqual([
        'certificate_renewal_manual_dns_required',
        'operation_recovered',
    ])
})

test('a fresh order requires a fresh action notification without reporting false recovery for the old request', () => {
    const certificate = manual()
    let state = observeNotificationSignals(
        createNotificationState(),
        configuration,
        certificateSnapshotObservations([certificate], now),
        now,
        makeId,
    )
    const claimed = claimNotificationDelivery(state, configuration, now, makeId)
    state = finishNotificationDelivery(
        claimed.state,
        configuration,
        claimed.delivery!.leaseToken,
        { success: true },
        now + 1,
    )
    const next = {
        ...certificate,
        currentOperation: {
            ...certificate.currentOperation!,
            id: makeId(),
            startedAt: iso(now + 60_000),
        },
    }
    state = observeNotificationSignals(
        state,
        configuration,
        certificateSnapshotObservations([next], now + 60_000),
        now + 60_000,
        makeId,
    )
    expect(state.deliveries).toHaveLength(2)
    expect(
        state.deliveries.every(
            (delivery) => delivery.payload.code === 'certificate_renewal_manual_dns_required',
        ),
    ).toBeTrue()
    expect(state.incidents.filter((incident) => incident.recoveredAt === null)).toHaveLength(1)
})

test('manual action notifications retain channel opt-in, severity, restore pause and issue/renew distinctions', () => {
    const certificate = manual()
    for (const config of [
        { ...configuration, enabled: false },
        { ...configuration, pausedAfterRestore: true },
        { ...configuration, channels: [] },
        {
            ...configuration,
            channels: configuration.channels.map((channel) =>
                Object.assign({}, channel, { events: [] }),
            ),
        },
    ]) {
        const state = observeNotificationSignals(
            createNotificationState(),
            config,
            certificateSnapshotObservations([certificate], now),
            now,
            makeId,
        )
        expect(state.deliveries).toHaveLength(0)
    }
    expect(
        certificateSnapshotObservations(
            [
                {
                    ...certificate,
                    currentOperation: { ...certificate.currentOperation!, kind: 'issue' },
                    operation: 'issuing',
                },
            ],
            now,
        ),
    ).toEqual([])
})

function terminalManual(
    certificate: ControllerCertificateMetadata,
    at: number,
    status: 'expired' | 'failed',
): ControllerCertificateMetadata {
    return {
        ...certificate,
        operation: 'renewing',
        lastErrorCode: null,
        lastErrorAt: iso(at),
        currentOperation: {
            ...certificate.currentOperation!,
            stage: status === 'expired' ? 'expired' : 'failed',
            updatedAt: iso(at),
            manualDns: {
                ...certificate.currentOperation!.manualDns!,
                status,
                lastErrorCode: status === 'expired' ? 'manual_dns_expired' : 'acme_failed',
            },
        },
    }
}

test.each(['expired', 'failed'] as const)(
    'a terminal manual %s condition replaces delayed action-required admission with a real failure',
    (status) => {
        const certificate = manual()
        const delayed = {
            ...configuration,
            channels: configuration.channels.map((channel) =>
                Object.assign({}, channel, { thresholdSeconds: 600 }),
            ),
        }
        let state = observeNotificationSignals(
            createNotificationState(),
            delayed,
            certificateSnapshotObservations([certificate], now),
            now,
            makeId,
        )
        expect(state.deliveries).toHaveLength(0)
        state = notificationStateSchema.parse(JSON.parse(JSON.stringify(state)))
        const at = now + 600_001
        const terminal = terminalManual(certificate, at, status)
        const signals = certificateSnapshotObservations([terminal], at)
        expect(signals).toHaveLength(1)
        expect(signals[0]).not.toHaveProperty('code')
        state = observeNotificationSignals(state, delayed, signals, at, makeId)
        expect(state.deliveries).toHaveLength(1)
        expect(state.deliveries[0]?.payload.code).toBe('certificate_renewal_failed')
        expect(
            state.incidents.find((incident) => incident.recoveredAt === null),
        ).not.toHaveProperty('code')
        state = notificationStateSchema.parse(JSON.parse(JSON.stringify(state)))
        state = observeNotificationSignals(state, delayed, signals, at + 1, makeId)
        expect(state.deliveries).toHaveLength(1)
    },
)

test('a delivered manual request cannot suppress the subsequent terminal failure or its real activation recovery', () => {
    const certificate = manual()
    let state = observeNotificationSignals(
        createNotificationState(),
        configuration,
        certificateSnapshotObservations([certificate], now),
        now,
        makeId,
    )
    let claimed = claimNotificationDelivery(state, configuration, now, makeId)
    state = finishNotificationDelivery(
        claimed.state,
        configuration,
        claimed.delivery!.leaseToken,
        { success: true },
        now + 1,
    )
    state = notificationStateSchema.parse(JSON.parse(JSON.stringify(state)))
    const at = now + 10_000
    const terminal = terminalManual(certificate, at, 'expired')
    state = observeNotificationSignals(
        state,
        configuration,
        certificateSnapshotObservations([terminal], at),
        at,
        makeId,
    )
    expect(state.deliveries.map((delivery) => delivery.payload.code)).toEqual([
        'certificate_renewal_manual_dns_required',
        'certificate_renewal_failed',
    ])
    expect(state.deliveries.some((delivery) => delivery.payload.type === 'recovery')).toBeFalse()
    const terminalEvent = {
        id: makeId(),
        certificateId: id,
        operationId,
        operationKind: 'renew' as const,
        kind: 'failed' as const,
        stage: 'expired' as const,
        occurredAt: iso(at),
        errorCode: 'manual_dns_expired' as const,
    }
    const eventSignals = certificateEventObservations([terminalEvent], [terminal], at)
    expect(eventSignals).toHaveLength(1)
    state = observeNotificationSignals(state, configuration, eventSignals, at + 1, makeId)
    expect(state.deliveries).toHaveLength(2)
    claimed = claimNotificationDelivery(state, configuration, at + 2, makeId)
    expect(claimed.delivery?.payload.code).toBe('certificate_renewal_failed')
    state = finishNotificationDelivery(
        claimed.state,
        configuration,
        claimed.delivery!.leaseToken,
        { success: true },
        at + 3,
    )
    const complete = {
        ...certificate,
        operation: 'idle' as const,
        lastActivatedAt: iso(at + 4),
        currentOperation: {
            ...certificate.currentOperation!,
            stage: 'applied' as const,
            manualDns: { ...certificate.currentOperation!.manualDns!, status: 'complete' as const },
        },
    }
    state = observeNotificationSignals(
        state,
        configuration,
        certificateSnapshotObservations([complete], at + 4),
        at + 4,
        makeId,
    )
    expect(state.deliveries.map((delivery) => delivery.payload.code)).toEqual([
        'certificate_renewal_manual_dns_required',
        'certificate_renewal_failed',
        'operation_recovered',
    ])
    expect(state.deliveries[2]?.payload.incidentId).toBe(state.deliveries[1]?.payload.incidentId)
    expect(state.deliveries[2]?.payload.incidentId).not.toBe(
        state.deliveries[0]?.payload.incidentId,
    )
})

test('a terminal failure cancels an undelivered stale TXT request instead of delivering both conditions', () => {
    const certificate = manual()
    let state = observeNotificationSignals(
        createNotificationState(),
        configuration,
        certificateSnapshotObservations([certificate], now),
        now,
        makeId,
    )
    expect(state.deliveries[0]?.status).toBe('pending')
    const at = now + 10_000
    state = observeNotificationSignals(
        state,
        configuration,
        certificateSnapshotObservations([terminalManual(certificate, at, 'failed')], at),
        at,
        makeId,
    )
    expect(state.deliveries.map((delivery) => [delivery.payload.code, delivery.status])).toEqual([
        ['certificate_renewal_manual_dns_required', 'cancelled'],
        ['certificate_renewal_failed', 'pending'],
    ])
    const claimed = claimNotificationDelivery(state, configuration, at + 1, makeId)
    expect(claimed.delivery?.payload.code).toBe('certificate_renewal_failed')
})

test('a superseded in-flight TXT message is cancelled after lease expiry instead of being retried', () => {
    const certificate = manual()
    let state = observeNotificationSignals(
        createNotificationState(),
        configuration,
        certificateSnapshotObservations([certificate], now),
        now,
        makeId,
    )
    const claimed = claimNotificationDelivery(state, configuration, now, makeId)
    state = observeNotificationSignals(
        claimed.state,
        configuration,
        certificateSnapshotObservations([terminalManual(certificate, now + 1, 'failed')], now + 1),
        now + 1,
        makeId,
    )
    expect(state.deliveries[0]?.status).toBe('inflight')
    state = notificationStateSchema.parse(JSON.parse(JSON.stringify(state)))
    const afterExpiry = claimNotificationDelivery(
        state,
        configuration,
        now + NOTIFICATION_LIMITS.leaseMs + NOTIFICATION_LIMITS.retryMaximumMs + 10,
        makeId,
    )
    expect(afterExpiry.state.deliveries[0]?.status).toBe('cancelled')
    expect(afterExpiry.delivery?.payload.code).toBe('certificate_renewal_failed')
    expect(
        afterExpiry.state.deliveries.filter(
            (delivery) =>
                delivery.status === 'pending' &&
                delivery.payload.code === 'certificate_renewal_manual_dns_required',
        ),
    ).toHaveLength(0)
})

test.each([false, true])(
    'an admitted superseded TXT send may finish (success=%s) without retry or false recovery',
    (success) => {
        const certificate = manual()
        let state = observeNotificationSignals(
            createNotificationState(),
            configuration,
            certificateSnapshotObservations([certificate], now),
            now,
            makeId,
        )
        const claimed = claimNotificationDelivery(state, configuration, now, makeId)
        state = observeNotificationSignals(
            claimed.state,
            configuration,
            certificateSnapshotObservations(
                [terminalManual(certificate, now + 1, 'expired')],
                now + 1,
            ),
            now + 1,
            makeId,
        )
        state = notificationStateSchema.parse(JSON.parse(JSON.stringify(state)))
        state = finishNotificationDelivery(
            state,
            configuration,
            claimed.delivery!.leaseToken,
            success
                ? { success: true }
                : { success: false, code: 'destination_unavailable', retryable: true },
            now + 2,
        )
        expect(state.deliveries[0]?.status).toBe(success ? 'succeeded' : 'cancelled')
        expect(
            state.deliveries.filter((delivery) => delivery.payload.type === 'recovery'),
        ).toHaveLength(0)
        const next = claimNotificationDelivery(state, configuration, now + 3, makeId)
        expect(next.delivery?.payload.code).toBe('certificate_renewal_failed')
        expect(next.state.deliveries).toHaveLength(2)
    },
)
