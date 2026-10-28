import { HOST_MONITORING_LIMITS } from '@/config/host-monitoring.config.ts'
import type { HostMonitoringWorkerDependencies } from './Types/host-monitoring-worker.types.ts'

export function createHostMonitoringWorker<Claim>(
    dependencies: HostMonitoringWorkerDependencies<Claim>,
) {
    let cancelTimer: (() => void) | null = null
    let running: Promise<void> | null = null
    let controller: AbortController | null = null
    let started = false
    let stopped = false
    let unavailable = false
    let nextPruneAt = 0
    const now = dependencies.now ?? Date.now
    const setTimer =
        dependencies.schedule ??
        ((callback, delayMs) => {
            const timer = setTimeout(callback, delayMs)
            timer.unref()
            return () => clearTimeout(timer)
        })

    async function probe(signal: AbortSignal) {
        if (signal.aborted) return
        const claim = await dependencies.claim()
        if (claim === null) return
        // A shutdown can win while storage is still admitting the claim.
        if (signal.aborted) await dependencies.releaseCancelled(claim)
        else await dependencies.runClaim(claim, signal)
    }

    async function prune(signal: AbortSignal) {
        if (signal.aborted || now() < nextPruneAt) return
        // Failed pruning is retried at the sweep interval, never in a hot loop.
        nextPruneAt = now() + HOST_MONITORING_LIMITS.retentionSweepMs
        await dependencies.prune()
    }

    function schedule() {
        if (!started || stopped || cancelTimer) return
        cancelTimer = setTimer(() => {
            cancelTimer = null
            void runOnce().finally(schedule)
        }, HOST_MONITORING_LIMITS.pollIntervalMs)
    }

    function runOnce(): Promise<void> {
        if (stopped) return Promise.resolve()
        if (running) return running
        controller = new AbortController()
        const signal = controller.signal
        running = (async () => {
            const outcomes = await Promise.allSettled([
                ...Array.from({ length: HOST_MONITORING_LIMITS.workerConcurrency }, () =>
                    probe(signal),
                ),
                prune(signal),
            ])
            const failed = outcomes.some((outcome) => outcome.status === 'rejected')
            if (failed && !signal.aborted) {
                if (!unavailable) {
                    try {
                        dependencies.unavailable()
                    } catch {
                        // A failed logger must not terminate periodic monitoring.
                    }
                }
                unavailable = true
            } else if (!signal.aborted) unavailable = false
        })().finally(() => {
            running = null
            controller = null
        })
        return running
    }

    return {
        runOnce,
        start() {
            if (started) return
            started = true
            stopped = false
            void runOnce().finally(schedule)
        },
        async stop() {
            stopped = true
            started = false
            cancelTimer?.()
            cancelTimer = null
            controller?.abort()
            await running
        },
    }
}
