import type { ProxyAccessLogsQuery } from '@/lib/Admin/ProxyAccessLogs/Types/proxy-access-logs.types.ts'
import type { ProxyAccessLogsFilters } from '@/features/Admin/ProxyAccessLogs/Types/proxy-access-logs.types.ts'

export const PROXY_ACCESS_LOGS_DEFAULT_PAGE_SIZE = 15
export const PROXY_ACCESS_LOGS_PAGE_SIZES = [15, 25, 50, 100] as const

export const emptyProxyAccessLogsFilters: ProxyAccessLogsFilters = {
    host: '',
    status: '',
    search: '',
}

export function parseStatusFilter(value: string): number | undefined {
    const normalized = value.trim()
    if (!/^\d{3}$/u.test(normalized)) return undefined

    const status = Number(normalized)
    return status >= 100 && status <= 599 ? status : undefined
}

export function toProxyAccessLogsQuery(
    filters: ProxyAccessLogsFilters,
    offset: number,
    limit: number,
    snapshot?: string,
): ProxyAccessLogsQuery {
    const host = filters.host.trim()
    const search = filters.search.trim()
    const status = parseStatusFilter(filters.status)

    return {
        ...(host ? { host } : {}),
        ...(status === undefined ? {} : { status }),
        ...(search ? { search } : {}),
        limit,
        offset,
        ...(snapshot ? { snapshot } : {}),
    }
}

export function withoutQueryString(value: string): string {
    const queryStart = value.search(/[?#]/u)
    const path = queryStart < 0 ? value : value.slice(0, queryStart)
    return path || '/'
}

export function formatDuration(durationMs: number): string {
    return `${Math.max(0, Math.round(durationMs))} ms`
}

export function formatBytes(bytes: number, locale: string): string {
    return new Intl.NumberFormat(locale).format(Math.max(0, Math.round(bytes)))
}

export function methodClassName(method: string): string {
    switch (method.toUpperCase()) {
        case 'GET':
            return 'border-info-text/20 bg-info-bg text-info-text'
        case 'POST':
            return 'border-success-text/20 bg-success-bg text-success-text'
        case 'PUT':
            return 'border-orange-500/25 bg-orange-500/10 text-orange-700 dark:text-orange-300'
        case 'PATCH':
            return 'border-violet-500/25 bg-violet-500/10 text-violet-700 dark:text-violet-300'
        case 'DELETE':
            return 'border-danger-text/25 bg-danger-bg text-danger-text'
        case 'HEAD':
            return 'border-cyan-500/25 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300'
        case 'OPTIONS':
            return 'border-warning-text/25 bg-warning-text/10 text-warning-text'
        case 'TRACE':
            return 'border-pink-500/25 bg-pink-500/10 text-pink-700 dark:text-pink-300'
        case 'CONNECT':
            return 'border-indigo-500/25 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300'
        default:
            return 'border-border-strong bg-neutral text-muted'
    }
}
