import '@tanstack/react-start/server-only'

import type {
    ProxyAccessLogsQuery,
    ProxyAccessLogsResult,
} from '@/lib/Admin/ProxyAccessLogs/Types/proxy-access-logs.types.ts'

import {
    PROXY_ACCESS_LOGS_MAX_RESPONSE_BYTES,
    proxyAccessLogsQuerySchema,
    proxyAccessLogsResultSchema,
} from '@/features/Admin/ProxyAccessLogs/validation.ts'
import { controllerRequest } from './transport.server.ts'

const PROXY_ACCESS_LOGS_TIMEOUT_MS = 5_000

export async function getProxyAccessLogs(
    query: ProxyAccessLogsQuery,
): Promise<ProxyAccessLogsResult | null> {
    const parsedQuery = proxyAccessLogsQuerySchema.safeParse(query)
    if (!parsedQuery.success) return null

    const searchParams = new URLSearchParams()
    if (parsedQuery.data.host !== undefined) searchParams.set('host', parsedQuery.data.host)
    if (parsedQuery.data.status !== undefined)
        searchParams.set('status', String(parsedQuery.data.status))
    if (parsedQuery.data.search !== undefined) searchParams.set('search', parsedQuery.data.search)
    if (parsedQuery.data.limit !== undefined)
        searchParams.set('limit', String(parsedQuery.data.limit))
    if (parsedQuery.data.offset !== undefined)
        searchParams.set('offset', String(parsedQuery.data.offset))
    if (parsedQuery.data.snapshot !== undefined)
        searchParams.set('snapshot', parsedQuery.data.snapshot)

    const path = ('/internal/v1/proxy/access-logs?' +
        searchParams.toString()) as `/internal/v1/proxy/access-logs${string}`
    const payload = await controllerRequest(path, {
        timeoutMs: PROXY_ACCESS_LOGS_TIMEOUT_MS,
        privileged: true,
        responseLimit: PROXY_ACCESS_LOGS_MAX_RESPONSE_BYTES,
    })
    const parsed = proxyAccessLogsResultSchema.safeParse(payload)
    return parsed.success ? parsed.data : null
}
