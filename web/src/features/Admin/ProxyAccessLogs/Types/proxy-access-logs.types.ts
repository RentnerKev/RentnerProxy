import type { PermissionKey } from '@/shared/Types/permissions-config.types.ts'

export interface ProxyAccessLogsPageProps {
    readonly permissions: readonly PermissionKey[]
}

export interface ProxyAccessLogsFilters {
    readonly host: string
    readonly status: string
    readonly search: string
}

export type ProxyAccessLogsFilterErrors = Partial<Record<keyof ProxyAccessLogsFilters, string>>

export interface ProxyAccessLogsLogicResult {
    readonly state: {
        readonly entries: readonly import('@/shared/Types/proxy-access-logs.types.ts').ProxyAccessLogEntry[]
        readonly canView: boolean
        readonly liveStatus: import('@/lib/Live/realtimeEventsClient.ts').LiveStatus
        readonly availableHosts: readonly string[]
        readonly availableStatuses: readonly number[]
        readonly expandedEntry: string | null
        readonly formatTimestamp: (value: string) => string
        readonly filterErrors: ProxyAccessLogsFilterErrors
        readonly filters: ProxyAccessLogsFilters
        readonly hasActiveFilters: boolean
        readonly hasMore: boolean
        readonly isError: boolean
        readonly isLoading: boolean
        readonly limit: number
        readonly offset: number
        readonly total: number
        readonly truncated: boolean
        readonly snapshotReset: boolean
        readonly pageSize: number
        readonly pageCount: number
        readonly currentPage: number
    }
    readonly handler: {
        readonly onHostChange: (value: string) => void
        readonly onSearchChange: (value: string) => void
        readonly onStatusChange: (value: string) => void
        readonly onPageChange: (page: number) => void
        readonly onPageSizeChange: (size: number) => void
        readonly resetFilters: () => void
        readonly retry: () => void
        readonly toggleEntryDetails: (key: string) => void
    }
}
