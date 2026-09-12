import type { ProxyAccessLogsQuery } from '../../../shared/Types/proxy-access-logs.types'

export const proxyAccessLogsQueryKeys = {
    all: ['admin', 'proxy-access-logs'] as const,
    list: (query: ProxyAccessLogsQuery) =>
        [...proxyAccessLogsQueryKeys.all, 'list', query] as const,
}
