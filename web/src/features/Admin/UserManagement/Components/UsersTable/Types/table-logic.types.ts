import type { UseClientTableReturn } from '@/shared/Table/Types/table.types.ts'
import type { TableColumnFilterConfigs } from '@/shared/Table/Types/table.types.ts'
import type { UserSummary } from '@/shared/Types/auth.types.ts'

export type UsersTableLogicResult = {
    readonly table: UseClientTableReturn<UserSummary>['table']
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
