import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useForm, useStore } from '@tanstack/react-form'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { HOST_MONITORING_DEFAULTS } from '@/config/host-monitoring.config.ts'
import { HOST_MONITORING_UI } from '@/config/host-monitoring-ui.config.ts'
import {
    getHostMonitoringHistory,
    getHostMonitoringPolicy,
    saveHostMonitoringPolicy,
    HostMonitoringClientError,
} from '@/lib/HostMonitoring/hostMonitoringClient.ts'
import { hostMonitoringQueryKeys } from '@/lib/HostMonitoring/hostMonitoringCache.ts'
import { hostMonitoringSettingsSchema } from '@/lib/HostMonitoring/validation.ts'
import { durationPlot, monitoringSince } from '@/lib/HostMonitoring/presentation.ts'
import type {
    HostMonitoringHistoryQuery,
    HostMonitoringSettings,
} from '@/lib/HostMonitoring/Types/host-monitoring.types.ts'
import type { MonitoringPeriod } from '@/lib/HostMonitoring/Types/host-monitoring-presentation.types.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type {
    HostMonitoringDialogProps,
    MonitoringDialogHandler,
    MonitoringDialogState,
    MonitoringHistoryPage,
    MonitoringHistoryPageParam,
    MonitoringTab,
} from '../Types/host-monitoring-dialog.types.ts'

function privateError(error: unknown) {
    return (
        error instanceof HostMonitoringClientError &&
        (error.code === 'authentication_required' || error.code === 'permission_denied')
    )
}

export default function useHostMonitoringDialogLogic(props: HostMonitoringDialogProps) {
    const { t, locale } = useTranslationStore()
    const queryClient = useQueryClient()
    const id = useId()
    const canView = props.permissions.includes(PERMISSIONS.PROXY_HOSTS_VIEW)
    const canUpdate = canView && props.permissions.includes(PERMISSIONS.PROXY_HOSTS_UPDATE)
    const [tab, setTab] = useState<MonitoringTab>('overview')
    const [status, setStatus] = useState<HostMonitoringHistoryQuery['status']>('all')
    const [period, setPeriod] = useState<MonitoringPeriod>('recent')
    const [notice, setNotice] = useState('')
    const [conflict, setConflict] = useState(false)
    const [ready, setReady] = useState(false)
    const [accessRevoked, setAccessRevoked] = useState(false)
    const baseVersion = useRef<string | null>(null)
    const draftOwner = useRef('')
    const session = useRef({ open: props.open, canView, hostId: props.host.id })
    useEffect(() => {
        session.current = { open: props.open, canView, hostId: props.host.id }
    }, [props.open, canView, props.host.id])
    const domains = useMemo(
        () =>
            props.host.domains
                .filter((domain) => !domain.startsWith('*.'))
                .map((domain) => ({ value: domain, label: domain })),
        [props.host.domains],
    )
    const enabled = props.open && canView && !accessRevoked
    const policyQuery = useQuery({
        queryKey: hostMonitoringQueryKeys.policy(props.host.id),
        queryFn: ({ signal }) => getHostMonitoringPolicy(props.host.id, signal),
        enabled,
        refetchInterval: enabled ? HOST_MONITORING_UI.pollIntervalMs : false,
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        retry: (count, error) => !privateError(error) && count < 2,
    })
    const historyInput: HostMonitoringHistoryQuery = {
        proxyHostId: props.host.id,
        status,
        limit: HOST_MONITORING_UI.historyPageLimit,
    }
    const historyQuery = useInfiniteQuery({
        queryKey: hostMonitoringQueryKeys.history({ ...historyInput, period }),
        initialPageParam: undefined as MonitoringHistoryPageParam | undefined,
        queryFn: async ({ signal, pageParam }): Promise<MonitoringHistoryPage> => {
            const windowSince = pageParam ? pageParam.since : monitoringSince(period, Date.now())
            const history = await getHostMonitoringHistory(
                {
                    ...historyInput,
                    ...(windowSince ? { since: windowSince } : {}),
                    ...(pageParam ? { before: pageParam.before } : {}),
                },
                signal,
            )
            return { ...history, windowSince }
        },
        getNextPageParam: (page, pages) =>
            pages.length * HOST_MONITORING_UI.historyPageLimit <
            HOST_MONITORING_UI.historyLoadedLimit
                ? page.nextCursor
                    ? { before: page.nextCursor, since: page.windowSince }
                    : undefined
                : undefined,
        enabled: enabled && !privateError(policyQuery.error),
        refetchInterval: enabled ? HOST_MONITORING_UI.pollIntervalMs : false,
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        retry: (count, error) => !privateError(error) && count < 2,
    })
    const forbidden =
        !canView ||
        accessRevoked ||
        privateError(policyQuery.error) ||
        privateError(historyQuery.error)
    // oxlint-disable react/set-state-in-effect -- Latch server authorization failures so focus/reconnect cannot restart private polling.
    useEffect(() => {
        if (privateError(policyQuery.error) || privateError(historyQuery.error))
            setAccessRevoked(true)
    }, [policyQuery.error, historyQuery.error])
    // oxlint-enable react/set-state-in-effect
    const policy = forbidden || policyQuery.isError ? null : (policyQuery.data ?? null)
    const defaultSettings = useMemo<HostMonitoringSettings>(
        () => ({ ...HOST_MONITORING_DEFAULTS, domain: domains[0]?.value ?? '' }),
        [domains],
    )
    const [draftDefaults, setDraftDefaults] = useState(defaultSettings)
    const mutation = useMutation({
        mutationFn: (input: Parameters<typeof saveHostMonitoringPolicy>[0]) =>
            saveHostMonitoringPolicy(input),
        onSuccess: async (saved) => {
            queryClient.setQueryData(hostMonitoringQueryKeys.policy(props.host.id), saved)
            baseVersion.current = saved.version
            setDraftDefaults(saved.settings)
            form.reset(saved.settings)
            setConflict(false)
            setNotice(t('admin.hostMonitoring.saved'))
            await queryClient.invalidateQueries({ queryKey: hostMonitoringQueryKeys.all })
        },
        onError: (error) => {
            if (error instanceof HostMonitoringClientError && error.code === 'conflict') {
                setConflict(true)
                setNotice(t('admin.hostMonitoring.conflict'))
            } else {
                setNotice(t('admin.hostMonitoring.saveError'))
            }
            if (privateError(error)) {
                setAccessRevoked(true)
                queryClient.removeQueries({ queryKey: hostMonitoringQueryKeys.all })
                setReady(false)
            }
        },
    })
    const form = useForm({
        defaultValues: draftDefaults,
        validators: {
            onChange: ({ value }) =>
                hostMonitoringSettingsSchema.safeParse(value).success
                    ? undefined
                    : t('admin.hostMonitoring.invalid'),
        },
        onSubmit: ({ value }) => {
            if (
                !canUpdate ||
                forbidden ||
                !ready ||
                conflict ||
                mutation.isPending ||
                !domains.some((domain) => domain.value === value.domain)
            )
                return
            const parsed = hostMonitoringSettingsSchema.safeParse(value)
            if (!parsed.success) {
                setNotice(t('admin.hostMonitoring.invalid'))
                return
            }
            mutation.mutate({
                proxyHostId: props.host.id,
                expectedVersion: baseVersion.current,
                settings: parsed.data,
            })
        },
    })
    const dirty = useStore(form.store, (snapshot) => snapshot.isDirty)
    const values = useStore(form.store, (snapshot) => snapshot.values)
    const valid =
        hostMonitoringSettingsSchema.safeParse(values).success &&
        domains.some((domain) => domain.value === values.domain)
    // oxlint-disable react/set-state-in-effect -- Synchronize the explicit TanStack Form draft with query versions, preserving dirty edits and erasing private values on permission loss.
    useEffect(() => {
        if (!props.open || forbidden) {
            draftOwner.current = ''
            setReady(false)
            const cleared = { ...HOST_MONITORING_DEFAULTS, domain: '' }
            setDraftDefaults(cleared)
            form.reset(cleared)
            return
        }
        if (!policyQuery.isSuccess) return
        if (draftOwner.current === props.host.id) {
            if (dirty) {
                if (baseVersion.current !== (policyQuery.data?.version ?? null)) setConflict(true)
                return
            }
            if (baseVersion.current === (policyQuery.data?.version ?? null)) return
        }
        draftOwner.current = props.host.id
        baseVersion.current = policyQuery.data?.version ?? null
        const nextDefaults = policyQuery.data?.settings ?? {
            ...HOST_MONITORING_DEFAULTS,
            domain: props.host.domains.find((domain) => !domain.startsWith('*.')) ?? '',
        }
        setDraftDefaults(nextDefaults)
        form.reset(nextDefaults)
        setReady(true)
        setConflict(false)
        setNotice('')
    }, [
        props.open,
        props.host.id,
        props.host.domains,
        forbidden,
        policyQuery.isSuccess,
        policyQuery.data,
        form,
        dirty,
    ])
    // oxlint-enable react/set-state-in-effect
    const pages = forbidden || historyQuery.isError ? [] : (historyQuery.data?.pages ?? [])
    const observations = pages
        .flatMap((page) => page.observations)
        .slice(0, HOST_MONITORING_UI.historyLoadedLimit)
    const incidents = [
        ...new Map(
            pages.flatMap((page) => page.incidents).map((incident) => [incident.id, incident]),
        ).values(),
    ]
    const plot = durationPlot(observations)
    const formatter = useMemo(
        () => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'medium' }),
        [locale],
    )
    const handler: MonitoringDialogHandler = {
        handleOpenChange: (open) => {
            if (!mutation.isPending && (!dirty || open || forbidden)) props.onOpenChange(open)
        },
        handleTab: setTab,
        handleTabKey: (event) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
            event.preventDefault()
            const next =
                event.key === 'Home'
                    ? 'overview'
                    : event.key === 'End'
                      ? 'settings'
                      : tab === 'overview'
                        ? 'settings'
                        : 'overview'
            setTab(next)
            document.getElementById(`${id}-tab-${next}`)?.focus()
        },
        handleRetry: () => {
            void policyQuery.refetch()
            void historyQuery.refetch()
        },
        handleStatus: (value) => {
            if (
                value === 'all' ||
                value === 'healthy' ||
                value === 'unhealthy' ||
                value === 'unknown'
            )
                setStatus(value)
        },
        handlePeriod: (value) => {
            if (value === 'recent' || value === 'hour' || value === 'day' || value === 'week') {
                setPeriod(value)
            }
        },
        handleMore: () => {
            if (historyQuery.hasNextPage && !historyQuery.isFetchingNextPage)
                void historyQuery.fetchNextPage()
        },
        handleReload: () => {
            if (forbidden) {
                setDraftDefaults(defaultSettings)
                form.reset(defaultSettings)
                return
            }
            void policyQuery.refetch().then((result) => {
                if (
                    !result.isSuccess ||
                    !session.current.open ||
                    !session.current.canView ||
                    session.current.hostId !== props.host.id
                )
                    return
                baseVersion.current = result.data?.version ?? null
                const nextDefaults = result.data?.settings ?? defaultSettings
                setDraftDefaults(nextDefaults)
                form.reset(nextDefaults)
                setConflict(false)
                setNotice('')
            })
        },
        handleDiscard: () => {
            if (mutation.isPending) return
            if (forbidden) setDraftDefaults(defaultSettings)
            form.reset(forbidden ? defaultSettings : draftDefaults)
            setConflict(false)
            setNotice('')
        },
        handleSubmit: (event) => {
            event.preventDefault()
            event.stopPropagation()
            void form.handleSubmit()
        },
        formatDate: (date) => (date ? formatter.format(date) : '—'),
    }
    const state: MonitoringDialogState = {
        canView: !forbidden,
        canUpdate: canUpdate && !forbidden,
        tab,
        id,
        locale,
        domains,
        policy,
        loading: enabled && policyQuery.isPending,
        error: policyQuery.isError,
        historyError: historyQuery.isError,
        historyLoading: historyQuery.isPending,
        observations,
        incidents,
        plot,
        status,
        period,
        more: Boolean(historyQuery.hasNextPage),
        capped:
            pages.length * HOST_MONITORING_UI.historyPageLimit >=
                HOST_MONITORING_UI.historyLoadedLimit && Boolean(pages.at(-1)?.nextCursor),
        loadingMore: historyQuery.isFetchingNextPage,
        pending: mutation.isPending,
        dirty,
        valid,
        conflict,
        notice,
        ready,
        numericFields: [
            { name: 'intervalSeconds', min: 30, max: 86_400 },
            { name: 'timeoutMs', min: 1_000, max: 10_000 },
            { name: 'expectedStatus', min: 100, max: 599 },
            { name: 'failureThreshold', min: 1, max: 20 },
            { name: 'recoveryThreshold', min: 1, max: 20 },
            { name: 'retentionDays', min: 1, max: 30 },
            { name: 'sampleLimit', min: 10, max: 10_000 },
            { name: 'incidentLimit', min: 1, max: 1_000 },
        ],
    }
    return { state, handler, form }
}
