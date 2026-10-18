import { toast } from '@rentnerkev/toasts'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import {
    DDNS_QUERY_KEYS,
    DDNS_LIVE_QUERY_KEYS,
    DNS_CONNECTION_LIVE_QUERY_KEYS,
} from '@/config/ddns.config.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { activeDdnsTarget, ddnsDraft } from '@/lib/Ddns/targets.ts'
import { editableDdnsRecordDraft, withDdnsRecordFamilies } from '@/lib/Ddns/recordFamilies.ts'
import type { DdnsDraft, DdnsSnapshot, DdnsTarget } from '@/lib/Ddns/Types/ddns.types.ts'
import useTranslationStore, {
    useDateTimeFormatter,
} from '@/shared/Language/Hooks/useTranslationStore.ts'
import useLiveInvalidation from '@/shared/Live/Hooks/useLiveInvalidation.ts'
import useQueryRecovery from '@/shared/Live/Hooks/useQueryRecovery.ts'
import type { DdnsPageProps, DdnsResponse } from '../Types/ddns-ui.types.ts'
import type { DdnsRecordEditorContext, DdnsDeletionContext } from '../Types/ddns-editor.types.ts'

function unwrap<T>(response: DdnsResponse<T>): T {
    if (!response.success) throw new Error(response.message)
    return response.value
}
export default function useDdnsLogic({ permissions, api, liveEnabled = true }: DdnsPageProps) {
    const queryClient = useQueryClient()
    const { t } = useTranslationStore()
    const formatter = useDateTimeFormatter()
    const canView = permissions.includes(PERMISSIONS.DDNS_VIEW)
    const canManage = permissions.includes(PERMISSIONS.DDNS_MANAGE)
    const canChooseConnection = canManage && permissions.includes(PERMISSIONS.DNS_CONNECTIONS_VIEW)
    const [recordEditor, setRecordEditor] = useState<DdnsRecordEditorContext | null>(null)
    const [settingsEditor, setSettingsEditor] = useState<Omit<
        DdnsRecordEditorContext,
        'target'
    > | null>(null)
    const [deletion, setDeletion] = useState<DdnsDeletionContext | null>(null)
    const [isPending, setIsPending] = useState(false)
    const [runtimeDetails, setRuntimeDetails] = useState(false)
    const pending = useRef(false)
    const statusQuery = useQuery({
        queryKey: DDNS_QUERY_KEYS.status,
        queryFn: api.status,
        enabled: canView,
        retry: false,
    })
    const connectionsQuery = useQuery({
        queryKey: DDNS_QUERY_KEYS.connections,
        queryFn: api.connections,
        enabled: canChooseConnection,
        retry: false,
    })
    useQueryRecovery(statusQuery, canView)
    useQueryRecovery(connectionsQuery, canChooseConnection)
    useLiveInvalidation({
        topic: 'ddns',
        query: {},
        enabled: canView && liveEnabled,
        queryKeys: DDNS_LIVE_QUERY_KEYS,
    })
    useLiveInvalidation({
        topic: 'dns-connections',
        query: {},
        enabled: canChooseConnection && liveEnabled,
        queryKeys: DNS_CONNECTION_LIVE_QUERY_KEYS,
    })
    useEffect(() => {
        if (statusQuery.isError) {
            toast.error(t('admin.ddns.errors.controller_unavailable'), {
                title: t('toast.titles.error'),
                dedupeKey: 'ddns-status-read',
            })
        }
    }, [statusQuery.isError, t])
    useEffect(() => {
        if (connectionsQuery.isError) {
            toast.error(t('admin.ddns.errors.connection_unavailable'), {
                title: t('toast.titles.error'),
                dedupeKey: 'ddns-connections-read',
            })
        }
    }, [connectionsQuery.isError, t])
    const snapshot = statusQuery.data
    const settings = snapshot?.configuration?.settings
    const revision = snapshot?.configuration?.revision ?? 0
    const draft = editableDdnsRecordDraft(ddnsDraft(settings))
    const available = !!snapshot && !statusQuery.isError
    const locked = isPending || !available || !!snapshot?.inFlight
    const editorRevision = recordEditor?.revision ?? settingsEditor?.revision
    const stale = editorRevision !== undefined && editorRevision !== revision
    useEffect(() => {
        if (stale) toast.info(t('admin.ddns.messages.changed'), { title: t('toast.titles.info') })
    }, [stale, t])
    const date = (value: number | null | undefined) =>
        value == null ? t('admin.ddns.states.never') : formatter.format(new Date(value * 1000))
    const rows = draft.targets.map((target) => {
        const connection = connectionsQuery.data?.find((item) => item.id === target.connectionId)
        const status = snapshot?.targets.find((item) => item.targetId === target.id)
        return {
            target,
            connectionLabel: connection?.name ?? t('admin.ddns.records.savedConnection'),
            zone:
                connection?.zones.find((zone) => zone.id === target.zoneId)?.name ??
                target.name.replace(/^\*\./u, ''),
            address: status?.lastSuccessfulAddress ?? '—',
            lastSuccess: date(status?.lastSuccessAt),
            nextAttempt: date(
                settings?.enabled && activeDdnsTarget(draft, target) ? status?.nextAttemptAt : null,
            ),
            error: status?.lastResult?.error ?? null,
            statusKey: !target.enabled
                ? 'targetPaused'
                : !activeDdnsTarget(draft, target)
                  ? 'familyPaused'
                  : snapshot?.inFlight?.targetIds.includes(target.id)
                    ? 'running'
                    : !settings?.enabled
                      ? 'disabled'
                      : status?.permanentFailure
                        ? 'attention'
                        : (status?.lastResult?.status ?? 'notAttempted'),
        }
    })
    async function run(operation: () => Promise<void>) {
        if (pending.current || !canManage) return
        pending.current = true
        setIsPending(true)
        try {
            await operation()
        } catch (error) {
            const message = error instanceof Error ? error.message : ''
            toast.error(
                t(
                    /^(admin\.ddns\.(errors|validation|recordErrors)\.[a-zA-Z_]+|errors\.[a-zA-Z_]+)$/u.test(
                        message,
                    )
                        ? message
                        : 'admin.ddns.errors.requestFailed',
                ),
                { title: t('toast.titles.error') },
            )
            void queryClient.invalidateQueries({ queryKey: DDNS_QUERY_KEYS.status })
        } finally {
            pending.current = false
            setIsPending(false)
        }
    }
    async function accept(updated: DdnsSnapshot, message: string) {
        await queryClient.cancelQueries({ queryKey: DDNS_QUERY_KEYS.status }, { revert: false })
        queryClient.setQueryData<DdnsSnapshot>(DDNS_QUERY_KEYS.status, (current) => {
            // A live read may already include a later edit or worker result.
            const responseRevision = updated.configuration?.revision ?? 0
            return current && (current.configuration?.revision ?? 0) >= responseRevision
                ? current
                : updated
        })
        setRecordEditor(null)
        setSettingsEditor(null)
        setDeletion(null)
        toast.success(t(message), { title: t('toast.titles.success') })
        void queryClient.invalidateQueries({ queryKey: ['dns-connections'] })
    }
    async function apply(
        candidate: DdnsDraft,
        expectedRevision: number,
        message: string,
        enabled = settings ? settings.enabled : !snapshot?.restorePaused,
    ) {
        if (locked) return
        const prepared = withDdnsRecordFamilies(candidate)
        await run(async () =>
            accept(
                unwrap(
                    await api.apply({
                        expectedRevision,
                        draft: prepared,
                        enabled:
                            enabled &&
                            prepared.targets.length > 0 &&
                            (!!settings?.enabled ||
                                prepared.targets.some((target) =>
                                    activeDdnsTarget(prepared, target),
                                )),
                    }),
                ),
                message,
            ),
        )
    }
    return {
        state: {
            canView,
            canManage,
            canChooseConnection,
            isPending,
            runtimeDetails,
            locked,
            available,
            isLoading: statusQuery.isPending && canView,
            snapshot,
            settings,
            rows,
            connections: connectionsQuery.data ?? [],
            recordEditor,
            settingsEditor,
            deleteTarget: deletion?.target ?? null,
            stale,
            canEnable:
                !settings?.enabled &&
                draft.targets.some((target) => activeDdnsTarget(draft, target)),
            hasActiveTargets: draft.targets.some((target) => activeDdnsTarget(draft, target)),
            discoveredIpv4: snapshot?.targets.find((target) =>
                target.lastSuccessfulAddress?.includes('.'),
            )?.lastSuccessfulAddress,
            discoveredIpv6: snapshot?.targets.find((target) =>
                target.lastSuccessfulAddress?.includes(':'),
            )?.lastSuccessfulAddress,
            providerRetry: date(snapshot?.providerNotBefore),
            lastRun: date(snapshot?.lastRun?.finishedAt),
        },
        handler: {
            toggleRuntimeDetails: () => setRuntimeDetails((expanded) => !expanded),
            add: () => {
                if (!locked && canChooseConnection)
                    setRecordEditor({ draft, revision, target: null })
            },
            edit: (target: DdnsTarget) => {
                if (!locked && canManage) setRecordEditor({ draft, revision, target })
            },
            editSettings: () => {
                if (!locked && canManage) setSettingsEditor({ draft, revision })
            },
            closeRecord: () => {
                if (!pending.current) setRecordEditor(null)
            },
            closeSettings: () => {
                if (!pending.current) setSettingsEditor(null)
            },
            saveRecord: (next: DdnsDraft, base: number) =>
                apply(next, base, 'admin.ddns.messages.recordSaved'),
            saveSettings: (next: DdnsDraft, base: number) =>
                apply(next, base, 'admin.ddns.messages.settingsSaved'),
            toggle: (target: DdnsTarget) => {
                if (!locked)
                    void apply(
                        {
                            ...draft,
                            targets: draft.targets.map((item) =>
                                item.id === target.id ? { ...item, enabled: !item.enabled } : item,
                            ),
                        },
                        revision,
                        target.enabled
                            ? 'admin.ddns.messages.recordDisabled'
                            : 'admin.ddns.messages.recordEnabled',
                    )
            },
            askDelete: (target: DdnsTarget) => {
                if (!locked && canManage) setDeletion({ target, revision })
            },
            closeDelete: (open: boolean) => {
                if (!open && !pending.current) setDeletion(null)
            },
            confirmDelete: () => {
                if (deletion && !locked) {
                    const latest = queryClient.getQueryData<DdnsSnapshot>(DDNS_QUERY_KEYS.status)
                    if (deletion.revision !== (latest?.configuration?.revision ?? revision)) {
                        setDeletion(null)
                        toast.info(t('admin.ddns.messages.actionChanged'), {
                            title: t('toast.titles.info'),
                        })
                        return
                    }
                    void apply(
                        {
                            ...draft,
                            targets: draft.targets.filter((item) => item.id !== deletion.target.id),
                        },
                        deletion.revision,
                        'admin.ddns.messages.recordDeleted',
                    )
                }
            },
            enable: () => {
                if (!locked) void apply(draft, revision, 'admin.ddns.messages.enabled', true)
            },
            disable: () => {
                if (!isPending && available)
                    void run(async () =>
                        accept(
                            unwrap(await api.disable({ expectedRevision: revision })),
                            'admin.ddns.messages.disabled',
                        ),
                    )
            },
            sync: () => {
                if (
                    !locked &&
                    settings?.enabled &&
                    draft.targets.some((target) => activeDdnsTarget(draft, target))
                )
                    void run(async () => {
                        const batch = unwrap(await api.sync({ expectedRevision: revision }))
                        const partial = batch.targets.some(
                            (target) =>
                                target.status === 'failed' ||
                                (target.error !== null &&
                                    !['family_disabled', 'target_disabled'].includes(target.error)),
                        )
                        const message = partial
                            ? 'admin.ddns.messages.partial'
                            : batch.targets.some((target) => target.status === 'updated')
                              ? 'admin.ddns.messages.synced'
                              : 'admin.ddns.messages.unchanged'
                        toast[partial ? 'warning' : 'success'](t(message), {
                            title: t(partial ? 'toast.titles.warning' : 'toast.titles.success'),
                        })
                        await queryClient.invalidateQueries({ queryKey: DDNS_QUERY_KEYS.status })
                    })
            },
        },
    }
}
