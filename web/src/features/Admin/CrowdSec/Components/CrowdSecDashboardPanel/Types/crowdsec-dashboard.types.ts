import type {
    CrowdSecConfiguration,
    CrowdSecDashboard,
    CrowdSecDashboardQuery,
} from '@/lib/Admin/CrowdSec/Types/crowdsec.types.ts'

export interface CrowdSecDashboardPanelProps {
    readonly configuration: CrowdSecConfiguration
}

export interface CrowdSecDashboardLogicResult {
    readonly state: {
        readonly enabled: boolean
        readonly snapshot: CrowdSecDashboard | undefined
        readonly isFetching: boolean
        readonly isError: boolean
        readonly collectedAtDisplay: string
        readonly filters: {
            readonly searchInput: string
            readonly origin: string
            readonly scope: CrowdSecDashboardQuery['scope']
            readonly pageIndex: number
            readonly pageSize: number
        }
    }
    readonly handler: {
        readonly handleRefresh: () => void
        readonly setSearchInput: (value: string) => void
        readonly setOrigin: (value: string) => void
        readonly setScope: (value: CrowdSecDashboardQuery['scope']) => void
        readonly setPageIndex: (value: number) => void
        readonly setPageSize: (value: number) => void
    }
}
