import type {
    AuditAction,
    AuditActorOption,
    AuditEventDto,
    AuditResource,
} from '@/lib/Admin/AuditLogs/Types/audit-events.types.ts'
import type { AuditLogsFilters, AuditLogsFilterErrors } from '../../../Types/audit-logs.types.ts'

export interface AuditLogsTableProps {
    readonly actorOptions: readonly AuditActorOption[]
    readonly events: readonly AuditEventDto[]
    readonly expandedEventId: string | null
    readonly formatTimestamp: (value: string) => string
    readonly filters: AuditLogsFilters
    readonly filterErrors: AuditLogsFilterErrors
    readonly hasMore: boolean
    readonly isLoading: boolean
    readonly pageNumber: number
    readonly onActorChange: (value: string) => void
    readonly onActionChange: (value: AuditAction | '') => void
    readonly onResourceChange: (value: AuditResource | '') => void
    readonly onFromChange: (value: string) => void
    readonly onToChange: (value: string) => void
    readonly onResetFilters: () => void
    readonly onPreviousPage: () => void
    readonly onNextPage: () => void
    readonly onToggleDetails: (eventId: string) => void
}

export interface AuditLogsTableLogicResult {
    readonly state: {
        readonly contentId: string
        readonly open: boolean
        readonly activeFilterCount: number
        readonly hasActiveFilters: boolean
        readonly resourceOptions: readonly { readonly label: string; readonly value: string }[]
        readonly actionOptions: readonly { readonly label: string; readonly value: string }[]
        readonly actorOptions: readonly { readonly label: string; readonly value: string }[]
    }
    readonly handler: { readonly handleToggleFilters: () => void }
}
