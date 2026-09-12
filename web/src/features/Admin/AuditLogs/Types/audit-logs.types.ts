import type { PermissionKey } from '../../../../config/permissions.config'
import type {
    AuditAction,
    AuditEventDto,
    AuditEventsQuery,
    AuditEventsResult,
    AuditResource,
} from '../../../../shared/Types/audit-events.types'
import type useAuditLogsLogic from '../Hooks/useAuditLogsLogic'

export interface AuditLogsPageProps {
    readonly permissions: readonly PermissionKey[]
}

export interface AuditLogsPageViewProps {
    readonly logic: ReturnType<typeof useAuditLogsLogic>
}

export interface AuditLogsFilters {
    readonly actorUserId: string
    readonly action: AuditAction | ''
    readonly resource: AuditResource | ''
    readonly from: string
    readonly to: string
}

export type AuditLogsFilterErrors = Partial<Record<keyof AuditLogsFilters | 'dateRange', string>>

export interface AuditLogsTableProps {
    readonly events: readonly AuditEventDto[]
    readonly expandedEventId: string | null
    readonly formatTimestamp: (value: string) => string
    readonly filters: AuditLogsFilters
    readonly filterErrors: AuditLogsFilterErrors
    readonly hasMore: boolean
    readonly isLoading: boolean
    readonly isRefreshing: boolean
    readonly pageNumber: number
    readonly onActorChange: (value: string) => void
    readonly onActionChange: (value: AuditAction | '') => void
    readonly onResourceChange: (value: AuditResource | '') => void
    readonly onFromChange: (value: string) => void
    readonly onToChange: (value: string) => void
    readonly onApplyFilters: () => void
    readonly onResetFilters: () => void
    readonly onRefresh: () => void
    readonly onPreviousPage: () => void
    readonly onNextPage: () => void
    readonly onToggleDetails: (eventId: string) => void
}

export interface AuditLogsQueryState {
    readonly canView: boolean
    readonly events: readonly AuditEventDto[]
    readonly expandedEventId: string | null
    readonly filterErrors: AuditLogsFilterErrors
    readonly filters: AuditLogsFilters
    readonly hasMore: boolean
    readonly isError: boolean
    readonly isLoading: boolean
    readonly isRefreshing: boolean
    readonly nextCursor: string | null
    readonly pageNumber: number
    readonly result: AuditEventsResult | undefined
    readonly request: AuditEventsQuery
}
