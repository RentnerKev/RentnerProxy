import type { HostMonitoringPolicyView } from './host-monitoring.types.ts'

export type HostAvailability = HostMonitoringPolicyView['availability'] | 'loading' | 'unavailable'
export type MonitoringPeriod = 'recent' | 'hour' | 'day' | 'week'
export interface DurationSample {
    readonly checkedAt: Date
    readonly durationMs: number | null
    readonly status: string
}
