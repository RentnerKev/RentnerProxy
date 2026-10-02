import type { UseClientTableReturn } from '@/shared/Table/Types/table.types.ts'
import type { TableColumnFilterConfigs } from '@/shared/Table/Types/table.types.ts'
import type { AccessPolicySummary } from '@/shared/Types/access-policies.types.ts'

export type AccessPoliciesTableLogicResult = {
    readonly table: UseClientTableReturn<AccessPolicySummary>['table']
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
