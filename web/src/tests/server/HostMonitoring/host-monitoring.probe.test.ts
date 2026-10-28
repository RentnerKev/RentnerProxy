import { describe, expect, test } from 'bun:test'
import { createHostMonitoringProbe } from '@/server/HostMonitoring/host-monitoring.probe.ts'
import { DomainDiagnosticsError } from '@/server/RuntimeDiagnostics/domain-diagnostics.errors.ts'
import type { HostMonitoringProbeDependencies } from '@/server/HostMonitoring/Types/host-monitoring-probe.types.ts'
import type { HostMonitoringClaim } from '@/server/HostMonitoring/Types/host-monitoring.repository.types.ts'
import type { HostMonitoringOutcome } from '@/lib/HostMonitoring/Types/host-monitoring.types.ts'
import {
    domainDiagnosticsFixture,
    domainDiagnosticsInput,
    diagnosticRevision,
} from '@/tests/lib/RuntimeDiagnostics/domain-diagnostics.fixture.ts'

function fixture(): HostMonitoringClaim {
    const now = new Date('2026-10-28T10:00:00Z')
    const leaseToken = '0198d98a-0000-7000-8000-000000000003'
    return {
        leaseToken,
        policy: {
            id: '0198d98a-0000-7000-8000-000000000002',
            proxyHostId: domainDiagnosticsInput.hostId,
            domain: domainDiagnosticsInput.domain,
            enabled: true,
            version: '0198d98a-0000-7000-8000-000000000004',
            intervalSeconds: 60,
            timeoutMs: 2_000,
            expectedStatus: 200,
            failureThreshold: 3,
            recoveryThreshold: 2,
            retentionDays: 7,
            sampleLimit: 1_440,
            incidentLimit: 100,
            state: 'healthy',
            contextProof: null,
            contextRevision: null,
            failureCount: 0,
            recoveryCount: 0,
            failureStartedAt: null,
            recoveryStartedAt: null,
            nextCheckAt: now,
            lastCheckedAt: null,
            lastOutcome: null,
            lastCode: null,
            lastDurationMs: null,
            lastHttpStatus: null,
            leaseToken,
            leaseExpiresAt: new Date(now.getTime() + 45_000),
            configuredBy: null,
            createdAt: now,
            updatedAt: now,
        },
    }
}

const context = { enabled: true, proof: 'fixture-proof', revision: diagnosticRevision }

function harness(overrides: Partial<HostMonitoringProbeDependencies> = {}) {
    const outcomes: HostMonitoringOutcome[] = []
    const releases: HostMonitoringClaim[] = []
    const dependencies: HostMonitoringProbeDependencies = {
        readContext: async () => context,
        inspect: async () => domainDiagnosticsFixture(),
        complete: async (_claim, outcome) => {
            outcomes.push(outcome)
            return true
        },
        release: async (claim) => {
            releases.push(claim)
        },
        ...overrides,
    }
    return { run: createHostMonitoringProbe(dependencies), outcomes, releases }
}

describe('host monitoring probe adapter', () => {
    test('passes exact admitted selector, current revision, caller abort and only bounded upstream options', async () => {
        const claim = fixture()
        const signal = new AbortController().signal
        let inspections = 0
        const probe = harness({
            readContext: async (admitted) => {
                expect(admitted).toBe(claim)
                return context
            },
            inspect: async (input, abortSignal, options) => {
                inspections++
                expect(input).toEqual({
                    ...domainDiagnosticsInput,
                    expectedRevision: diagnosticRevision,
                })
                expect(abortSignal).toBe(signal)
                expect(options).toEqual({ upstreamOnly: true, timeoutMs: 2_000 })
                return domainDiagnosticsFixture()
            },
        })
        await probe.run(claim, signal)
        expect(inspections).toBe(1)
        expect(probe.outcomes).toEqual([
            { status: 'healthy', code: 'expected_status', durationMs: 1, httpStatus: 200 },
        ])
        expect(probe.releases).toEqual([claim])
    })

    test.each(['hostId', 'domain', 'hostType', 'revision'] as const)(
        'tampered %s response cannot record health',
        async (field) => {
            const result = domainDiagnosticsFixture()
            if (field === 'hostId') result.hostId = '0198d98a-0000-7000-8000-000000000099'
            if (field === 'domain') result.domain = 'other.example.com'
            if (field === 'hostType') {
                result.hostType = 'redirect'
                result.stages.upstream = {
                    durationMs: 1,
                    addresses: [],
                    httpStatus: null,
                    status: 'not_applicable',
                    code: 'redirect_host',
                }
                result.stages.tls = { ...result.stages.upstream }
            }
            if (field === 'revision') {
                result.expectedRevision = `sha256:${'b'.repeat(64)}`
                result.activeRevision = result.expectedRevision
            }
            const probe = harness({ inspect: async () => result })
            await probe.run(fixture(), new AbortController().signal)
            expect(probe.outcomes).toEqual([
                { status: 'unknown', code: 'invalid_response', durationMs: null, httpStatus: null },
            ])
            expect(probe.releases).toHaveLength(1)
        },
    )

    test.each(['busy', 'runtime_unavailable', 'configuration_changed'] as const)(
        'core %s remains unknown and cannot open an outage',
        async (code) => {
            const probe = harness({
                inspect: async () => {
                    throw new DomainDiagnosticsError(code)
                },
            })
            await probe.run(fixture(), new AbortController().signal)
            expect(probe.outcomes).toEqual([
                {
                    status: 'unknown',
                    code: code === 'busy' ? 'busy' : 'runtime_unavailable',
                    durationMs: null,
                    httpStatus: null,
                },
            ])
            expect(probe.releases).toHaveLength(1)
        },
    )

    test('unknown private transport errors produce only the safe runtime code', async () => {
        const probe = harness({
            inspect: async () => {
                throw new Error('private-controller-token')
            },
        })
        await probe.run(fixture(), new AbortController().signal)
        expect(probe.outcomes).toEqual([
            { status: 'unknown', code: 'runtime_unavailable', durationMs: null, httpStatus: null },
        ])
        expect(probe.releases).toHaveLength(1)
    })

    test.each(['already', 'preflight', 'probe'] as const)(
        'abort during %s always releases without completing',
        async (phase) => {
            const cancellation = new AbortController()
            let inspected = 0
            let contexts = 0
            if (phase === 'already') cancellation.abort()
            const probe = harness({
                readContext: async () => {
                    contexts++
                    if (phase === 'preflight') cancellation.abort()
                    return context
                },
                inspect: async () => {
                    inspected++
                    cancellation.abort()
                    return domainDiagnosticsFixture()
                },
            })
            const claim = fixture()
            await expect(probe.run(claim, cancellation.signal)).rejects.toMatchObject({
                code: 'aborted',
            })
            expect(probe.outcomes).toEqual([])
            expect(probe.releases).toEqual([claim])
            expect(contexts).toBe(phase === 'already' ? 0 : 1)
            expect(inspected).toBe(phase === 'probe' ? 1 : 0)
        },
    )

    test.each(['disabled', 'stale'] as const)(
        '%s preflight skips probes and releases its claim',
        async (reason) => {
            let inspected = false
            const probe = harness({
                readContext: async () =>
                    reason === 'disabled' ? { ...context, enabled: false } : null,
                inspect: async () => {
                    inspected = true
                    return domainDiagnosticsFixture()
                },
            })
            const claim = fixture()
            await probe.run(claim, new AbortController().signal)
            expect(inspected).toBeFalse()
            expect(probe.outcomes).toEqual([])
            expect(probe.releases).toEqual([claim])
        },
    )

    test.each(['preflight', 'complete'] as const)(
        '%s storage error propagates after claim cleanup',
        async (phase) => {
            const error = new Error('storage unavailable')
            let inspections = 0
            const probe = harness({
                readContext: async () => {
                    if (phase === 'preflight') throw error
                    return context
                },
                inspect: async () => {
                    inspections++
                    return domainDiagnosticsFixture()
                },
                complete: async () => {
                    throw error
                },
            })
            const claim = fixture()
            await expect(probe.run(claim, new AbortController().signal)).rejects.toBe(error)
            expect(probe.releases).toEqual([claim])
            expect(inspections).toBe(phase === 'complete' ? 1 : 0)
        },
    )

    test('configured 302 is healthy without following a redirect', async () => {
        const claim = fixture()
        claim.policy.expectedStatus = 302
        const result = domainDiagnosticsFixture()
        result.stages.upstream = {
            ...result.stages.upstream,
            status: 'unknown',
            code: 'redirect_not_followed',
            httpStatus: 302,
        }
        const probe = harness({ inspect: async () => result })
        await probe.run(claim, new AbortController().signal)
        expect(probe.outcomes).toEqual([
            { status: 'healthy', code: 'expected_status', durationMs: 1, httpStatus: 302 },
        ])
        expect(probe.releases).toEqual([claim])
    })
})
