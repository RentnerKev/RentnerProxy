import { describe, expect, test } from 'bun:test'
import { createNotificationCollector } from '@/server/Notifications/collector.ts'
import {
    certificateEventObservations,
    certificateSnapshotObservations,
    ddnsObservations,
    proxyConfigurationObservation,
} from '@/server/Notifications/observations.ts'
import type { ControllerCertificateMetadata } from '@/server/Controller/Types/certificates.types.ts'
import type {
    CertificateEventMetadata,
    CertificateEventPage,
} from '@/lib/Admin/CertificateManagement/Types/certificates.types.ts'
import type { NotificationCollectorDependencies } from '@/server/Notifications/Types/collector.types.ts'
import { ddnsSnapshotSchema } from '@/lib/Ddns/validation.ts'

const ID = '0197a000-0000-7000-8000-000000000001'
const OPERATION_ID = '0197a000-0000-7000-8000-000000000002'
const EVENT_ID = '0197a000-0000-7000-8000-000000000003'
const STORE_ID = '0197a000-0000-7000-8000-000000000004'
const NOW = Date.parse('2026-10-18T12:00:00Z')
const iso = (milliseconds: number) => new Date(milliseconds).toISOString()

function certificate(
    overrides: Partial<ControllerCertificateMetadata> = {},
): ControllerCertificateMetadata {
    return {
        id: ID,
        source: 'acme',
        environment: 'production',
        domains: ['secret.example'],
        status: 'valid',
        operation: 'renewing',
        currentOperation: {
            id: OPERATION_ID,
            kind: 'renew',
            stage: 'retry_scheduled',
            startedAt: iso(NOW - 10_000),
            updatedAt: iso(NOW - 2_000),
        },
        issuedAt: '2026-01-01T00:00:00Z',
        expiresAt: '2027-01-01T00:00:00Z',
        issuer: 'Private issuer',
        fingerprint: 'sha256:' + 'a'.repeat(64),
        candidate: null,
        lastErrorCode: 'acme_failed',
        updatedAt: iso(NOW - 2_000),
        lastErrorAt: iso(NOW - 2_000),
        lastAttemptAt: iso(NOW - 2_000),
        lastActivatedAt: iso(NOW - 100_000),
        attemptCount: 3,
        ...overrides,
    }
}

function event(overrides: Partial<CertificateEventMetadata> = {}): CertificateEventMetadata {
    return {
        id: EVENT_ID,
        operationId: OPERATION_ID,
        operationKind: 'renew',
        certificateId: ID,
        kind: 'retry_scheduled',
        stage: 'retry_scheduled',
        occurredAt: iso(NOW - 2_000),
        errorCode: 'acme_failed',
        ...overrides,
    }
}

function ddns() {
    return ddnsSnapshotSchema.parse({
        version: 1,
        configuration: {
            revision: 2,
            updatedByUserId: ID,
            settings: {
                enabled: true,
                intervalSeconds: 300,
                updateOnStart: true,
                ipv4: true,
                ipv6: false,
                targets: [
                    {
                        id: ID,
                        connectionId: OPERATION_ID,
                        zoneId: 'a'.repeat(32),
                        name: 'secret.example',
                        recordType: 'A',
                        proxied: false,
                        enabled: true,
                        selection: { mode: 'inspect' },
                    },
                ],
            },
        },
        targets: [
            {
                targetId: ID,
                lastAttemptAt: NOW / 1_000 - 2,
                lastSuccessAt: NOW / 1_000 - 100,
                lastSuccessfulAddress: '192.0.2.2',
                lastSuccessfulProxied: false,
                lastResult: {
                    targetId: ID,
                    status: 'failed',
                    current: null,
                    desiredAddress: '192.0.2.2',
                    error: 'connection_unavailable',
                    retryAfterSeconds: null,
                },
                consecutiveFailures: 2,
                permanentFailure: false,
                connectionRevision: 1,
                nextAttemptAt: null,
                retryNotBefore: null,
            },
        ],
        inFlight: null,
        lastRun: null,
        providerNotBefore: null,
        providerPauseReason: null,
        manualNotBefore: null,
        restorePaused: false,
        events: [],
        eventSequence: 4,
    })
}

function page(
    sequence = 1,
    events: readonly CertificateEventMetadata[] = [],
    hasMore = false,
): CertificateEventPage {
    return { events, nextCursor: `${STORE_ID}:${sequence}`, hasMore, resetRequired: false }
}

function dependencies(
    overrides: Partial<NotificationCollectorDependencies> = {},
): NotificationCollectorDependencies {
    return {
        certificates: async () => [certificate()],
        certificateEvents: async () => page(),
        ddns: async () => ddns(),
        proxySnapshot: async () => ({ revision: 'sha256:' + 'a'.repeat(64) }),
        proxyStatus: async () => ({
            available: true,
            running: true,
            activeRevision: 'sha256:' + 'a'.repeat(64),
            lastApplyAt: iso(NOW - 50_000),
        }),
        now: () => NOW,
        ...overrides,
    }
}

describe('notification source adapters', () => {
    test('only renewal errors count; legacy events require a matching current renewal operation', () => {
        expect(certificateEventObservations([event()], [certificate()], NOW)).toHaveLength(1)
        for (const operationKind of ['issue', 'import'] as const)
            expect(
                certificateEventObservations([event({ operationKind })], [certificate()], NOW),
            ).toEqual([])
        const { operationKind: _kind, ...legacy } = event()
        expect(certificateEventObservations([legacy], [certificate()], NOW)).toHaveLength(1)
        expect(
            certificateEventObservations([{ ...legacy, operationId: ID }], [certificate()], NOW),
        ).toEqual([])
        expect(
            certificateEventObservations([event({ errorCode: null })], [certificate()], NOW),
        ).toEqual([])
    })
    test('journal and metadata evidence agree so repeated polls do not double count failures', () => {
        const journal = certificateEventObservations([event()], [certificate()], NOW)[0]!
        const snapshot = certificateSnapshotObservations([certificate()], NOW)[0]!
        expect(journal.evidence).toBe(snapshot.evidence)
        expect(journal.failures).toBe(3)
    })
    test('valid active certificates with renewal failures do not produce false recovery', () => {
        expect(
            certificateSnapshotObservations([certificate()], NOW).map((item) => item.health),
        ).toEqual(['failing'])
        expect(
            certificateSnapshotObservations(
                [certificate({ operation: 'idle', lastErrorAt: undefined })],
                NOW,
            ).some((item) => item.health === 'healthy'),
        ).toBe(false)
        const active = certificate({
            operation: 'idle',
            lastActivatedAt: iso(NOW - 1_000),
            lastErrorCode: null,
        })
        const success = event({
            kind: 'renewed',
            stage: 'applied',
            occurredAt: iso(NOW - 1_000),
            errorCode: null,
        })
        expect(certificateEventObservations([success], [active], NOW)[0]?.health).toBe('healthy')
        expect(certificateSnapshotObservations([active], NOW)[0]?.occurredAt).toBe(iso(NOW - 1_000))
        const candidate = {
            fingerprint: 'sha256:' + 'b'.repeat(64),
            issuedAt: iso(NOW),
            expiresAt: '2027-01-01T00:00:00Z',
            lastErrorCode: null,
            nextAttemptAt: null,
        }
        expect(certificateEventObservations([success], [{ ...active, candidate }], NOW)).toEqual([])
        expect(certificateSnapshotObservations([{ ...active, candidate }], NOW)).toEqual([])
    })
    test('DDNS seconds become ISO dates and evidence excludes domains, addresses and errors', () => {
        const result = ddnsObservations(ddns(), NOW)
        expect(result[0]?.occurredAt).toBe(iso(NOW - 2_000))
        expect(result[0]?.health).toBe('failing')
        expect(result[0]?.failures).toBe(2)
        expect(JSON.stringify(result)).not.toContain('secret.example')
        expect(JSON.stringify(result)).not.toContain('192.0.2.2')
        expect(JSON.stringify(result)).not.toContain('connection_unavailable')
        const snapshot = ddns()
        snapshot.targets[0]!.permanentFailure = true
        expect(ddnsObservations(snapshot, NOW)[0]?.severity).toBe('critical')
    })
    test('disabled, restored and unknown DDNS states never recover; real success does', () => {
        const snapshot = ddns()
        snapshot.configuration!.settings.enabled = false
        expect(ddnsObservations(snapshot, NOW)).toEqual([])
        snapshot.configuration!.settings.enabled = true
        snapshot.configuration!.settings.targets[0]!.enabled = false
        expect(ddnsObservations(snapshot, NOW)).toEqual([])
        snapshot.configuration!.settings.targets[0]!.enabled = true
        snapshot.restorePaused = true
        expect(ddnsObservations(snapshot, NOW)).toEqual([])
        snapshot.restorePaused = false
        const target = snapshot.targets[0]!
        target.consecutiveFailures = 0
        target.lastResult!.status = 'skipped'
        expect(ddnsObservations(snapshot, NOW)).toEqual([])
        target.lastResult!.status = 'updated'
        expect(ddnsObservations(snapshot, NOW)).toEqual([])
        target.lastSuccessAt = target.lastAttemptAt
        expect(ddnsObservations(snapshot, NOW)[0]?.health).toBe('healthy')
    })
    test('another DDNS target and the global sequence do not refresh unchanged target evidence', () => {
        const snapshot = ddns()
        snapshot.configuration!.settings.targets.push({
            ...snapshot.configuration!.settings.targets[0]!,
            id: EVENT_ID,
            name: 'other.secret.example',
        })
        const other = structuredClone(snapshot.targets[0]!)
        other.targetId = EVENT_ID
        other.lastResult!.targetId = EVENT_ID
        snapshot.targets.push(other)
        const before = ddnsObservations(snapshot, NOW)
        snapshot.eventSequence++
        const sequenceOnly = ddnsObservations(snapshot, NOW)
        expect(sequenceOnly[0]?.evidence).toBe(before[0]?.evidence)
        other.lastAttemptAt!++
        other.consecutiveFailures++
        const after = ddnsObservations(snapshot, NOW)
        expect(after[0]?.evidence).toBe(before[0]?.evidence)
        expect(after[1]?.evidence).not.toBe(before[1]?.evidence)
        // A fresh attempt in the same second still has its own failure counter.
        snapshot.targets[0]!.consecutiveFailures++
        expect(ddnsObservations(snapshot, NOW)[0]?.evidence).not.toBe(before[0]?.evidence)
    })
    test('proxy recovery requires a stable desired revision and a fresh verified runtime match', () => {
        const runtime = {
            available: true,
            running: true,
            activeRevision: 'desired',
            lastApplyAt: iso(NOW - 100_000),
        }
        expect(proxyConfigurationObservation('desired', runtime, 'changed', NOW)).toEqual([])
        expect(proxyConfigurationObservation('desired', runtime, 'desired', NOW)[0]).toMatchObject({
            health: 'healthy',
            occurredAt: iso(NOW),
            resourceId: 'instance',
        })
        expect(
            proxyConfigurationObservation(
                'desired',
                { ...runtime, running: false },
                'desired',
                NOW,
            )[0]?.health,
        ).toBe('failing')
        expect(proxyConfigurationObservation('desired', null, 'desired', NOW)[0]?.health).toBe(
            'failing',
        )
    })
})

describe('notification collector', () => {
    test('independent sources begin while certificate reads are pending; proxy probes bracket desired snapshots', async () => {
        let release!: (value: readonly ControllerCertificateMetadata[]) => void
        const pending = new Promise<readonly ControllerCertificateMetadata[]>((resolve) => {
            release = resolve
        })
        const order: string[] = []
        const collect = createNotificationCollector(
            dependencies({
                certificates: () => pending,
                ddns: async () => {
                    order.push('ddns')
                    return ddns()
                },
                proxySnapshot: async () => {
                    order.push('snapshot')
                    return { revision: 'same' }
                },
                proxyStatus: async () => {
                    order.push('probe')
                    return {
                        available: true,
                        running: true,
                        activeRevision: 'same',
                        lastApplyAt: null,
                    }
                },
            }),
        )
        const result = collect(null)
        expect(order).toEqual(['ddns', 'snapshot'])
        release([certificate()])
        await result
        expect(order).toEqual(['ddns', 'snapshot', 'probe', 'snapshot'])
    })
    test('runs sources independently, emits chronological observations and bounds certificate pagination', async () => {
        let pages = 0
        const result = await createNotificationCollector(
            dependencies({
                certificateEvents: async () => {
                    pages++
                    return page(pages, pages === 1 ? [event()] : [], true)
                },
            }),
        )(null)
        expect(pages).toBe(5)
        expect(result.certificateCursor).toBe(`${STORE_ID}:5`)
        expect(result.observations.map((item) => item.category)).toContain('ddns')
        expect(result.observations.map((item) => item.occurredAt)).toEqual(
            result.observations.map((item) => item.occurredAt).toSorted(),
        )
    })
    test('one source failure preserves other sources and never advances an invalid certificate cursor', async () => {
        let pages = 0
        const cursor = `${STORE_ID}:0`
        const result = await createNotificationCollector(
            dependencies({
                certificateEvents: async () => {
                    pages++
                    if (pages === 2) throw new Error('private detail')
                    return page(1, [event()], true)
                },
            }),
        )(cursor)
        expect(result.certificateCursor).toBe(cursor)
        expect(result.observations.some((item) => item.category === 'certificate_renewal')).toBe(
            false,
        )
        expect(result.observations.map((item) => item.category)).toContain('ddns')
        expect(result.observations.map((item) => item.category)).toContain('proxy_configuration')
        expect(JSON.stringify(result)).not.toContain('private detail')
    })
    test('cancellation prevents subsequent source calls and discards the collection', async () => {
        const controller = new AbortController()
        let subsequentCalls = 0
        const collect = createNotificationCollector(
            dependencies({
                certificates: async () => {
                    controller.abort()
                    return []
                },
                certificateEvents: async () => {
                    subsequentCalls++
                    return page()
                },
                proxySnapshot: async () => {
                    subsequentCalls++
                    return { revision: 'revision' }
                },
                ddns: async () => {
                    subsequentCalls++
                    return ddns()
                },
            }),
        )
        await expect(collect(null, controller.signal)).rejects.toThrow()
        expect(subsequentCalls).toBe(0)
    })
})
