import type { HostMonitoringObservationView } from '@/lib/HostMonitoring/Types/host-monitoring-client.types.ts'

export interface MonitoringDurationChartProps {
    readonly observations: readonly HostMonitoringObservationView[]
}
