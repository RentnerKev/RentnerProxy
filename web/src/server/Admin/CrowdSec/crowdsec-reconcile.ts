// oxlint-disable-next-line import/no-unassigned-import -- Reconcile must never execute in the browser.
import '@tanstack/react-start/server-only'
// oxlint-disable no-await-in-loop -- Reconcile attempts are deliberately serialized.

import type { ProxyRuntimeMutationStatus } from '../../../shared/Types/proxy-runtime.types'

export const CROWDSEC_RECONCILE_TIMEOUT_MS = 60_000
const INITIAL_RETRY_DELAY_MS = 1_000
const MAX_RETRY_DELAY_MS = 60_000
const DRIFT_CHECK_INTERVAL_MS = 60_000
const STOP_WAIT_TIMEOUT_MS = 60_000

interface CrowdSecReconcileSnapshot {
    readonly fingerprint: string
}

interface CrowdSecReconcileDependencies<T extends CrowdSecReconcileSnapshot> {
    readonly load: () => Promise<T>
    readonly apply: (snapshot: T) => Promise<boolean>
    readonly hasDrift: (snapshot: T) => Promise<boolean>
}

interface Waiter {
    readonly target: number
    readonly resolve: (status: ProxyRuntimeMutationStatus) => void
    readonly timer: ReturnType<typeof setTimeout>
}

export interface CrowdSecReconciler {
    (): Promise<ProxyRuntimeMutationStatus>
    readonly start: () => void
    readonly stop: () => Promise<void>
    readonly checkDrift: () => Promise<void>
}

export function createCrowdSecReconciler<T extends CrowdSecReconcileSnapshot>(
    dependencies: CrowdSecReconcileDependencies<T>,
    timeoutMs = CROWDSEC_RECONCILE_TIMEOUT_MS,
): CrowdSecReconciler {
    let requested = 0
    let completed = 0
    let worker: Promise<void> | null = null
    let stopped = false
    let driftTimer: ReturnType<typeof setInterval> | null = null
    let wakeResolver: (() => void) | null = null
    let publicFlight: Promise<ProxyRuntimeMutationStatus> | null = null
    const waiters = new Set<Waiter>()

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
                const snapshot = await dependencies.load()
                if (stopped) break
                if (!(await dependencies.apply(snapshot))) throw new Error('apply_failed')
                const latest = await dependencies.load()
                if (stopped || target !== requested || latest.fingerprint !== snapshot.fingerprint)
                    continue
                completed = target
                retryDelay = INITIAL_RETRY_DELAY_MS
                resolveCompleted()
            } catch {
                if (stopped) break
                resolvePending()
                console.warn('[crowdsec] reconcile unavailable')
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
        if (stopped) return Promise.resolve('pending')
        enqueue()
        if (publicFlight) return publicFlight
        const target = requested
        publicFlight = new Promise<ProxyRuntimeMutationStatus>((resolve) => {
            const waiter: Waiter = {
                target,
                resolve,
                timer: setTimeout(() => {
                    waiters.delete(waiter)
                    resolve('pending')
                }, timeoutMs),
            }
            waiter.timer.unref?.()
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
        if (stopped) return
        try {
            const snapshot = await dependencies.load()
            if (!stopped && (await dependencies.hasDrift(snapshot))) enqueue()
        } catch {
            console.warn('[crowdsec] drift check unavailable')
        }
    }

    async function stop(): Promise<void> {
        stopped = true
        if (driftTimer !== null) clearInterval(driftTimer)
        driftTimer = null
        resolvePending()
        wake()
        if (worker) {
            let timer: ReturnType<typeof setTimeout> | undefined
            await Promise.race([
                worker,
                new Promise<void>((resolve) => {
                    timer = setTimeout(resolve, STOP_WAIT_TIMEOUT_MS)
                    timer.unref?.()
                }),
            ])
            if (timer !== undefined) clearTimeout(timer)
        }
    }

    return Object.assign(reconcile, { checkDrift, start, stop })
}
