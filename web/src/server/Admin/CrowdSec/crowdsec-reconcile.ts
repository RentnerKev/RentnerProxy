// oxlint-disable-next-line import/no-unassigned-import -- Reconcile must never execute in the browser.
import '@tanstack/react-start/server-only'

import type {
    CrowdSecReconcileSnapshot,
    CrowdSecReconcileDependencies,
    CrowdSecReconciler,
} from './Types/crowdsec-reconcile.types.ts'
import { createRuntimeReconciler } from '@/server/Foundation/runtime-reconciler.server.ts'

export function createCrowdSecReconciler<T extends CrowdSecReconcileSnapshot>(
    dependencies: CrowdSecReconcileDependencies<T>,
    timeoutMs = 60_000,
): CrowdSecReconciler {
    return createRuntimeReconciler(
        {
            enabled: dependencies.enabled !== false,
            load: dependencies.load,
            revision: (snapshot) => snapshot.fingerprint,
            apply: dependencies.apply,
            drift: { matches: dependencies.hasDrift },
        },
        { name: 'crowdsec', timeoutMs, stopTimeoutMs: 60_000, unrefWaiters: true },
    )
}
