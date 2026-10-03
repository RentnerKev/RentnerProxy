import type { CrowdSecMode } from '@/config/Types/crowdsec-config.types.ts'

export interface CrowdSecControllerRequest {
    readonly mode: CrowdSecMode
    readonly communityEnabled?: boolean
    readonly apiUrl?: string
    readonly apiKey?: string
}
