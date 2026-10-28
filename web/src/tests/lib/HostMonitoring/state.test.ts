import { describe, expect, test } from 'bun:test'
import * as fc from 'fast-check'
import {
    advanceHostMonitoringState,
    classifyHostMonitoringOutcome,
} from '@/lib/HostMonitoring/state.ts'
import type {
    HostMonitoringOutcome,
    HostMonitoringStateSnapshot,
} from '@/lib/HostMonitoring/Types/host-monitoring.types.ts'

const initial: HostMonitoringStateSnapshot = {
    state: 'unknown',
    failureCount: 0,
    recoveryCount: 0,
    failureStartedAt: null,
    recoveryStartedAt: null,
}
const settings = { failureThreshold: 3, recoveryThreshold: 2 }
const healthy: HostMonitoringOutcome = {
    status: 'healthy',
    code: 'expected_status',
    durationMs: 12,
    httpStatus: 200,
}
const unhealthy: HostMonitoringOutcome = {
    status: 'unhealthy',
    code: 'upstream_timeout',
    durationMs: 100,
    httpStatus: null,
}
const unknown: HostMonitoringOutcome = {
    status: 'unknown',
    code: 'runtime_unavailable',
    durationMs: null,
    httpStatus: null,
}
const stage = (status: string, code: string, httpStatus: number | null = null) => ({
    status,
    code,
    durationMs: 12,
    addresses: [],
    httpStatus,
})

function diagnostic(http: number) {
    const revision = `sha256:${'a'.repeat(64)}`
    const upstream =
        http >= 200 && http < 300
            ? stage('passed', 'upstream_responded', http)
            : http >= 300 && http < 400
              ? stage('unknown', 'redirect_not_followed', http)
              : stage('unknown', 'unexpected_status', http)
    return {
        hostType: 'proxy',
        hostId: '00000000-0000-4000-8000-000000000001',
        domain: 'example.test',
        expectedRevision: revision,
        activeRevision: revision,
        checkedAt: '2026-10-28T12:00:00.000Z',
        observationPoint: 'appliance',
        publicReachability: 'not_checked',
        stages: {
            configuration: stage('passed', 'configuration_active'),
            dns: stage('unknown', 'skipped'),
            upstream,
            tls: stage('not_applicable', 'http_upstream'),
        },
    }
}

describe('host monitoring classification', () => {
    test.each([200, 302, 404])(
        'requires the exact configured HTTP status including %s',
        (status) => {
            expect(classifyHostMonitoringOutcome(diagnostic(status), status).status).toBe('healthy')
            expect(
                classifyHostMonitoringOutcome(diagnostic(status), status === 200 ? 201 : 200)
                    .status,
            ).toBe('unhealthy')
        },
    )

    test.each(['upstream_unreachable', 'upstream_timeout', 'upstream_dns_failed'])(
        'records %s as unhealthy',
        (code) => {
            const raw = diagnostic(200)
            raw.stages.upstream = stage('failed', code)
            expect(classifyHostMonitoringOutcome(raw, 200)).toEqual({
                status: 'unhealthy',
                code,
                durationMs: 12,
                httpStatus: null,
            })
        },
    )

    test('distinguishes TLS failure, stale configuration and malformed responses', () => {
        const tls = diagnostic(200)
        tls.stages.tls = stage('failed', 'tls_failed')
        expect(classifyHostMonitoringOutcome(tls, 200).code).toBe('tls_failed')
        const stale = diagnostic(200)
        stale.stages = {
            configuration: stage('unknown', 'configuration_stale'),
            dns: stage('unknown', 'skipped'),
            upstream: stage('unknown', 'skipped'),
            tls: stage('unknown', 'skipped'),
        }
        expect(classifyHostMonitoringOutcome(stale, 200).status).toBe('unknown')
        expect(
            classifyHostMonitoringOutcome({ ...diagnostic(200), private: 'rejected' }, 200).code,
        ).toBe('invalid_response')
        expect(classifyHostMonitoringOutcome(diagnostic(200), 600).status).toBe('unknown')
    })
})

describe('host monitoring state transitions', () => {
    test('confirms first healthy immediately and records separate evidence and outage confirmation times', () => {
        expect(
            advanceHostMonitoringState(initial, healthy, settings, new Date(0)).snapshot.state,
        ).toBe('healthy')
        const first = advanceHostMonitoringState(initial, unhealthy, settings, new Date(100))
        const second = advanceHostMonitoringState(
            first.snapshot,
            unhealthy,
            settings,
            new Date(200),
        )
        expect(second.transition).toBeNull()
        const confirmed = advanceHostMonitoringState(
            second.snapshot,
            unhealthy,
            settings,
            new Date(300),
        )
        expect(confirmed.transition).toEqual({
            kind: 'outage',
            code: 'upstream_timeout',
            firstObservedAt: new Date(100),
            confirmedAt: new Date(300),
        })
        const recovery = advanceHostMonitoringState(
            confirmed.snapshot,
            healthy,
            settings,
            new Date(400),
        )
        expect(recovery.snapshot.state).toBe('unhealthy')
        expect(
            advanceHostMonitoringState(recovery.snapshot, healthy, settings, new Date(500))
                .transition,
        ).toEqual({
            kind: 'recovery',
            code: 'expected_status',
            firstObservedAt: new Date(400),
            confirmedAt: new Date(500),
        })
    })

    test('unknown breaks either streak while preserving confirmed unhealthy state and its open incident', () => {
        let snapshot = advanceHostMonitoringState(
            initial,
            unhealthy,
            { ...settings, failureThreshold: 1 },
            new Date(0),
        ).snapshot
        snapshot = advanceHostMonitoringState(snapshot, healthy, settings, new Date(100)).snapshot
        const interrupted = advanceHostMonitoringState(snapshot, unknown, settings, new Date(200))
        expect(interrupted).toEqual({
            snapshot: { ...initial, state: 'unhealthy' },
            transition: null,
        })
        expect(
            advanceHostMonitoringState(interrupted.snapshot, healthy, settings, new Date(300))
                .transition,
        ).toBeNull()
        const failed = advanceHostMonitoringState(initial, unhealthy, settings, new Date(400))
        const reset = advanceHostMonitoringState(failed.snapshot, unknown, settings, new Date(500))
        expect(reset.snapshot).toEqual(initial)
    })

    test('does not duplicate incidents for sustained failures and resets opposing streaks', () => {
        const down = { ...initial, state: 'unhealthy' as const }
        expect(
            advanceHostMonitoringState(down, unhealthy, settings, new Date()).transition,
        ).toBeNull()
        const failing = advanceHostMonitoringState(initial, unhealthy, settings, new Date())
        expect(
            advanceHostMonitoringState(failing.snapshot, healthy, settings, new Date()).snapshot,
        ).toEqual({ ...initial, state: 'healthy' })
    })

    test('arbitrary outcome sequences preserve bounded streaks and valid incident ordering', () => {
        fc.assert(
            fc.property(
                fc.array(fc.constantFrom(healthy, unhealthy, unknown), { maxLength: 100 }),
                (outcomes) => {
                    let snapshot = initial
                    let open = false
                    for (const [index, outcome] of outcomes.entries()) {
                        const change = advanceHostMonitoringState(
                            snapshot,
                            outcome,
                            settings,
                            new Date(index),
                        )
                        expect(change.snapshot.failureCount).toBeLessThan(settings.failureThreshold)
                        expect(change.snapshot.recoveryCount).toBeLessThan(
                            settings.recoveryThreshold,
                        )
                        expect(change.snapshot.failureCount * change.snapshot.recoveryCount).toBe(0)
                        if (change.transition) {
                            expect(change.transition.firstObservedAt.getTime()).toBeLessThanOrEqual(
                                change.transition.confirmedAt.getTime(),
                            )
                            expect(change.transition.kind).toBe(open ? 'recovery' : 'outage')
                            open = !open
                        }
                        if (outcome.status === 'unknown')
                            expect(change.snapshot.state).toBe(snapshot.state)
                        snapshot = change.snapshot
                        expect(snapshot.state === 'unhealthy').toBe(open)
                    }
                },
            ),
            { numRuns: 100 },
        )
    })
})
