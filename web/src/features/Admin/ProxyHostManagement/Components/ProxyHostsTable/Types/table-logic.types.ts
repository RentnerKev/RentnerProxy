import type { UseClientTableReturn } from '@/shared/Table/Types/table.types.ts'
import type { TableColumnFilterConfigs } from '@/shared/Table/Types/table.types.ts'
import type { ProxyHostSummary } from '@/lib/Admin/ProxyHostManagement/Types/proxy-hosts.types.ts'
import type { ProxyHostMonitoringRow } from '../../../Types/host-monitoring-overview.types.ts'
import type {
    BulkHostTableState,
    BulkHostTableHandler,
} from '@/features/Admin/HostBulkActions/Types/bulk-hosts-ui.types.ts'

export type ProxyHostsTableLogicResult = {
    readonly table: UseClientTableReturn<ProxyHostSummary>['table']
    readonly state: BulkHostTableState & {
        readonly monitoringRows: ReadonlyMap<string, ProxyHostMonitoringRow>
        readonly searchInput: string
        readonly showColumnFilters: boolean
        readonly columnFilterConfigs: TableColumnFilterConfigs
    }
    readonly handler: BulkHostTableHandler & {
        readonly handleSearchInputChange: (value: string) => void
        readonly handleResetFilters: () => void
        readonly toggleColumnFilters: () => void
    }
}
