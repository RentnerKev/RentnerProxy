import type { AuditEventsQuery } from '../../../shared/Types/audit-events.types'

export const auditLogsQueryKeys = {
    all: ['admin', 'audit-logs'] as const,
    actors: () => [...auditLogsQueryKeys.all, 'actors'] as const,
    list: (query: AuditEventsQuery) => [...auditLogsQueryKeys.all, 'list', query] as const,
}
