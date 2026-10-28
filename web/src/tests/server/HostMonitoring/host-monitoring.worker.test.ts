import { describe, expect, test } from 'bun:test'
import { createHostMonitoringWorker } from '@/server/HostMonitoring/host-monitoring.worker.ts'
import type { HostMonitoringWorkerDependencies } from '@/server/HostMonitoring/Types/host-monitoring-worker.types.ts'
import { HOST_MONITORING_LIMITS } from '@/config/host-monitoring.config.ts'

function dependencies(overrides: Partial<HostMonitoringWorkerDependencies<string>> = {}) {
    return {
        claim: async () => null,
        runClaim: async () => {},
        releaseCancelled: async () => {},
        prune: async () => {},
        unavailable() {},
        ...overrides,
    } satisfies HostMonitoringWorkerDependencies<string>
}

function scheduler() {
    const pending = new Set<() => void>()
    const delays: number[] = []
    return {
        pending,
        delays,
        schedule(callback: () => void, delay: number) {
            pending.add(callback)
            delays.push(delay)
            return () => pending.delete(callback)
        },
        fire() {
            const callback = pending.values().next().value
            if (!callback) throw new Error('No scheduled tick')
            pending.delete(callback)
            callback()
        },
    }
}

describe('host monitoring worker', () => {
    test('coalesces ticks, bounds admissions and waits for abort cleanup', async () => {
        const entered = Promise.withResolvers<void>()
        const cleaned = Promise.withResolvers<void>()
        let claims = 0
        let probes = 0
        let signal: AbortSignal | undefined
        const worker = createHostMonitoringWorker(
            dependencies({
                claim: async () => {
                    claims++
                    return 'claim'
                },
                runClaim: async (_claim, abortSignal) => {
                    signal = abortSignal
                    probes++
                    entered.resolve()
                    await cleaned.promise
                },
            }),
        )
        const first = worker.runOnce()
        expect(worker.runOnce()).toBe(first)
        await entered.promise
        let stopped = false
        const stopping = worker.stop().then(() => {
            stopped = true
        })
        await Promise.resolve()
        expect(signal?.aborted).toBeTrue()
        expect(stopped).toBeFalse()
        cleaned.resolve()
        await stopping
        await first
        await worker.runOnce()
        expect(claims).toBe(HOST_MONITORING_LIMITS.workerConcurrency)
        expect(probes).toBe(1)
    })

    test('releases claims arriving after shutdown without probing or warning', async () => {
        const entered = Promise.withResolvers<void>()
        const admitted = Promise.withResolvers<string>()
        let released = 0
        let probes = 0
        let warnings = 0
        const worker = createHostMonitoringWorker(
            dependencies({
                claim: async () => {
                    entered.resolve()
                    return admitted.promise
                },
                releaseCancelled: async (claim) => {
                    expect(claim).toBe('late')
                    released++
                },
                runClaim: async () => {
                    probes++
                },
                unavailable: () => {
                    warnings++
                },
            }),
        )
        const running = worker.runOnce()
        await entered.promise
        const stopping = worker.stop()
        admitted.resolve('late')
        await stopping
        await running
        expect({ released, probes, warnings }).toEqual({ released: 1, probes: 0, warnings: 0 })
    })

    test('sweeps retention independently of empty claims and throttles failed sweeps', async () => {
        let clock = 100
        let sweeps = 0
        let claims = 0
        const worker = createHostMonitoringWorker(
            dependencies({
                now: () => clock,
                claim: async () => {
                    claims++
                    return null
                },
                prune: async () => {
                    sweeps++
                    throw new Error('private connection URI')
                },
            }),
        )
        await worker.runOnce()
        clock += HOST_MONITORING_LIMITS.retentionSweepMs - 1
        await worker.runOnce()
        expect(sweeps).toBe(1)
        clock++
        await worker.runOnce()
        await worker.stop()
        expect(sweeps).toBe(2)
        expect(claims).toBe(3)
    })

    test('reschedules after errors, deduplicates warnings and restarts after stop', async () => {
        const timer = scheduler()
        let claims = 0
        let broken = true
        let warnings = 0
        const worker = createHostMonitoringWorker(
            dependencies({
                schedule: timer.schedule,
                claim: async () => {
                    claims++
                    if (broken) throw new Error('secret')
                    return null
                },
                unavailable: () => {
                    warnings++
                },
            }),
        )
        worker.start()
        await worker.runOnce()
        expect(timer.pending.size).toBe(1)
        timer.fire()
        await worker.runOnce()
        expect(warnings).toBe(1)
        broken = false
        timer.fire()
        await worker.runOnce()
        broken = true
        timer.fire()
        await worker.runOnce()
        expect(warnings).toBe(2)
        await worker.stop()
        expect(timer.pending.size).toBe(0)
        worker.start()
        await worker.runOnce()
        await worker.stop()
        expect(claims).toBe(5)
        expect(
            timer.delays.every((delay) => delay === HOST_MONITORING_LIMITS.pollIntervalMs),
        ).toBeTrue()
    })

    test('schedules one completion-relative tick after a slow probe with no catch-up', async () => {
        const timer = scheduler()
        const entered = Promise.withResolvers<void>()
        const done = Promise.withResolvers<void>()
        const worker = createHostMonitoringWorker(
            dependencies({
                schedule: timer.schedule,
                claim: async () => 'slow',
                runClaim: async () => {
                    entered.resolve()
                    await done.promise
                },
            }),
        )
        worker.start()
        worker.start()
        await entered.promise
        expect(timer.pending.size).toBe(0)
        done.resolve()
        await worker.runOnce()
        expect(timer.pending.size).toBe(1)
        expect(timer.delays).toEqual([1_000])
        await worker.stop()
    })

    test('abort rejections do not report an outage and cleanup remains adapter-owned', async () => {
        const entered = Promise.withResolvers<void>()
        let cleaned = false
        let warnings = 0
        const worker = createHostMonitoringWorker(
            dependencies({
                claim: async () => 'claim',
                runClaim: async (_claim, signal) => {
                    entered.resolve()
                    await new Promise<void>((resolve) =>
                        signal.addEventListener('abort', () => resolve(), { once: true }),
                    )
                    cleaned = true
                    throw new DOMException('Cancelled', 'AbortError')
                },
                unavailable: () => {
                    warnings++
                },
            }),
        )
        const running = worker.runOnce()
        await entered.promise
        await worker.stop()
        await running
        expect(cleaned).toBeTrue()
        expect(warnings).toBe(0)
    })
})
