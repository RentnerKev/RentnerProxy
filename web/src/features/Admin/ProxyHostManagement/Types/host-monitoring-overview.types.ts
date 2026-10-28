import type { ProxyHostSummary } from '@/lib/Admin/ProxyHostManagement/Types/proxy-hosts.types.ts'
import type { HostAvailability } from '@/lib/HostMonitoring/Types/host-monitoring-presentation.types.ts'

export interface ProxyHostMonitoringRow {
    readonly availability: HostAvailability
    readonly checkedAt: string | null
    readonly checkedAtIso: string | null
    readonly duration: string | null
}

export interface ProxyHostMonitoringCellProps {
    readonly host: ProxyHostSummary
    readonly onMonitoring: (host: ProxyHostSummary) => void
}
