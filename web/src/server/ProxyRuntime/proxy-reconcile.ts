// oxlint-disable-next-line import/no-unassigned-import -- Reconcile must never execute in the browser.
import '@tanstack/react-start/server-only'

import type { ReconcileDependencies, ProxyReconciler } from './Types/proxy-reconcile.types.ts'
import { createRuntimeReconciler } from '@/server/Foundation/runtime-reconciler.server.ts'

const CONTROLLER_APPLY_TIMEOUT_MS = 20_000

export function createProxyReconciler(
    dependencies: ReconcileDependencies,
    timeoutMs = 25_000,
): ProxyReconciler {
    return createRuntimeReconciler(
        {
            enabled: dependencies.enabled !== false,
            load: dependencies.loadSnapshot,
            revision: (snapshot) => snapshot.revision,
            apply: async (snapshot) => {
                const applied = await dependencies.applySnapshot(
                    snapshot,
                    CONTROLLER_APPLY_TIMEOUT_MS,
                )
                return applied !== null && applied.activeRevision === snapshot.revision
            },
            ...(dependencies.checkDrift ? { drift: { check: dependencies.checkDrift } } : {}),
        },
        { name: 'proxy-runtime', timeoutMs, stopTimeoutMs: CONTROLLER_APPLY_TIMEOUT_MS + 5_000 },
    )
}
