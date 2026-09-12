import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'

import { PERMISSIONS } from '../../../../config/permissions.config'
import useTranslationStore from '../../../../language/useTranslationStore'
import type {
    AuditAction,
    AuditEventsQuery,
    AuditEventsResult,
    AuditResource,
} from '../../../../shared/Types/audit-events.types'
import { auditLogsQueryKeys } from '../queryKeys'
import { getAuditEventsHandler } from '../server'
import {
    emptyAuditLogsFilters,
    sortAuditEventsNewestFirst,
    toAuditEventsQuery,
    validateAuditLogsFilters,
} from '../Helpers/auditLogs'
import type { AuditLogsFilterErrors, AuditLogsPageProps } from '../Types/audit-logs.types'

export default function useAuditLogsLogic({ permissions }: AuditLogsPageProps) {
    const { locale } = useTranslationStore()
    const permissionSet = useMemo(() => new Set(permissions), [permissions])
    const canView = permissionSet.has(PERMISSIONS.AUDIT_LOGS_VIEW)
    const queryClient = useQueryClient()
    const [filters, setFilters] = useState(emptyAuditLogsFilters)
    const [draftFilters, setDraftFilters] = useState(emptyAuditLogsFilters)
    const [filterErrors, setFilterErrors] = useState<AuditLogsFilterErrors>({})
    const [cursorStack, setCursorStack] = useState<readonly string[]>([])
    const [expandedEventId, setExpandedEventId] = useState<string | null>(null)
    const cursor = cursorStack.at(-1)
    const request = useMemo<AuditEventsQuery>(
        () => toAuditEventsQuery(filters, cursor),
        [cursor, filters],
    )
    const auditQuery = useQuery<AuditEventsResult>({
        queryKey: auditLogsQueryKeys.list(request),
        queryFn: () => getAuditEventsHandler({ data: request }),
        enabled: canView,
        retry: false,
    })
    const events = useMemo(
        () => sortAuditEventsNewestFirst(canView ? (auditQuery.data?.events ?? []) : []),
        [auditQuery.data?.events, canView],
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

    const updateFilter = useCallback(
        <K extends keyof typeof emptyAuditLogsFilters>(
            key: K,
            value: (typeof emptyAuditLogsFilters)[K],
        ) => {
            setDraftFilters((current) => ({ ...current, [key]: value }))
            setFilterErrors((current) => {
                const next = { ...current }
                delete next[key]
                delete next.dateRange
                return next
            })
        },
        [],
    )
    const applyFilters = useCallback(() => {
        const errors = validateAuditLogsFilters(draftFilters)
        if (Object.keys(errors).length > 0) {
            setFilterErrors(errors)
            return
        }
        setFilterErrors({})
        setFilters({ ...draftFilters, actorUserId: draftFilters.actorUserId.trim() })
        setCursorStack([])
        setExpandedEventId(null)
    }, [draftFilters])
    const resetFilters = useCallback(() => {
        setFilters(emptyAuditLogsFilters)
        setDraftFilters(emptyAuditLogsFilters)
        setFilterErrors({})
        setCursorStack([])
        setExpandedEventId(null)
    }, [])
    const refresh = useCallback(async () => {
        await queryClient.invalidateQueries({
            queryKey: auditLogsQueryKeys.all,
            refetchType: 'none',
        })
        setCursorStack([])
        setExpandedEventId(null)
        if (cursorStack.length === 0) void auditQuery.refetch()
    }, [auditQuery, cursorStack.length, queryClient])
    const retry = useCallback(() => {
        void auditQuery.refetch()
    }, [auditQuery])
    const previousPage = useCallback(() => {
        setCursorStack((current) => current.slice(0, -1))
        setExpandedEventId(null)
    }, [])
    const nextPage = useCallback(() => {
        const nextCursor = auditQuery.data?.nextCursor
        if (!auditQuery.data?.hasMore || !nextCursor) return
        setCursorStack((current) => [...current, nextCursor])
        setExpandedEventId(null)
    }, [auditQuery.data?.hasMore, auditQuery.data?.nextCursor])
    const toggleDetails = useCallback((eventId: string) => {
        setExpandedEventId((current) => (current === eventId ? null : eventId))
    }, [])

    return {
        state: {
            canView,
            events,
            expandedEventId,
            formatTimestamp,
            filterErrors,
            filters: draftFilters,
            hasMore: canView && (auditQuery.data?.hasMore ?? false),
            isError: canView && auditQuery.isError,
            isLoading: canView && auditQuery.isPending,
            isRefreshing: auditQuery.isFetching && !auditQuery.isPending,
            nextCursor: canView ? (auditQuery.data?.nextCursor ?? null) : null,
            pageNumber: cursorStack.length + 1,
            result: canView ? auditQuery.data : undefined,
            request,
        },
        handler: {
            applyFilters,
            onActionChange: (value: AuditAction | '') => updateFilter('action', value),
            onActorChange: (value: string) => updateFilter('actorUserId', value),
            onFromChange: (value: string) => updateFilter('from', value),
            onResourceChange: (value: AuditResource | '') => updateFilter('resource', value),
            onToChange: (value: string) => updateFilter('to', value),
            nextPage,
            onToggleDetails: toggleDetails,
            previousPage,
            refresh,
            resetFilters,
            retry,
        },
    }
}
