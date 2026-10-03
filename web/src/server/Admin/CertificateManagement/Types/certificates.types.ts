import type { certificates } from '@/db/schema.ts'

import type { ProxyRuntimeMutationStatus } from '@/lib/ProxyRuntime/Types/proxy-runtime.types.ts'

export type CertificateRow = typeof certificates.$inferSelect

export interface DeleteCertificateResult {
    readonly deleted: boolean
    readonly detachedHostCount: number
    readonly runtimeStatus: ProxyRuntimeMutationStatus
}

export interface CertificateDeletionRuntime {
    readonly reconcile: (actorId: string) => Promise<ProxyRuntimeMutationStatus>
}
