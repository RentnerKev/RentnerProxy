import type { PermissionKey } from '../../../../config/permissions.config'
import type { ProxyAccessLogEntry } from '../../../../shared/Types/proxy-access-logs.types'
import type useProxyAccessLogsLogic from '../Hooks/useProxyAccessLogsLogic'

export interface ProxyAccessLogsPageProps {
    readonly permissions: readonly PermissionKey[]
}

export interface ProxyAccessLogsPageViewProps {
    readonly logic: ReturnType<typeof useProxyAccessLogsLogic>
}

export interface ProxyAccessLogsFilters {
    readonly host: string
    readonly status: string
    readonly search: string
}

export type ProxyAccessLogsFilterErrors = Partial<Record<keyof ProxyAccessLogsFilters, string>>

export interface ProxyAccessLogsTableProps {
    readonly entries: readonly ProxyAccessLogEntry[]
    readonly expandedEntry: string | null
    readonly formatTimestamp: (value: string) => string
    readonly filters: ProxyAccessLogsFilters
    readonly filterErrors: ProxyAccessLogsFilterErrors
    readonly total: number
    readonly truncated: boolean
    readonly snapshotReset: boolean
    readonly pageSize: number
    readonly currentPage: number
    readonly isLoading: boolean
    readonly isRefreshing: boolean
    readonly onHostChange: (value: string) => void
    readonly onStatusChange: (value: string) => void
    readonly onSearchChange: (value: string) => void
    readonly onApplyFilters: () => void
    readonly onResetFilters: () => void
    readonly onRefresh: () => void
    readonly onPageChange: (page: number) => void
    readonly onPageSizeChange: (pageSize: number) => void
    readonly onToggleDetails: (key: string) => void
}
