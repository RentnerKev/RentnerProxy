import type { PermissionKey } from '@/shared/Types/permissions-config.types.ts'
import type {
    AuditAction,
    AuditActorOption,
    AuditEventDto,
    AuditEventsQuery,
    AuditEventsResult,
    AuditResource,
} from '@/shared/Types/audit-events.types.ts'

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
    readonly nextCursor: string | null
    readonly pageNumber: number
    readonly result: AuditEventsResult | undefined
    readonly request: AuditEventsQuery
}

export interface AuditLogsLogicResult {
    readonly state: AuditLogsQueryState & {
        readonly formatTimestamp: (value: string) => string
        readonly liveStatus: import('@/lib/Live/realtimeEventsClient.ts').LiveStatus
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
