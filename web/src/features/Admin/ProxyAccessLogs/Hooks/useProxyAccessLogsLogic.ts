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
    PROXY_ACCESS_LOGS_DEFAULT_PAGE_SIZE,
    PROXY_ACCESS_LOGS_PAGE_SIZES,
    parseStatusFilter,
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
    const [pageSize, setPageSize] = useState(PROXY_ACCESS_LOGS_DEFAULT_PAGE_SIZE)
    const [page, setPage] = useState(1)
    const [snapshot, setSnapshot] = useState<string | undefined>()
    const [captureVersion, setCaptureVersion] = useState(0)
    const [expandedEntry, setExpandedEntry] = useState<string | null>(null)
    const offset = (page - 1) * pageSize
    const request = useMemo(
        () => toProxyAccessLogsQuery(filters, offset, pageSize, snapshot),
        [filters, offset, pageSize, snapshot],
    )
    const logsQuery = useQuery<ProxyAccessLogsResult>({
        queryKey: [...proxyAccessLogsQueryKeys.list(request), captureVersion],
        queryFn: () => getProxyAccessLogsHandler({ data: request }),
        enabled: canView,
        retry: false,
        refetchOnMount: false,
        refetchOnReconnect: false,
        refetchOnWindowFocus: false,
        staleTime: Infinity,
        gcTime: 0,
    })
    const entries = canView ? (logsQuery.data?.entries ?? []) : []
    const snapshotReset = canView && (logsQuery.data?.snapshotReset ?? false)
    const total = canView ? (logsQuery.data?.total ?? 0) : 0
    const effectiveLimit = canView ? (logsQuery.data?.limit ?? pageSize) : pageSize
    const pageCount = Math.max(Math.ceil(total / Math.max(effectiveLimit, 1)), 1)

    const currentPage = snapshotReset ? 1 : page
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
        const candidateRequest = toProxyAccessLogsQuery(draftFilters, 0, pageSize)
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
        setPage(1)
        setSnapshot(undefined)
        setCaptureVersion((current) => current + 1)
        setExpandedEntry(null)
    }, [draftFilters, pageSize])
    const resetFilters = useCallback(() => {
        setFilters(emptyProxyAccessLogsFilters)
        setDraftFilters(emptyProxyAccessLogsFilters)
        setFilterErrors({})
        setPage(1)
        setSnapshot(undefined)
        setCaptureVersion((current) => current + 1)
        setExpandedEntry(null)
    }, [])
    const refresh = useCallback(async () => {
        await queryClient.invalidateQueries({
            queryKey: proxyAccessLogsQueryKeys.all,
            refetchType: 'none',
        })
        setPage(1)
        setSnapshot(undefined)
        setCaptureVersion((current) => current + 1)
        setExpandedEntry(null)
    }, [queryClient])
    const retry = useCallback(() => {
        void logsQuery.refetch()
    }, [logsQuery])
    const changePage = useCallback(
        (nextPage: number) => {
            const boundedPage = Math.min(Math.max(nextPage, 1), pageCount)
            if (boundedPage === currentPage) return
            setPage(boundedPage)
            setSnapshot(logsQuery.data?.snapshot ?? snapshot)
            setExpandedEntry(null)
        },
        [currentPage, logsQuery.data?.snapshot, pageCount, snapshot],
    )
    const changePageSize = useCallback((nextPageSize: number) => {
        if (
            !PROXY_ACCESS_LOGS_PAGE_SIZES.includes(
                nextPageSize as (typeof PROXY_ACCESS_LOGS_PAGE_SIZES)[number],
            )
        )
            return
        setPageSize(nextPageSize)
        setPage(1)
        setSnapshot(undefined)
        setCaptureVersion((current) => current + 1)
        setExpandedEntry(null)
    }, [])

    return {
        state: {
            canView,
            entries,
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
            limit: effectiveLimit,
            offset: logsQuery.data?.offset ?? offset,
            total,
            truncated: canView && (logsQuery.data?.truncated ?? false),
            snapshotReset,
            pageSize,
            pageCount,
            currentPage,
        },
        handler: {
            applyFilters,
            onHostChange: (value: string) => updateFilter('host', value),
            onSearchChange: (value: string) => updateFilter('search', value),
            onStatusChange: (value: string) => updateFilter('status', value),
            onPageChange: changePage,
            onPageSizeChange: changePageSize,
            refresh,
            resetFilters,
            retry,
            toggleEntryDetails,
        },
    }
}
