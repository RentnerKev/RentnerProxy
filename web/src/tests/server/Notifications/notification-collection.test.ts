import { describe, expect, test } from 'bun:test'
import {
    commitNotificationCollectedBatch,
    leaseNotificationCollection,
} from '@/server/Notifications/notification-collection.ts'
import { createNotificationState } from '@/server/Notifications/incident-engine.ts'
import type {
    NotificationRuntime,
    StoredNotificationConfiguration,
} from '@/server/Notifications/Types/notification-internal.types.ts'

const tokenA = '00000000-0000-4000-8000-000000000001'
const tokenB = '00000000-0000-4000-8000-000000000002'
const config: StoredNotificationConfiguration = {
    version: 1,
    revision: 1,
    enabled: true,
    pausedAfterRestore: false,
    channels: [
        {
            id: tokenA,
            name: 'Office',
            kind: 'email',
            revision: 1,
            enabled: true,
            events: ['ddns'],
            minimumSeverity: 'warning',
            thresholdSeconds: 60,
            recovery: true,
            destination: { ciphertext: 'encrypted', iv: 'encrypted' },
            hasAuthorization: false,
        },
    ],
}
const initial = (): NotificationRuntime => ({
    version: 1,
    engine: createNotificationState(),
    certificateCursor: null,
    collectionLease: null,
})
const batch = {
    observations: [
        {
            category: 'ddns' as const,
            resourceId: tokenB,
            health: 'failing' as const,
            severity: 'error' as const,
            occurredAt: new Date(1_000).toISOString(),
            evidence: 'attempt-1',
            failures: 1,
        },
    ],
    certificateCursor: 'next-cursor',
}

describe('notification collection fencing', () => {
    test('serializes polls across workers and commits cursor with source observations', () => {
        const first = leaseNotificationCollection(initial(), config, 1_000, tokenA)!
        expect(leaseNotificationCollection(first.runtime, config, 2_000, tokenB)).toBeNull()
        const committed = commitNotificationCollectedBatch(
            first.runtime,
            config,
            first.claim,
            batch,
            2_000,
            () => tokenB,
        )
        expect(committed.changed).toBeTrue()
        expect(committed.runtime.certificateCursor).toBe('next-cursor')
        expect(committed.runtime.engine.incidents).toHaveLength(1)
        expect(committed.runtime.collectionLease).toBeNull()
    })

    test('discards stale polls after restart lease reclamation', () => {
        const first = leaseNotificationCollection(initial(), config, 1_000, tokenA)!
        const restarted = JSON.parse(JSON.stringify(first.runtime)) as NotificationRuntime
        const second = leaseNotificationCollection(restarted, config, 100_000, tokenB)!
        const late = commitNotificationCollectedBatch(
            second.runtime,
            config,
            first.claim,
            batch,
            100_001,
            () => tokenA,
        )
        expect(late.runtime).toBe(second.runtime)
        expect(late.runtime.collectionLease?.token).toBe(tokenB)
        expect(late.runtime.engine.incidents).toHaveLength(0)
    })

    test('rejects expired or reconfigured polls without advancing the cursor', () => {
        const first = leaseNotificationCollection(initial(), config, 1_000, tokenA)!
        for (const [configuration, at] of [
            [config, 100_000],
            [{ ...config, revision: 2 }, 2_000],
            [{ ...config, enabled: false }, 2_000],
        ] as const) {
            const result = commitNotificationCollectedBatch(
                first.runtime,
                configuration,
                first.claim,
                batch,
                at,
                () => tokenB,
            )
            expect(result.changed).toBeFalse()
            expect(result.runtime.certificateCursor).toBeNull()
            expect(result.runtime.engine.incidents).toHaveLength(0)
            expect(result.runtime.collectionLease).toBeNull()
        }
        expect(
            leaseNotificationCollection(initial(), { ...config, enabled: false }, 1_000, tokenA),
        ).toBeNull()
        expect(
            leaseNotificationCollection(
                initial(),
                { ...config, enabled: false, pausedAfterRestore: true },
                1_000,
                tokenA,
            ),
        ).toBeNull()
    })
})
