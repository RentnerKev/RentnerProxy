import type { HostMonitoringOutcomeCode, HostMonitoringState } from './host-monitoring.types.ts'

export type HostMonitoringClientErrorCode =
    | 'authentication_required'
    | 'permission_denied'
    | 'host_not_found'
    | 'conflict'
    | 'invalid_input'
    | 'rate_limited'
    | 'limit_reached'
    | 'service_unavailable'
    | 'invalid_response'
    | 'aborted'

export interface HostMonitoringObservationView {
    readonly id: string
    readonly policyId: string
    readonly policyVersion: string
    readonly checkedAt: Date
    readonly status: HostMonitoringState
    readonly code: HostMonitoringOutcomeCode
    readonly durationMs: number | null
    readonly httpStatus: number | null
}

export interface HostMonitoringIncidentView {
    readonly id: string
    readonly policyId: string
    readonly startedAt: Date
    readonly detectedAt: Date
    readonly recoveryStartedAt: Date | null
    readonly recoveredAt: Date | null
    readonly failureCode: HostMonitoringOutcomeCode
    readonly recoveryCode: HostMonitoringOutcomeCode | null
    readonly closedReason: 'recovered' | 'policy_changed' | 'monitoring_disabled' | null
    readonly closedAt: Date | null
}

export interface HostMonitoringHistoryView {
    readonly observations: HostMonitoringObservationView[]
    readonly incidents: HostMonitoringIncidentView[]
    readonly nextCursor: { readonly checkedAt: string; readonly id: string } | null
}
