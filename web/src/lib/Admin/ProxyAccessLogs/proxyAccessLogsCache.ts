import type { QueryClient } from '@tanstack/react-query'
import type {
    ProxyAccessLogsQuery,
    ProxyAccessLogsResult,
} from '@/lib/Admin/ProxyAccessLogs/Types/proxy-access-logs.types.ts'

export const proxyAccessLogsQueryKeys = {
    all: ['admin', 'proxy-access-logs'] as const,
    list: (query: ProxyAccessLogsQuery) =>
        [...proxyAccessLogsQueryKeys.all, 'list', query] as const,
}

export async function applyProxyAccessLogsSnapshot(
    queryClient: QueryClient,
    request: ProxyAccessLogsQuery,
    data: ProxyAccessLogsResult,
    isCurrent: () => boolean,
): Promise<void> {
    if (!isCurrent()) return
    const queryKey = proxyAccessLogsQueryKeys.list(request)
    await queryClient.cancelQueries({ queryKey, exact: true })
    if (!isCurrent()) return
    queryClient.setQueryData(queryKey, data)
}
