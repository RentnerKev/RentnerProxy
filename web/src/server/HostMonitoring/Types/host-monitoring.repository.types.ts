import type { hostCheckIncidents, hostCheckObservations, hostCheckPolicies } from '@/db/schema.ts'
import type { HostMonitoringSettings } from '@/lib/HostMonitoring/Types/host-monitoring.types.ts'
import type { AuthTransaction } from '@/server/Auth/Core/Types/database.types.ts'

export type HostMonitoringPolicy = typeof hostCheckPolicies.$inferSelect
export type HostMonitoringObservation = typeof hostCheckObservations.$inferSelect
export type HostMonitoringIncident = typeof hostCheckIncidents.$inferSelect

export interface HostMonitoringClaim {
    readonly policy: HostMonitoringPolicy
    readonly leaseToken: string
}

export interface SaveHostMonitoringPolicyInput {
    readonly proxyHostId: string
    readonly settings: HostMonitoringSettings
    readonly configuredBy: string
    readonly existing: HostMonitoringPolicy | null
}

export interface HostMonitoringHistoryOptions {
    readonly before?: { readonly checkedAt: Date; readonly id: string }
    readonly status?: HostMonitoringObservation['status'] | 'all'
    readonly since?: Date
    readonly limit: number
}

export interface HostMonitoringHistory {
    readonly observations: HostMonitoringObservation[]
    readonly incidents: HostMonitoringIncident[]
    readonly hasMore: boolean
}

export type HostMonitoringContextMatches = (
    transaction: AuthTransaction,
    policy: HostMonitoringPolicy,
) => Promise<boolean>
