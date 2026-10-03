import type { PermissionKey } from '@/config/Types/permissions-config.types.ts'
import type {
    AuditAction,
    AuditActorOption,
    AuditEventDto,
    AuditResource,
} from '@/lib/Admin/AuditLogs/Types/audit-events.types.ts'

export interface AuditLogsPageProps {
    readonly permissions: readonly PermissionKey[]
}

export interface AuditLogsFilters {
    readonly actorUserId: string
    readonly action: AuditAction | ''
    readonly resource: AuditResource | ''
    readonly from: string
    readonly to: string
}

export type AuditLogsFilterErrors = Partial<Record<keyof AuditLogsFilters | 'dateRange', string>>

export interface AuditLogsQueryState {
    readonly actorOptions: readonly AuditActorOption[]
    readonly canView: boolean
    readonly events: readonly AuditEventDto[]
    readonly expandedEventId: string | null
    readonly filterErrors: AuditLogsFilterErrors
    readonly filters: AuditLogsFilters
    readonly hasMore: boolean
    readonly isError: boolean
    readonly isLoading: boolean
    readonly pageNumber: number
}

export interface AuditLogsLogicResult {
    readonly state: AuditLogsQueryState & {
        readonly formatTimestamp: (value: string) => string
    }
    readonly handler: {
        readonly onActionChange: (value: AuditAction | '') => void
        readonly onActorChange: (value: string) => void
        readonly onFromChange: (value: string) => void
        readonly onResourceChange: (value: AuditResource | '') => void
        readonly onToChange: (value: string) => void
        readonly nextPage: () => void
        readonly previousPage: () => void
        readonly onToggleDetails: (eventId: string) => void
        readonly resetFilters: () => void
        readonly retry: () => void
    }
}
