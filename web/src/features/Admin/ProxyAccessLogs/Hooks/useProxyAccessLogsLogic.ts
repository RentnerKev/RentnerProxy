import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'

import { PERMISSIONS } from '../../../../config/permissions.config'
import useTranslationStore from '../../../../language/useTranslationStore'
import type { ProxyAccessLogsResult } from '../../../../shared/Types/proxy-access-logs.types'
import { proxyAccessLogsQueryKeys } from '../queryKeys'
import { getProxyAccessLogsHandler } from '../server'
import { proxyAccessLogsQuerySchema } from '../validation'
import {
    emptyProxyAccessLogsFilters,
    parseStatusFilter,
    PROXY_ACCESS_LOGS_PAGE_SIZE,
    sortProxyAccessLogsNewestFirst,
    toProxyAccessLogsQuery,
} from '../Helpers/proxyAccessLogs'
import type {
    ProxyAccessLogsFilterErrors,
    ProxyAccessLogsFilters,
    ProxyAccessLogsPageProps,
} from '../Types/proxy-access-logs.types'

export default function useProxyAccessLogsLogic({ permissions }: ProxyAccessLogsPageProps) {
    const { locale } = useTranslationStore()
    const permissionSet = useMemo(() => new Set(permissions), [permissions])
    const canView = permissionSet.has(PERMISSIONS.PROXY_ACCESS_LOGS_VIEW)
    const queryClient = useQueryClient()
    const [filters, setFilters] = useState<ProxyAccessLogsFilters>(emptyProxyAccessLogsFilters)
    const [draftFilters, setDraftFilters] = useState<ProxyAccessLogsFilters>(
        emptyProxyAccessLogsFilters,
    )
    const [filterErrors, setFilterErrors] = useState<ProxyAccessLogsFilterErrors>({})
    const [offset, setOffset] = useState(0)
    const [expandedEntry, setExpandedEntry] = useState<string | null>(null)
    const request = useMemo(() => toProxyAccessLogsQuery(filters, offset), [filters, offset])
    const logsQuery = useQuery<ProxyAccessLogsResult>({
        queryKey: proxyAccessLogsQueryKeys.list(request),
        queryFn: () => getProxyAccessLogsHandler({ data: request }),
        enabled: canView,
        retry: false,
    })
    const sortedEntries = useMemo(
        () => sortProxyAccessLogsNewestFirst(canView ? (logsQuery.data?.entries ?? []) : []),
        [canView, logsQuery.data?.entries],
    )
    const timestampFormatter = useMemo(
        () =>
            new Intl.DateTimeFormat(locale, {
                dateStyle: 'short',
                timeStyle: 'medium',
                timeZone: 'UTC',
            }),
        [locale],
    )
    const formatTimestamp = useCallback(
        (value: string) => {
            const date = new Date(value)
            return Number.isNaN(date.getTime()) ? value : timestampFormatter.format(date)
        },
        [timestampFormatter],
    )
    const toggleEntryDetails = useCallback((key: string) => {
        setExpandedEntry((current) => (current === key ? null : key))
    }, [])

    const updateFilter = useCallback((key: keyof ProxyAccessLogsFilters, value: string) => {
        setDraftFilters((current) => ({ ...current, [key]: value }))
        setFilterErrors((current) => ({ ...current, [key]: undefined }))
    }, [])
    const applyFilters = useCallback(() => {
        const candidateRequest = toProxyAccessLogsQuery(draftFilters, 0)
        const errors: ProxyAccessLogsFilterErrors = {}
        if (draftFilters.status.trim() && parseStatusFilter(draftFilters.status) === undefined) {
            errors.status = 'admin.proxyAccessLogs.validation.status'
        }
        const parsed = proxyAccessLogsQuerySchema.safeParse(candidateRequest)
        if (!parsed.success) {
            for (const issue of parsed.error.issues) {
                const field = issue.path[0]
                if (
                    (field === 'host' || field === 'status' || field === 'search') &&
                    errors[field] === undefined
                ) {
                    errors[field] = issue.message
                }
            }
        }
        if (Object.keys(errors).length > 0) {
            setFilterErrors(errors)
            return
        }

        if (!parsed.data) {
            setFilterErrors({ search: 'admin.proxyAccessLogs.validation.search' })
            return
        }

        const normalizedFilters: ProxyAccessLogsFilters = {
            host: typeof parsed.data.host === 'string' ? parsed.data.host : '',
            search: typeof parsed.data.search === 'string' ? parsed.data.search : '',
            status: draftFilters.status.trim(),
        }
        setFilterErrors({})
        setFilters(normalizedFilters)
        setDraftFilters(normalizedFilters)
        setOffset(0)
    }, [draftFilters])
    const resetFilters = useCallback(() => {
        setFilters(emptyProxyAccessLogsFilters)
        setDraftFilters(emptyProxyAccessLogsFilters)
        setFilterErrors({})
        setOffset(0)
    }, [])
    const refresh = useCallback(async () => {
        await queryClient.invalidateQueries({
            queryKey: proxyAccessLogsQueryKeys.all,
            refetchType: 'none',
        })
        setOffset(0)
        if (offset === 0) void logsQuery.refetch()
    }, [logsQuery, offset, queryClient])
    const retry = useCallback(() => {
        void logsQuery.refetch()
    }, [logsQuery])
    const previousPage = useCallback(() => {
        setOffset((current) => Math.max(0, current - PROXY_ACCESS_LOGS_PAGE_SIZE))
    }, [])
    const nextPage = useCallback(() => {
        if (!logsQuery.data?.hasMore) return
        setOffset((current) => current + PROXY_ACCESS_LOGS_PAGE_SIZE)
    }, [logsQuery.data?.hasMore])

    return {
        state: {
            canView,
            entries: sortedEntries,
            expandedEntry,
            formatTimestamp,
            filterErrors,
            filters: draftFilters,
            hasActiveFilters:
                draftFilters.host.trim().length > 0 ||
                draftFilters.status.trim().length > 0 ||
                draftFilters.search.trim().length > 0,
            hasMore: canView && (logsQuery.data?.hasMore ?? false),
            isError: canView && logsQuery.isError,
            isLoading: canView && logsQuery.isPending,
            isRefreshing: logsQuery.isFetching && !logsQuery.isPending,
            limit: canView
                ? (logsQuery.data?.limit ?? PROXY_ACCESS_LOGS_PAGE_SIZE)
                : PROXY_ACCESS_LOGS_PAGE_SIZE,
            offset,
            total: canView ? (logsQuery.data?.total ?? 0) : 0,
            truncated: canView && (logsQuery.data?.truncated ?? false),
        },
        handler: {
            nextPage,
            applyFilters,
            onHostChange: (value: string) => updateFilter('host', value),
            onSearchChange: (value: string) => updateFilter('search', value),
            onStatusChange: (value: string) => updateFilter('status', value),
            previousPage,
            refresh,
            resetFilters,
            retry,
            toggleEntryDetails,
        },
    }
}
