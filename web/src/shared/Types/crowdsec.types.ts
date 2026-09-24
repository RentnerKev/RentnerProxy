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
export type CrowdSecCommunityState = 'disabled' | 'starting' | 'connected' | 'degraded'
export type CrowdSecConsoleState = 'not_enrolled' | 'pending' | 'connected' | 'degraded'

export interface CrowdSecRuntimeStatus {
    readonly mode: CrowdSecMode
    readonly state: CrowdSecHealth
    readonly apiUrl?: string | undefined
    readonly credentialConfigured: boolean
    readonly enforcementActive: boolean
    readonly managedEngine: CrowdSecManagedEngineState
    readonly communityEnabled: boolean
    readonly communityState: CrowdSecCommunityState
    readonly consoleState: CrowdSecConsoleState
    readonly failureBehavior: 'fail_open'
    readonly clientIpSource: 'caddy'
}

export interface CrowdSecConfiguration {
    readonly mode: CrowdSecMode
    readonly communityEnabled: boolean
    readonly externalApiUrl: string | null
    readonly hasApiKey: boolean
    readonly runtime: CrowdSecRuntimeStatus | null
    readonly synchronized: boolean
}

export interface CrowdSecMutationResult {
    readonly runtimeStatus: ProxyRuntimeMutationStatus
}

export interface CrowdSecOriginCount {
    readonly origin: string
    readonly count: number
}

export interface CrowdSecDashboardQuery {
    readonly offset: number
    readonly limit: number
    readonly search: string
    readonly origin: string
    readonly scope: '' | 'Ip' | 'Range'
}

export interface CrowdSecDecision {
    readonly id: number
    readonly scope: 'Ip' | 'Range'
    readonly value: string
    readonly origin: string
    readonly scenario: string
    readonly duration: string
    readonly countryCode: string | null
}

export interface CrowdSecDashboard {
    readonly demo?: boolean
    readonly collectedAt: number
    readonly metrics: {
        readonly blockedRequests: number | null
        readonly activeDecisions: number | null
        readonly blockedByOrigin: readonly CrowdSecOriginCount[]
        readonly decisionsByOrigin: readonly CrowdSecOriginCount[]
    } | null
    readonly decisions: {
        readonly total: number
        readonly filteredTotal: number
        readonly offset: number
        readonly limit: number
        readonly availableOrigins: readonly string[]
        readonly entries: readonly CrowdSecDecision[]
    } | null
}
