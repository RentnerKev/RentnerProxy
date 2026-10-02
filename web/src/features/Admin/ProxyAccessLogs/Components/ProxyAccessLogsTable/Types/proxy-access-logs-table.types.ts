import type { ProxyAccessLogEntry } from '@/shared/Types/proxy-access-logs.types.ts'
import type {
    ProxyAccessLogsFilters,
    ProxyAccessLogsFilterErrors,
} from '../../../Types/proxy-access-logs.types.ts'

export interface ProxyAccessLogsTableProps {
    readonly entries: readonly ProxyAccessLogEntry[]
    readonly availableHosts: readonly string[]
    readonly availableStatuses: readonly number[]
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
    readonly onHostChange: (value: string) => void
    readonly onStatusChange: (value: string) => void
    readonly onSearchChange: (value: string) => void
    readonly onResetFilters: () => void
    readonly onPageChange: (page: number) => void
    readonly onPageSizeChange: (pageSize: number) => void
    readonly onToggleDetails: (key: string) => void
}

export interface ProxyAccessLogsTableLogicResult {
    readonly state: {
        readonly contentId: string
        readonly open: boolean
        readonly activeFilterCount: number
        readonly hasActiveFilters: boolean
        readonly statusOptions: readonly { readonly label: string; readonly value: string }[]
        readonly hostOptions: readonly { readonly label: string; readonly value: string }[]
    }
    readonly handler: { readonly handleToggleFilters: () => void }
}
