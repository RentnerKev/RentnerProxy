import type { ClientTable } from '@/shared/Table/Types/client-table.types.ts'
import type { TrustedCaSummary } from '@/lib/Admin/TrustedCaManagement/Types/trusted-cas.types.ts'

export interface TrustedCaTableProps {
    readonly trustedCas: ReadonlyArray<TrustedCaSummary>
    readonly loading: boolean
    readonly canCreate: boolean
    readonly canUpdate: boolean
    readonly canDelete: boolean
    readonly isPending: boolean
    readonly onCreate: () => void
    readonly onReplace: (trustedCa: TrustedCaSummary) => void
    readonly onDelete: (trustedCa: TrustedCaSummary) => void
}

export interface TrustedCasTableLogicResult {
    readonly table: ClientTable<TrustedCaSummary>
    readonly state: {
        readonly searchInput: string
        readonly showColumnFilters: boolean
    }
    readonly handler: {
        readonly handleSearchInputChange: (value: string) => void
        readonly handleResetFilters: () => void
        readonly toggleColumnFilters: () => void
    }
}
