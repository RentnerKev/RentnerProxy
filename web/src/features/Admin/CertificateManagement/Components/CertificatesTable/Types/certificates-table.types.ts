import type { ClientTable } from '@/shared/Table/clientTable.ts'
import type { TableColumnFilterConfigs } from '@/shared/Table/Types/table.types.ts'
import type { CertificateSummary } from '@/shared/Types/certificates.types.ts'

export interface CertificateTableProps {
    readonly certificates: ReadonlyArray<CertificateSummary>
    readonly loading: boolean
    readonly canCreate: boolean
    readonly canIssue: boolean
    readonly canRenew: boolean
    readonly canUpdate: boolean
    readonly canDelete: boolean
    readonly isPending: boolean
    readonly onCreate: () => void
    readonly onRequest: () => void
    readonly onDetails: (certificate: CertificateSummary) => void
    readonly onRenew: (certificate: CertificateSummary) => void
    readonly onReplace: (certificate: CertificateSummary) => void
    readonly onDelete: (certificate: CertificateSummary) => void
}

export interface CertificateTableActionsProps {
    readonly certificate: CertificateSummary
    readonly canRenew: boolean
    readonly canUpdate: boolean
    readonly canDelete: boolean
    readonly isPending: boolean
    readonly onDetails: (certificate: CertificateSummary) => void
    readonly onRenew: (certificate: CertificateSummary) => void
    readonly onReplace: (certificate: CertificateSummary) => void
    readonly onDelete: (certificate: CertificateSummary) => void
}

export interface CertificatesTableLogicResult {
    readonly table: ClientTable<CertificateSummary>
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
