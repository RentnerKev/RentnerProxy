import type { HostMonitoringObservationView } from '@/lib/HostMonitoring/Types/host-monitoring-client.types.ts'
import type { ClientTable } from '@/shared/Table/Types/client-table.types.ts'
import type { TableColumnFilterConfigs } from '@/shared/Table/Types/table.types.ts'

export interface MonitoringChecksTableProps {
    readonly observations: readonly HostMonitoringObservationView[]
    readonly more: boolean
    readonly loadingMore: boolean
    readonly onLoadMore: () => void
}

export interface MonitoringChecksTableLogicResult {
    readonly table: ClientTable<HostMonitoringObservationView>
    readonly state: {
        readonly searchInput: string
        readonly showColumnFilters: boolean
        readonly columnFilterConfigs: TableColumnFilterConfigs
    }
    readonly handler: {
        readonly handleSearchInputChange: (value: string) => void
        readonly handleResetFilters: () => void
        readonly handleToggleColumnFilters: () => void
    }
}
