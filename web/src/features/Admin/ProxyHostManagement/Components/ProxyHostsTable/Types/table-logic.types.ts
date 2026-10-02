import type { UseClientTableReturn } from '@/shared/Table/Types/table.types.ts'
import type { TableColumnFilterConfigs } from '@/shared/Table/Types/table.types.ts'
import type { ProxyHostSummary } from '@/shared/Types/proxy-hosts.types.ts'

export type ProxyHostsTableLogicResult = {
    readonly table: UseClientTableReturn<ProxyHostSummary>['table']
    readonly state: {
        readonly searchInput: string
        readonly showColumnFilters: boolean
        readonly columnFilterConfigs: TableColumnFilterConfigs
    }
    readonly handler: {
        readonly handleSearchInputChange: (value: string) => void
        readonly handleResetFilters: () => void
        readonly toggleColumnFilters: () => void
    }
}
