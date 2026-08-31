// oxlint-disable no-await-in-loop -- Each apply depends on the preceding snapshot and controller acknowledgement.
// oxlint-disable-next-line import/no-unassigned-import -- Reconcile must never execute in the browser.
import '@tanstack/react-start/server-only'

import type { ProxyRuntimeMutationStatus } from '../../shared/Types/proxy-runtime.types'
import type { ProxyRuntimeApplyResponse, ProxyRuntimeSnapshot } from './Types/proxy-runtime.types'

export const PROXY_RECONCILE_TIMEOUT_MS = 25_000
const MAX_RECONCILE_ATTEMPTS = 3

interface ReconcileDependencies {
    readonly loadSnapshot: () => Promise<ProxyRuntimeSnapshot>
    readonly applySnapshot: (
        snapshot: ProxyRuntimeSnapshot,
        timeoutMs: number,
    ) => Promise<ProxyRuntimeApplyResponse | null>
}

async function withinDeadline<T>(operation: () => Promise<T>, deadline: number): Promise<T> {
    const remaining = Math.floor(deadline - performance.now())
    if (remaining <= 0) throw new Error('Proxy reconcile timed out.')
    let timeout: ReturnType<typeof setTimeout> | undefined

    try {
        return await Promise.race([
            operation(),
            new Promise<T>((_resolve, reject) => {
                timeout = setTimeout(
                    () => reject(new Error('Proxy reconcile timed out.')),
                    remaining,
                )
            }),
        ])
    } finally {
        if (timeout !== undefined) clearTimeout(timeout)
    }
}
// Coalesce concurrent requests and always read inside the serialized operation.
// A mutation arriving during a read/apply forces another read before reporting success.
// No external operation runs inside the caller's database transaction.
export function createProxyReconciler(
    dependencies: ReconcileDependencies,
    timeoutMs = PROXY_RECONCILE_TIMEOUT_MS,
) {
    let inFlight: Promise<ProxyRuntimeMutationStatus> | null = null
    let requested = 0

    async function reconcile(): Promise<ProxyRuntimeMutationStatus> {
        const deadline = performance.now() + timeoutMs

        try {
            for (let attempt = 0; attempt < MAX_RECONCILE_ATTEMPTS; attempt += 1) {
                const requestCount = requested
                const snapshot = await withinDeadline(dependencies.loadSnapshot, deadline)
                const remaining = Math.floor(deadline - performance.now())
                if (remaining <= 0) return 'pending'

                const applied = await withinDeadline(
                    () => dependencies.applySnapshot(snapshot, remaining),
                    deadline,
                )
                if (!applied || applied.activeRevision !== snapshot.revision) return 'pending'

                const latest = await withinDeadline(dependencies.loadSnapshot, deadline)
                if (requestCount === requested && latest.revision === snapshot.revision) {
                    return 'applied'
                }
            }
        } catch {
            // A database write has already committed. Never turn a reconcile failure into
            // an apparent failed save, or log driver URLs, SQL, or engine output.
            console.warn('[proxy-runtime] reconcile unavailable')
        }

        return 'pending'
    }

    return function reconcileProxyConfiguration(): Promise<ProxyRuntimeMutationStatus> {
        requested += 1
        if (inFlight) return inFlight

        inFlight = reconcile().finally(() => {
            inFlight = null
        })
        return inFlight
    }
}
