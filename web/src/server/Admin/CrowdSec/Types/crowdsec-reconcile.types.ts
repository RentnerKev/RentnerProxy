import type { ProxyRuntimeMutationStatus } from '@/lib/ProxyRuntime/Types/proxy-runtime.types.ts'

export interface CrowdSecReconcileSnapshot {
    readonly fingerprint: string
}

export interface CrowdSecReconcileDependencies<T extends CrowdSecReconcileSnapshot> {
    readonly load: () => Promise<T>
    readonly apply: (snapshot: T) => Promise<boolean>
    readonly hasDrift: (snapshot: T) => Promise<boolean>
}

export interface Waiter {
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
