import type { ProxyAccessLogsQuery } from '../../../../shared/Types/proxy-access-logs.types'
import type { ProxyAccessLogsFilters } from '../Types/proxy-access-logs.types'

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

export const statusClassName = (status: number) =>
    status >= 500
        ? 'border-red-500/25 bg-danger-bg text-danger-text'
        : status >= 400
          ? 'border-amber-500/25 bg-amber-500/10 text-amber-700'
          : status >= 300
            ? 'border-blue-500/20 bg-info-bg text-info-text'
            : 'border-brand-600/20 bg-success-bg text-success-text'
