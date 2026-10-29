import type { z } from 'zod'
import type { HOST_MONITORING_OUTCOME_CODES } from '@/config/host-monitoring.config.ts'
import type {
    hostMonitoringSettingsSchema,
    saveHostMonitoringPolicySchema,
    hostMonitoringHistorySchema,
} from '../validation.ts'

export type HostMonitoringSettings = z.infer<typeof hostMonitoringSettingsSchema>
export type SaveHostMonitoringPolicy = z.infer<typeof saveHostMonitoringPolicySchema>
export type HostMonitoringHistoryQuery = z.infer<typeof hostMonitoringHistorySchema>
export type HostMonitoringState = 'unknown' | 'healthy' | 'unhealthy'
export type HostMonitoringOutcomeCode = (typeof HOST_MONITORING_OUTCOME_CODES)[number]

export interface HostMonitoringOutcome {
    readonly status: HostMonitoringState
    readonly code: HostMonitoringOutcomeCode
    readonly durationMs: number | null
    readonly httpStatus: number | null
}

export interface HostMonitoringStateSnapshot {
    readonly state: HostMonitoringState
    readonly failureCount: number
    readonly recoveryCount: number
    readonly failureStartedAt: Date | null
    readonly recoveryStartedAt: Date | null
}

export interface HostMonitoringTransition {
    readonly kind: 'outage' | 'recovery'
    readonly firstObservedAt: Date
    readonly confirmedAt: Date
    readonly code: HostMonitoringOutcomeCode
}

export interface HostMonitoringStateChange {
    readonly snapshot: HostMonitoringStateSnapshot
    readonly transition: HostMonitoringTransition | null
}

export interface HostMonitoringContext {
    readonly proof: string
    readonly revision: string
}

export interface HostMonitoringPolicyView {
    readonly id: string
    readonly proxyHostId: string
    readonly version: string
    readonly settings: HostMonitoringSettings
    readonly state: HostMonitoringState
    readonly availability:
        | HostMonitoringState
        | 'disabled'
        | 'host_disabled'
        | 'domain_removed'
        | 'not_checked'
        | 'stale'
    readonly lastCheckedAt: Date | null
    readonly lastOutcome: HostMonitoringState | null
    readonly lastCode: HostMonitoringOutcomeCode | null
    readonly lastDurationMs: number | null
    readonly lastHttpStatus: number | null
    readonly nextCheckAt: Date | null
    readonly observationPoint: 'appliance'
    readonly publicReachability: 'not_checked'
}

export interface HostMonitoringSummary {
    readonly summaries: Array<{
        readonly proxyHostId: string
        readonly policy: HostMonitoringPolicyView | null
    }>
    readonly checkedAt: Date
}
