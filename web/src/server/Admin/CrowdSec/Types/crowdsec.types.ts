import type { CrowdSecControllerRequest } from '@/server/Controller/Types/crowdsec.types.ts'

export interface ReconcileSnapshot {
    readonly fingerprint: string
    readonly request: CrowdSecControllerRequest
}
