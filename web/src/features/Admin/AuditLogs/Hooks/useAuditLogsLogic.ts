import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { PERMISSIONS } from '../../../../config/permissions.config'
import useTranslationStore from '../../../../language/useTranslationStore'
import useLiveQuery from '../../../../shared/Live/useLiveQuery'
import type {
    AuditAction,
    AuditActorOption,
    AuditEventsQuery,
    AuditEventsResult,
    AuditResource,
} from '../../../../shared/Types/audit-events.types'
import { auditLogsQueryKeys } from '../queryKeys'
import { getAuditActorOptionsHandler, getAuditEventsHandler } from '../server'
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
    const requestRef = useRef(request)
    useEffect(() => {
        requestRef.current = request
    }, [request])
    const auditQuery = useQuery<AuditEventsResult>({
        queryKey: auditLogsQueryKeys.list(request),
        queryFn: () => getAuditEventsHandler({ data: request }),
        enabled: canView,
        retry: false,
    })
    const actorOptionsQuery = useQuery<readonly AuditActorOption[]>({
        queryKey: auditLogsQueryKeys.actors(),
        queryFn: () => getAuditActorOptionsHandler(),
        enabled: canView,
        retry: false,
    })
    const events = useMemo(
        () => sortAuditEventsNewestFirst(canView ? (auditQuery.data?.events ?? []) : []),
        [auditQuery.data?.events, canView],
    )
    const liveRequest = useMemo(() => toAuditEventsQuery(filters, undefined), [filters])
    const onLiveData = useCallback(
        async (data: AuditEventsResult) => {
            if (requestRef.current !== request) return
            const queryKey = auditLogsQueryKeys.list(request)
            await queryClient.cancelQueries({ queryKey, exact: true })
            if (requestRef.current !== request) return
            queryClient.setQueryData(queryKey, data)
        },
        [queryClient, request],
    )
    const liveStatus = useLiveQuery<AuditEventsResult>({
        topic: 'audit-logs',
        query: liveRequest,
        enabled: canView && cursorStack.length === 0,
        onData: onLiveData,
    })
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
            const next = { ...draftFilters, [key]: value }
            const errors = validateAuditLogsFilters(next)
            setDraftFilters(next)
            setFilterErrors(errors)
            if (Object.keys(errors).length === 0) {
                setFilters({ ...next, actorUserId: next.actorUserId.trim() })
                setCursorStack([])
                setExpandedEventId(null)
            }
        },
        [draftFilters],
    )
    const resetFilters = useCallback(() => {
        setFilters(emptyAuditLogsFilters)
        setDraftFilters(emptyAuditLogsFilters)
        setFilterErrors({})
        setCursorStack([])
        setExpandedEventId(null)
    }, [])
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
            actorOptions: canView ? (actorOptionsQuery.data ?? []) : [],
            canView,
            liveStatus,
            events,
            expandedEventId,
            formatTimestamp,
            filterErrors,
            filters: draftFilters,
            hasMore: canView && (auditQuery.data?.hasMore ?? false),
            isError: canView && (auditQuery.isError || actorOptionsQuery.isError),
            isLoading: canView && (auditQuery.isPending || actorOptionsQuery.isPending),
            nextCursor: canView ? (auditQuery.data?.nextCursor ?? null) : null,
            pageNumber: cursorStack.length + 1,
            result: canView ? auditQuery.data : undefined,
            request,
        },
        handler: {
            onActionChange: (value: AuditAction | '') => updateFilter('action', value),
            onActorChange: (value: string) => updateFilter('actorUserId', value),
            onFromChange: (value: string) => updateFilter('from', value),
            onResourceChange: (value: AuditResource | '') => updateFilter('resource', value),
            onToChange: (value: string) => updateFilter('to', value),
            nextPage,
            onToggleDetails: toggleDetails,
            previousPage,
            resetFilters,
            retry: () => {
                void Promise.all([auditQuery.refetch(), actorOptionsQuery.refetch()])
            },
        },
    }
}
