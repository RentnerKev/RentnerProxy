import type { LiveStatus } from '@/lib/Live/Types/realtime-events-client.types.ts'

export interface ApplicationLiveSnapshot {
    readonly revision: string
    readonly userVersion: string
}

export interface ApplicationLiveSyncResult {
    readonly status: LiveStatus
    readonly isIdentityPending: boolean
    readonly hasIdentityError: boolean
    readonly retryIdentity: () => void
}
