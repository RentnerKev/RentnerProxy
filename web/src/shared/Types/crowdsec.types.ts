import type { CrowdSecMode } from '../../config/crowdsec.config'
import type { ProxyRuntimeMutationStatus } from './proxy-runtime.types'

export type CrowdSecHealth = 'disabled' | 'starting' | 'connected' | 'degraded'
export type CrowdSecManagedEngineState =
    | 'stopped'
    | 'starting'
    | 'ready'
    | 'restarting'
    | 'degraded'
    | 'unavailable'

export interface CrowdSecRuntimeStatus {
    readonly mode: CrowdSecMode
    readonly state: CrowdSecHealth
    readonly apiUrl?: string | undefined
    readonly credentialConfigured: boolean
    readonly enforcementActive: boolean
    readonly managedEngine: CrowdSecManagedEngineState
    readonly failureBehavior: 'fail_open'
    readonly clientIpSource: 'caddy'
}

export interface CrowdSecConfiguration {
    readonly mode: CrowdSecMode
    readonly externalApiUrl: string | null
    readonly hasApiKey: boolean
    readonly runtime: CrowdSecRuntimeStatus | null
    readonly synchronized: boolean
}

export interface CrowdSecMutationResult {
    readonly runtimeStatus: ProxyRuntimeMutationStatus
}
