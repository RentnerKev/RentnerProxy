import { useForm, useStore } from '@tanstack/react-form'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useRef, useState, type FormEvent } from 'react'
import { DDNS_QUERY_KEYS } from '@/config/ddns.config.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import {
    activeDdnsTarget,
    addDdnsDomains,
    approveDdnsInspection,
    ddnsDraft,
    ddnsFingerprint,
} from '@/lib/Ddns/targets.ts'
import { ddnsDraftSchema } from '@/lib/Ddns/validation.ts'
import type { DdnsPreview, DdnsSnapshot } from '@/lib/Ddns/Types/ddns.types.ts'
import useTranslationStore, {
    useDateTimeFormatter,
} from '@/shared/Language/Hooks/useTranslationStore.ts'
import type { DdnsConfirmation, DdnsPageProps, DdnsResponse } from '../Types/ddns-ui.types.ts'

function unwrap<T>(response: DdnsResponse<T>): T {
    if (!response.success) throw new Error(response.message)
    return response.value
}

export default function useDdnsLogic({ permissions, api }: DdnsPageProps) {
    const queryClient = useQueryClient()
    const formId = useId()
    const { t } = useTranslationStore()
    const formatter = useDateTimeFormatter()
    const canView = permissions.includes(PERMISSIONS.DDNS_VIEW)
    const canManage = permissions.includes(PERMISSIONS.DDNS_MANAGE)
    const canChooseConnection = canManage && permissions.includes(PERMISSIONS.DNS_CONNECTIONS_VIEW)
    const [editing, setEditing] = useState(false)
    const [editorDefaults, setEditorDefaults] = useState(ddnsDraft)
    const [baseRevision, setBaseRevision] = useState(0)
    const [connectionId, setConnectionId] = useState('')
    const [zoneId, setZoneId] = useState('')
    const [domains, setDomains] = useState('')
    const [isPending, setIsPending] = useState(false)
    const pending = useRef(false)
    const [error, setError] = useState<string | null>(null)
    const [notice, setNotice] = useState<string | null>(null)
    const [confirmation, setConfirmation] = useState<DdnsConfirmation>(null)
    const [preview, setPreview] = useState<
        (DdnsPreview & { fingerprint: string; revision: number; intent: 'save' | 'enable' }) | null
    >(null)
    const statusQuery = useQuery({
        queryKey: DDNS_QUERY_KEYS.status,
        queryFn: api.status,
        enabled: canView,
        refetchInterval: (query) => (query.state.data?.inFlight ? 1500 : 10_000),
        retry: false,
    })
    const connectionsQuery = useQuery({
        queryKey: DDNS_QUERY_KEYS.connections,
        queryFn: api.connections,
        enabled: canChooseConnection,
        retry: false,
    })
    const snapshot = statusQuery.data
    const revision = snapshot?.configuration?.revision ?? 0
    const settings = snapshot?.configuration?.settings
    const form = useForm({
        defaultValues: editorDefaults,
        onSubmit: () => {
            setConfirmation('save')
        },
    })
    const values = useStore(form.store, (state) => state.values)
    const draft = editing ? values : ddnsDraft(settings)
    const parsed = ddnsDraftSchema.safeParse(draft)
    const fingerprint = parsed.success ? ddnsFingerprint(parsed.data) : null
    const stale = editing && baseRevision !== revision
    const dirty = editing && fingerprint !== ddnsFingerprint(ddnsDraft(settings))
    const selectedConnection = connectionsQuery.data?.find(
        (connection) => connection.id === connectionId,
    )
    const currentPreview =
        preview &&
        preview.fingerprint === fingerprint &&
        preview.revision === revision &&
        preview.intent === (editing ? 'save' : 'enable') &&
        !stale
            ? preview
            : null
    // Polling advances dataUpdatedAt; the service also checks expiry on every mutation.
    const previewReady =
        !!currentPreview?.receipt && (currentPreview.expiresAt ?? 0) > statusQuery.dataUpdatedAt
    const available = !!snapshot && !statusQuery.isError
    const locked = isPending || !available || stale || !!snapshot?.inFlight
    const effectiveConnectionId = selectedConnection?.id ?? ''
    const date = (value: number | null | undefined) =>
        value == null ? t('admin.ddns.states.never') : formatter.format(new Date(value * 1000))
    const rows = draft.targets.map((target) => {
        const connection = connectionsQuery.data?.find((item) => item.id === target.connectionId)
        const status = snapshot?.targets.find((item) => item.targetId === target.id)
        const result = currentPreview?.batch.targets.find((item) => item.targetId === target.id)
        return {
            target,
            connectionLabel: connection?.name ?? t('admin.ddns.records.savedConnection'),
            zone:
                connection?.zones.find((zone) => zone.id === target.zoneId)?.name ??
                target.name.replace(/^\*\./u, ''),
            active: activeDdnsTarget(draft, target),
            status,
            result,
            lastSuccess: date(status?.lastSuccessAt),
            nextAttempt: date(status?.nextAttemptAt),
            lastAttempt: date(status?.lastAttemptAt),
            statusKey: !activeDdnsTarget(draft, target)
                ? 'familyPaused'
                : snapshot?.inFlight?.targetIds.includes(target.id)
                  ? 'running'
                  : status?.permanentFailure
                    ? 'attention'
                    : (status?.lastResult?.status ?? 'notAttempted'),
        }
    })
    async function run(operation: () => Promise<void>) {
        if (pending.current || !canManage) return
        pending.current = true
        setIsPending(true)
        setError(null)
        setNotice(null)
        try {
            await operation()
        } catch (failure) {
            const message = failure instanceof Error ? failure.message : ''
            setError(
                /^(admin\.ddns\.(errors|validation)\.[a-zA-Z_]+|errors\.[a-zA-Z_]+)$/u.test(message)
                    ? message
                    : 'admin.ddns.errors.requestFailed',
            )
        } finally {
            pending.current = false
            setIsPending(false)
        }
    }
    async function requestPreview(candidate = draft) {
        const checked = ddnsDraftSchema.safeParse(candidate)
        if (!checked.success)
            throw new Error(checked.error.issues[0]?.message ?? 'admin.ddns.errors.invalid_input')
        setPreview(null)
        const intent = editing ? 'save' : 'enable'
        const result = unwrap(
            await api.preview({ expectedRevision: revision, draft: checked.data, intent }),
        )
        setPreview({ ...result, fingerprint: ddnsFingerprint(checked.data), revision, intent })
    }
    function accept(updatedSnapshot: DdnsSnapshot, message: string) {
        queryClient.setQueryData(DDNS_QUERY_KEYS.status, updatedSnapshot)
        setPreview(null)
        setConfirmation(null)
        setEditing(false)
        setNotice(message)
        void queryClient.invalidateQueries({ queryKey: ['dns-connections'] })
        void queryClient.invalidateQueries({ queryKey: DDNS_QUERY_KEYS.connections })
    }
    function edit() {
        if (!canManage || locked) return
        const initial = ddnsDraft(settings)
        setEditorDefaults(initial)
        form.reset(initial)
        setBaseRevision(revision)
        setPreview(null)
        setError(null)
        setNotice(null)
        setEditing(true)
    }
    async function confirm() {
        if (confirmation === 'discard') {
            setEditing(false)
            setPreview(null)
            setConfirmation(null)
            setError(null)
            return
        }
        if (locked && !(confirmation === 'disable' && !isPending && available && !stale)) return
        await run(async () => {
            if (confirmation === 'disable')
                accept(
                    unwrap(await api.disable({ expectedRevision: revision })),
                    'admin.ddns.messages.disabled',
                )
            if (confirmation === 'save' || confirmation === 'enable') {
                if (!previewReady || !currentPreview?.receipt)
                    throw new Error('admin.ddns.errors.preview_required')
                if (confirmation === 'save')
                    accept(
                        unwrap(
                            await api.save({
                                expectedRevision: revision,
                                draft,
                                receipt: currentPreview.receipt,
                                confirmedPause: !!settings?.enabled,
                            }),
                        ),
                        'admin.ddns.messages.saved',
                    )
                else
                    accept(
                        unwrap(
                            await api.enable({
                                expectedRevision: revision,
                                receipt: currentPreview.receipt,
                                confirmed: true,
                            }),
                        ),
                        'admin.ddns.messages.enabled',
                    )
            }
        })
        setConfirmation(null)
    }
    return {
        state: {
            formId,
            canView,
            canManage,
            canChooseConnection,
            editing,
            dirty,
            stale,
            isPending,
            locked,
            error,
            notice,
            confirmation,
            snapshot,
            settings,
            draft,
            rows,
            available,
            isLoading: statusQuery.isPending && canView,
            isError: statusQuery.isError,
            connectionsError: connectionsQuery.isError,
            connectionsLoading: connectionsQuery.isPending && canChooseConnection,
            connectionOptions: (connectionsQuery.data ?? []).map((connection) => ({
                value: connection.id,
                label: connection.name,
            })),
            connectionId: effectiveConnectionId,
            zoneId,
            zoneOptions: [
                { value: '', label: t('admin.ddns.form.autoZone') },
                ...(selectedConnection?.zones.map((zone) => ({
                    value: zone.id,
                    label: zone.name,
                })) ?? []),
            ],
            domains,
            currentPreview,
            previewReady,
            canApprove:
                editing &&
                !!currentPreview?.batch.targets.some(
                    (result) =>
                        result.status === 'adoption_required' ||
                        result.status === 'creation_required',
                ),
            canActivate:
                !editing &&
                !!settings &&
                !settings.enabled &&
                draft.targets.some((target) => activeDdnsTarget(draft, target)),
            removedCount: (settings?.targets ?? []).filter(
                (saved) => !draft.targets.some((target) => target.id === saved.id),
            ).length,
            discoveredIpv4:
                currentPreview?.batch.ipv4 ??
                snapshot?.targets.find((target) => target.lastSuccessfulAddress?.includes('.'))
                    ?.lastSuccessfulAddress,
            discoveredIpv6:
                currentPreview?.batch.ipv6 ??
                snapshot?.targets.find((target) => target.lastSuccessfulAddress?.includes(':'))
                    ?.lastSuccessfulAddress,
            providerRetry: date(snapshot?.providerNotBefore),
            lastRun: date(snapshot?.lastRun?.finishedAt),
        },
        handler: {
            edit,
            setDomains,
            changeConnection: (id: string) => {
                setConnectionId(id)
                setZoneId('')
            },
            setZoneId,
            addDomains: () => {
                if (locked || !editing || !selectedConnection) return
                try {
                    const next = addDdnsDomains(
                        form.state.values,
                        selectedConnection,
                        zoneId,
                        domains,
                    )
                    form.setFieldValue('targets', next.targets)
                    setDomains('')
                    setError(null)
                } catch (failure) {
                    setError(
                        failure instanceof Error &&
                            failure.message.startsWith('admin.ddns.validation.')
                            ? failure.message
                            : 'admin.ddns.errors.invalid_input',
                    )
                }
            },
            setProxied: (id: string, proxied: boolean) => {
                if (!locked && editing)
                    form.setFieldValue('targets', (targets) =>
                        targets.map((target) =>
                            target.id === id ? { ...target, proxied } : target,
                        ),
                    )
            },
            remove: (id: string) => {
                if (!locked && editing)
                    form.setFieldValue('targets', (targets) =>
                        targets.filter((target) => target.id !== id),
                    )
            },
            preview: () => {
                if (!locked) void run(() => requestPreview())
            },
            approve: () => {
                if (!locked && editing && currentPreview)
                    void run(async () => {
                        const next = approveDdnsInspection(draft, currentPreview.batch)
                        form.setFieldValue('targets', next.targets)
                        await requestPreview(next)
                    })
            },
            submit: (event: FormEvent<HTMLFormElement>) => {
                event.preventDefault()
                if (!locked && previewReady) void form.handleSubmit()
            },
            askEnable: () => {
                if (!locked && previewReady) setConfirmation('enable')
            },
            askDisable: () => {
                if (!isPending && available && !stale) setConfirmation('disable')
            },
            cancel: () => {
                if (pending.current) return
                if (dirty) setConfirmation('discard')
                else {
                    setEditing(false)
                    setPreview(null)
                    setError(null)
                }
            },
            closeConfirmation: (open: boolean) => {
                if (!open && !pending.current) setConfirmation(null)
            },
            confirm,
            refresh: () => {
                if (pending.current) return
                setError(null)
                void Promise.all([
                    statusQuery.refetch(),
                    ...(canChooseConnection ? [connectionsQuery.refetch()] : []),
                ])
            },
            sync: () => {
                if (!locked && !editing && settings?.enabled)
                    void run(async () => {
                        const batch = unwrap(await api.sync({ expectedRevision: revision }))
                        setNotice(
                            batch.targets.some(
                                (target) =>
                                    target.status === 'failed' ||
                                    (target.error !== null && target.error !== 'family_disabled'),
                            )
                                ? 'admin.ddns.messages.partial'
                                : batch.targets.some((target) => target.status === 'updated')
                                  ? 'admin.ddns.messages.synced'
                                  : 'admin.ddns.messages.unchanged',
                        )
                        await statusQuery.refetch()
                    })
            },
        },
        form,
    }
}
