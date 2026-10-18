import '@tanstack/react-start/server-only'
// oxlint-disable no-await-in-loop -- Runtime revisions must be applied serially.

import type { ProxyRuntimeMutationStatus } from '@/lib/ProxyRuntime/Types/proxy-runtime.types.ts'
import type {
    RuntimeReconcileDependencies,
    RuntimeReconcileOptions,
    RuntimeReconcileWaiter,
    RuntimeReconciler,
} from './Types/runtime-reconciler.types.ts'

const INITIAL_RETRY_DELAY_MS = 1_000
const MAX_RETRY_DELAY_MS = 60_000
const DRIFT_CHECK_INTERVAL_MS = 60_000

export function createRuntimeReconciler<T>(
    dependencies: RuntimeReconcileDependencies<T>,
    options: RuntimeReconcileOptions,
): RuntimeReconciler {
    let requested = 0
    let completed = 0
    let worker: Promise<void> | null = null
    let stopped = false
    let driftTimer: ReturnType<typeof setInterval> | null = null
    let wakeResolver: (() => void) | null = null
    let publicFlight: Promise<ProxyRuntimeMutationStatus> | null = null
    const waiters = new Set<RuntimeReconcileWaiter>()

    function wake(): void {
        const resolve = wakeResolver
        wakeResolver = null
        resolve?.()
    }

    async function waitForWakeOrDelay(delayMs: number): Promise<void> {
        let timer: ReturnType<typeof setTimeout> | undefined
        let localWake: (() => void) | null = null
        const wakePromise = new Promise<void>((resolve) => {
            localWake = resolve
            wakeResolver = resolve
        })
        const delayPromise = new Promise<void>((resolve) => {
            timer = setTimeout(resolve, delayMs)
            timer.unref?.()
        })
        await Promise.race([wakePromise, delayPromise])
        if (timer !== undefined) clearTimeout(timer)
        if (wakeResolver === localWake) wakeResolver = null
    }

    function resolveWaiters(status: ProxyRuntimeMutationStatus): void {
        for (const waiter of waiters) {
            if (status === 'applied' && waiter.target > completed) continue
            clearTimeout(waiter.timer)
            waiters.delete(waiter)
            waiter.resolve(status)
        }
    }

    async function runWorker(): Promise<void> {
        let retryDelay = INITIAL_RETRY_DELAY_MS
        // oxlint-disable-next-line no-unmodified-loop-condition -- stop() changes this lifecycle flag.
        while (!stopped) {
            if (completed >= requested) {
                await new Promise<void>((resolve) => {
                    wakeResolver = resolve
                })
                continue
            }
            const target = requested
            try {
                const snapshot = await dependencies.load()
                if (stopped) break
                const applied = await dependencies.apply(snapshot)
                if (stopped) break
                if (!applied) throw new Error('apply_failed')
                const latest = await dependencies.load()
                if (stopped) break
                if (
                    target !== requested ||
                    dependencies.revision(latest) !== dependencies.revision(snapshot)
                )
                    continue
                completed = target
                retryDelay = INITIAL_RETRY_DELAY_MS
                resolveWaiters('applied')
            } catch {
                if (stopped) break
                resolveWaiters('pending')
                console.warn(`[${options.name}] reconcile unavailable`)
                await waitForWakeOrDelay(retryDelay)
                retryDelay = Math.min(retryDelay * 2, MAX_RETRY_DELAY_MS)
            }
        }
    }

    function enqueue(): void {
        requested += 1
        if (!worker && !stopped) {
            worker = runWorker().finally(() => {
                worker = null
            })
        }
        wake()
    }

    function reconcile(): Promise<ProxyRuntimeMutationStatus> {
        if (stopped || dependencies.enabled === false) return Promise.resolve('pending')
        enqueue()
        if (publicFlight) return publicFlight
        const target = requested
        publicFlight = new Promise<ProxyRuntimeMutationStatus>((resolve) => {
            const waiter: RuntimeReconcileWaiter = {
                target,
                resolve,
                timer: setTimeout(() => {
                    waiters.delete(waiter)
                    resolve('pending')
                }, options.timeoutMs),
            }
            if (options.unrefWaiters) waiter.timer.unref?.()
            waiters.add(waiter)
            resolveWaiters('applied')
        }).finally(() => {
            publicFlight = null
        })
        return publicFlight
    }

    function start(): void {
        if (stopped || dependencies.enabled === false) return
        enqueue()
        if (driftTimer === null) {
            driftTimer = setInterval(() => void checkDrift(), DRIFT_CHECK_INTERVAL_MS)
            driftTimer.unref?.()
        }
    }

    async function checkDrift(): Promise<void> {
        const drift = dependencies.drift
        if (!drift || stopped || dependencies.enabled === false) return
        try {
            let hasDrift: boolean
            if ('check' in drift) {
                hasDrift = await drift.check()
            } else {
                const snapshot = await dependencies.load()
                if (stopped) return
                hasDrift = await drift.matches(snapshot)
            }
            if (!stopped && hasDrift) enqueue()
        } catch {
            console.warn(`[${options.name}] drift check unavailable`)
        }
    }

    async function stop(): Promise<void> {
        stopped = true
        if (driftTimer !== null) clearInterval(driftTimer)
        driftTimer = null
        resolveWaiters('pending')
        wake()
        if (worker) {
            let timer: ReturnType<typeof setTimeout> | undefined
            await Promise.race([
                worker,
                new Promise<void>((resolve) => {
                    timer = setTimeout(resolve, options.stopTimeoutMs)
                    timer.unref?.()
                }),
            ])
            if (timer !== undefined) clearTimeout(timer)
        }
    }

    return Object.assign(reconcile, { checkDrift, start, stop })
}
