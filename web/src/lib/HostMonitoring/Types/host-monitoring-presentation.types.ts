import type { HostMonitoringPolicyView } from './host-monitoring.types.ts'

export type HostAvailability = HostMonitoringPolicyView['availability'] | 'loading' | 'unavailable'
export type MonitoringPeriod = 'recent' | 'hour' | 'day' | 'week'
export interface DurationSample {
    readonly checkedAt: Date
    readonly durationMs: number | null
    readonly status: string
}
export interface DurationPlot {
    readonly paths: readonly string[]
    readonly points: readonly { readonly x: number; readonly y: number; readonly key: string }[]
    readonly maximum: number
    readonly first: Date | null
    readonly last: Date | null
}
