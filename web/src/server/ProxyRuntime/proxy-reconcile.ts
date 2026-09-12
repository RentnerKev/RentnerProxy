// oxlint-disable-next-line import/no-unassigned-import -- Reconcile must never execute in the browser.
import '@tanstack/react-start/server-only'
// oxlint-disable no-await-in-loop -- Reconcile attempts are deliberately serialized.

import type { ProxyRuntimeMutationStatus } from '../../shared/Types/proxy-runtime.types'
import type { ProxyRuntimeApplyResponse, ProxyRuntimeSnapshot } from './Types/proxy-runtime.types'

export const PROXY_RECONCILE_TIMEOUT_MS = 25_000
const CONTROLLER_APPLY_TIMEOUT_MS = 20_000
const DRIFT_CHECK_INTERVAL_MS = 60_000
const INITIAL_RETRY_DELAY_MS = 1_000
const MAX_RETRY_DELAY_MS = 60_000

interface ReconcileDependencies {
    readonly loadSnapshot: () => Promise<ProxyRuntimeSnapshot>
    readonly checkDrift?: () => Promise<boolean>
    readonly applySnapshot: (
        snapshot: ProxyRuntimeSnapshot,
        timeoutMs: number,
    ) => Promise<ProxyRuntimeApplyResponse | null>
}

interface ReconcileWaiter {
    readonly target: number
    readonly resolve: (status: ProxyRuntimeMutationStatus) => void
    readonly timer: ReturnType<typeof setTimeout>
}

export interface ProxyReconciler {
    (): Promise<ProxyRuntimeMutationStatus>
    readonly start: () => void
    readonly stop: () => Promise<void>
    readonly checkDrift: () => Promise<void>
}

export function createProxyReconciler(
    dependencies: ReconcileDependencies,
    timeoutMs = PROXY_RECONCILE_TIMEOUT_MS,
): ProxyReconciler {
    let requested = 0
    let completed = 0
    let worker: Promise<void> | null = null
    let stopped = false
    let driftTimer: ReturnType<typeof setInterval> | null = null
    let wakeResolver: (() => void) | null = null
    let publicFlight: Promise<ProxyRuntimeMutationStatus> | null = null
    const waiters = new Set<ReconcileWaiter>()

    function wake(): void {
        const resolve = wakeResolver
        wakeResolver = null
        resolve?.()
    }

    async function waitForWakeOrDelay(ms: number): Promise<void> {
        let timer: ReturnType<typeof setTimeout> | undefined
        let wakeResolve: (() => void) | null = null
        const wakePromise = new Promise<void>((resolve) => {
            wakeResolve = resolve
            wakeResolver = resolve
        })
        const timerPromise = new Promise<void>((resolve) => {
            timer = setTimeout(resolve, ms)
            timer.unref?.()
        })
        await Promise.race([timerPromise, wakePromise])
        if (timer !== undefined) clearTimeout(timer)
        if (wakeResolver === wakeResolve) wakeResolver = null
    }

    function resolveCompleted(): void {
        for (const waiter of waiters) {
            if (waiter.target > completed) continue
            clearTimeout(waiter.timer)
            waiters.delete(waiter)
            waiter.resolve('applied')
        }
    }

    function resolvePending(): void {
        for (const waiter of waiters) {
            clearTimeout(waiter.timer)
            waiters.delete(waiter)
            waiter.resolve('pending')
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
                const snapshot = await dependencies.loadSnapshot()
                if (stopped) break
                const applied = await dependencies.applySnapshot(
                    snapshot,
                    CONTROLLER_APPLY_TIMEOUT_MS,
                )
                if (stopped) break
                if (!applied || applied.activeRevision !== snapshot.revision) {
                    throw new Error('Controller did not acknowledge the desired revision.')
                }
                const latest = await dependencies.loadSnapshot()
                if (stopped) break
                if (target !== requested || latest.revision !== snapshot.revision) continue
                completed = target
                retryDelay = INITIAL_RETRY_DELAY_MS
                resolveCompleted()
            } catch {
                if (stopped) break

                resolvePending()

                console.warn('[proxy-runtime] reconcile unavailable')
                await waitForWakeOrDelay(retryDelay)
                if (stopped) break
                retryDelay = Math.min(retryDelay * 2, MAX_RETRY_DELAY_MS)
            }
        }
    }

    function ensureWorker(): void {
        if (worker || stopped) return
        worker = runWorker().finally(() => {
            worker = null
        })
    }

    function enqueue(): void {
        requested += 1
        ensureWorker()
        wake()
    }

    function reconcile(): Promise<ProxyRuntimeMutationStatus> {
        if (stopped) return Promise.resolve('pending')
        enqueue()
        if (publicFlight) return publicFlight
        const target = requested
        publicFlight = new Promise<ProxyRuntimeMutationStatus>((resolve) => {
            const waiter: ReconcileWaiter = {
                target,
                resolve,
                timer: setTimeout(() => {
                    waiters.delete(waiter)
                    resolve('pending')
                }, timeoutMs),
            }
            waiters.add(waiter)
            resolveCompleted()
        }).finally(() => {
            publicFlight = null
        })
        return publicFlight
    }

    function start(): void {
        if (stopped) return
        enqueue()
        if (driftTimer === null) {
            driftTimer = setInterval(() => void checkDrift(), DRIFT_CHECK_INTERVAL_MS)
            driftTimer.unref?.()
        }
    }

    async function checkDrift(): Promise<void> {
        if (!dependencies.checkDrift || stopped) return
        try {
            if ((await dependencies.checkDrift()) && !stopped) enqueue()
        } catch {
            console.warn('[proxy-runtime] drift check unavailable')
        }
    }

    async function stop(): Promise<void> {
        stopped = true
        if (driftTimer !== null) clearInterval(driftTimer)
        driftTimer = null
        for (const waiter of waiters) {
            clearTimeout(waiter.timer)
            waiter.resolve('pending')
        }
        waiters.clear()
        wake()
        if (worker) {
            let timer: ReturnType<typeof setTimeout> | undefined
            await Promise.race([
                worker,
                new Promise<void>((resolve) => {
                    timer = setTimeout(resolve, CONTROLLER_APPLY_TIMEOUT_MS + 5_000)
                    timer.unref?.()
                }),
            ])
            if (timer !== undefined) clearTimeout(timer)
        }
    }

    return Object.assign(reconcile, { checkDrift, start, stop })
}
