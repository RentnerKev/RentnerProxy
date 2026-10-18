import type { RuntimeReconciler } from '@/server/Foundation/Types/runtime-reconciler.types.ts'

export interface CrowdSecReconcileSnapshot {
    readonly fingerprint: string
}

export interface CrowdSecReconcileDependencies<T extends CrowdSecReconcileSnapshot> {
    readonly enabled?: boolean
    readonly load: () => Promise<T>
    readonly apply: (snapshot: T) => Promise<boolean>
    readonly hasDrift: (snapshot: T) => Promise<boolean>
}

export type CrowdSecReconciler = RuntimeReconciler
