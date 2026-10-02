import type { QueryClient } from '@tanstack/react-query'
import type { AuditEventsQuery, AuditEventsResult } from '@/shared/Types/audit-events.types.ts'

export const auditLogsQueryKeys = {
    all: ['admin', 'audit-logs'] as const,
    actors: () => [...auditLogsQueryKeys.all, 'actors'] as const,
    list: (query: AuditEventsQuery) => [...auditLogsQueryKeys.all, 'list', query] as const,
}

export async function applyAuditLogsSnapshot(
    queryClient: QueryClient,
    request: AuditEventsQuery,
    data: AuditEventsResult,
    isCurrent: () => boolean,
): Promise<void> {
    if (!isCurrent()) return
    const queryKey = auditLogsQueryKeys.list(request)
    await queryClient.cancelQueries({ queryKey, exact: true })
    if (!isCurrent()) return
    queryClient.setQueryData(queryKey, data)
}
