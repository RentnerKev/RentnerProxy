import type { CrowdSecDashboard, CrowdSecDashboardQuery } from '@/shared/Types/crowdsec.types.ts'

export interface CrowdSecBansTableProps {
    readonly decisions: CrowdSecDashboard['decisions']
    readonly origins: readonly string[]
    readonly filters: {
        readonly searchInput: string
        readonly origin: string
        readonly scope: CrowdSecDashboardQuery['scope']
        readonly pageIndex: number
        readonly pageSize: number
    }
    readonly isLoading: boolean
    readonly onSearchChange: (value: string) => void
    readonly onOriginChange: (value: string) => void
    readonly onScopeChange: (value: CrowdSecDashboardQuery['scope']) => void
    readonly onPageChange: (page: number) => void
    readonly onPageSizeChange: (size: number) => void
}

export interface CrowdSecBansTableLogicResult {
    readonly state: {
        readonly contentId: string
        readonly open: boolean
        readonly activeFilterCount: number
        readonly hasFilters: boolean
        readonly scopeOptions: readonly { readonly label: string; readonly value: string }[]
        readonly originOptions: readonly { readonly label: string; readonly value: string }[]
    }
    readonly handler: { readonly handleToggleFilters: () => void }
}
