import type { ProxyRuntimeSnapshot, ProxyRuntimeApplyResponse } from './proxy-runtime.types.ts'

import type { ProxyRuntimeMutationStatus } from '@/lib/ProxyRuntime/Types/proxy-runtime.types.ts'

export interface ReconcileDependencies {
    readonly loadSnapshot: () => Promise<ProxyRuntimeSnapshot>
    readonly checkDrift?: () => Promise<boolean>
    readonly applySnapshot: (
        snapshot: ProxyRuntimeSnapshot,
        timeoutMs: number,
    ) => Promise<ProxyRuntimeApplyResponse | null>
}

export interface ReconcileWaiter {
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
