import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { PERMISSIONS } from '../../../../config/permissions.config'
import useTranslationStore from '../../../../language/useTranslationStore'
import useLiveQuery from '../../../../shared/Live/useLiveQuery'
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
    const [expandedEntry, setExpandedEntry] = useState<string | null>(null)
    const offset = (page - 1) * pageSize
    const request = useMemo(
        () => toProxyAccessLogsQuery(filters, offset, pageSize, snapshot),
        [filters, offset, pageSize, snapshot],
    )
    const requestRef = useRef(request)
    useEffect(() => {
        requestRef.current = request
    }, [request])
    const logsQuery = useQuery<ProxyAccessLogsResult>({
        queryKey: proxyAccessLogsQueryKeys.list(request),
        queryFn: () => getProxyAccessLogsHandler({ data: request }),
        enabled: canView,
        retry: false,
        refetchOnMount: false,
        refetchOnReconnect: false,
        refetchOnWindowFocus: false,
        staleTime: Infinity,
        gcTime: 0,
    })
    const liveRequest = useMemo(
        () => toProxyAccessLogsQuery(filters, 0, pageSize),
        [filters, pageSize],
    )
    const onLiveData = useCallback(
        async (data: ProxyAccessLogsResult) => {
            if (requestRef.current !== request) return
            const queryKey = proxyAccessLogsQueryKeys.list(request)
            await queryClient.cancelQueries({ queryKey, exact: true })
            if (requestRef.current !== request) return
            queryClient.setQueryData(queryKey, data)
        },
        [queryClient, request],
    )
    const liveStatus = useLiveQuery<ProxyAccessLogsResult>({
        topic: 'access-logs',
        query: liveRequest,
        enabled: canView && page === 1,
        onData: onLiveData,
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
        setExpandedEntry(null)
    }, [draftFilters, pageSize])
    const resetFilters = useCallback(() => {
        setFilters(emptyProxyAccessLogsFilters)
        setDraftFilters(emptyProxyAccessLogsFilters)
        setFilterErrors({})
        setPage(1)
        setSnapshot(undefined)
        setExpandedEntry(null)
    }, [])
    useEffect(() => {
        if (
            draftFilters.search === filters.search &&
            draftFilters.host === filters.host &&
            draftFilters.status === filters.status
        )
            return

        const timeout = setTimeout(
            () => {
                applyFilters()
            },
            draftFilters.search === filters.search ? 0 : 300,
        )
        return () => clearTimeout(timeout)
    }, [applyFilters, draftFilters, filters])
    const retry = useCallback(() => {
        void logsQuery.refetch()
    }, [logsQuery])
    const changePage = useCallback(
        (nextPage: number) => {
            const boundedPage = Math.min(Math.max(nextPage, 1), pageCount)
            if (boundedPage === currentPage) return
            setPage(boundedPage)
            setSnapshot(boundedPage === 1 ? undefined : (logsQuery.data?.snapshot ?? snapshot))
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
        setExpandedEntry(null)
    }, [])

    return {
        state: {
            canView,
            liveStatus,
            entries,
            availableHosts: logsQuery.data?.availableHosts ?? [],
            availableStatuses: logsQuery.data?.availableStatuses ?? [],
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
            onHostChange: (value: string) => updateFilter('host', value),
            onSearchChange: (value: string) => updateFilter('search', value),
            onStatusChange: (value: string) => updateFilter('status', value),
            onPageChange: changePage,
            onPageSizeChange: changePageSize,
            resetFilters,
            retry,
            toggleEntryDetails,
        },
    }
}
