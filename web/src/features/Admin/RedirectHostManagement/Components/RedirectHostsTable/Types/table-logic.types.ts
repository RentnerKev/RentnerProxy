import type { UseClientTableReturn } from '@/shared/Table/Types/table.types.ts'
import type { TableColumnFilterConfigs } from '@/shared/Table/Types/table.types.ts'
import type { RedirectHostSummary } from '@/shared/Types/redirect-hosts.types.ts'

export type RedirectHostsTableLogicResult = {
    readonly table: UseClientTableReturn<RedirectHostSummary>['table']
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
