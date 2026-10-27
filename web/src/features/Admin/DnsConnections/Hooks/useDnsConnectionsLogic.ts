import { dnsProviderForId, supportsDns01, supportsDdns } from '@/lib/DnsConnections/dnsProviders.ts'
import type { DnsProviderId } from '@/lib/DnsConnections/Types/dns-provider.types.ts'
import useQuickAction from '@/shared/QuickActions/Hooks/useQuickActions.ts'
import { useForm } from '@tanstack/react-form'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useRef, useState, useEffect, type FormEvent } from 'react'
import { toast } from '@rentnerkev/toasts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { MAX_DNS_CONNECTION_ZONES } from '@/config/dns-connections.config.ts'
import { DNS_CONNECTION_LIVE_QUERY_KEYS } from '@/config/ddns.config.ts'
import type { DnsZone, DnsConnection } from '@/lib/DnsConnections/Types/dns-connections.types.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import useLiveInvalidation from '@/shared/Live/Hooks/useLiveInvalidation.ts'
import useQueryRecovery from '@/shared/Live/Hooks/useQueryRecovery.ts'
import {
    deleteDnsConnectionHandler,
    getDnsConnectionsHandler,
    getDnsConnectionProvidersHandler,
    saveDnsConnectionHandler,
    testDnsConnectionHandler,
    verifyDnsConnectionHandler,
} from '../middleware.ts'
import { saveDnsConnectionSchema, testDnsConnectionSchema } from '../validation.ts'
import type { DnsConnectionsPageProps } from '../Types/dns-connections-ui.types.ts'

export default function useDnsConnectionsLogic({
    permissions,
    liveEnabled = true,
}: DnsConnectionsPageProps) {
    const { t } = useTranslationStore()
    const queryClient = useQueryClient()
    const formId = useId()
    const canView = permissions.includes(PERMISSIONS.DNS_CONNECTIONS_VIEW)
    const canManage = permissions.includes(PERMISSIONS.DNS_CONNECTIONS_MANAGE)
    const [providerId, setProviderId] = useState<DnsProviderId>('cloudflare')
    const [editorOpen, setEditorOpen] = useState(false)
    const [editing, setEditing] = useState<DnsConnection | null>(null)
    const [deleteTarget, setDeleteTarget] = useState<DnsConnection | null>(null)
    const [zones, setZones] = useState<readonly DnsZone[]>([])
    const [isPending, setIsPending] = useState(false)
    const pending = useRef(false)
    const connectionsQuery = useQuery({
        queryKey: ['dns-connections'],
        queryFn: () => getDnsConnectionsHandler(),
        enabled: canView,
        retry: false,
    })
    const providersQuery = useQuery({
        queryKey: ['dns-providers', 'connections'],
        queryFn: () => getDnsConnectionProvidersHandler(),
        enabled: canView,
        retry: false,
    })
    useQueryRecovery(providersQuery, canView)
    useQueryRecovery(connectionsQuery, canView)
    useLiveInvalidation({
        topic: 'dns-connections',
        query: {},
        enabled: canView && liveEnabled,
        queryKeys: DNS_CONNECTION_LIVE_QUERY_KEYS,
    })
    useEffect(() => {
        if (connectionsQuery.isError) {
            toast.error(t('admin.dnsConnections.errors.controller_unavailable'), {
                title: t('toast.titles.error'),
                dedupeKey: 'dns-connections-read',
            })
        }
    }, [connectionsQuery.isError, t])
    async function invalidate(saved?: DnsConnection, removedId?: string, verified = false) {
        await Promise.all(
            DNS_CONNECTION_LIVE_QUERY_KEYS.map((queryKey) =>
                queryClient.cancelQueries({ queryKey }, { revert: false }),
            ),
        )
        if (saved)
            queryClient.setQueryData<readonly DnsConnection[]>(['dns-connections'], (current) => {
                const latest = current?.find((item) => item.id === saved.id)
                if (latest && latest.revision >= saved.revision) {
                    if (
                        !verified ||
                        latest.revision !== saved.revision ||
                        !saved.verification?.checkedAt ||
                        (latest.verification?.checkedAt &&
                            Date.parse(latest.verification.checkedAt) >
                                Date.parse(saved.verification.checkedAt))
                    )
                        return current
                    return current?.map((item) =>
                        item.id === saved.id ? { ...item, verification: saved.verification } : item,
                    )
                }
                return [...(current ?? []).filter((item) => item.id !== saved.id), saved]
            })
        if (removedId)
            queryClient.setQueryData<readonly DnsConnection[]>(['dns-connections'], (current) =>
                current?.filter((item) => item.id !== removedId),
            )
        await Promise.all(
            DNS_CONNECTION_LIVE_QUERY_KEYS.map((queryKey) =>
                queryClient.invalidateQueries({ queryKey }),
            ),
        )
    }
    const currentEditing = connectionsQuery.data?.find(
        (connection) => connection.id === editing?.id,
    )
    const isStale =
        !!editing &&
        (!currentEditing ||
            currentEditing.revision !== editing.revision ||
            JSON.stringify(currentEditing.references) !== JSON.stringify(editing.references))
    const lockedZoneIds = new Set(
        [...(editing?.references ?? []), ...(currentEditing?.references ?? [])].map(
            (reference) => reference.zoneId,
        ),
    )
    const unavailable = connectionsQuery.isError || (canView && connectionsQuery.isPending)
    const selectedProvider = providersQuery.isError
        ? undefined
        : dnsProviderForId(providersQuery.data ?? [], providerId)
    const providerUnavailable = !selectedProvider
    const locked = isPending || unavailable
    useEffect(() => {
        if (editorOpen && isStale)
            toast.info(t('admin.dnsConnections.messages.changed'), {
                title: t('toast.titles.info'),
            })
    }, [editorOpen, isStale, t])
    const fail = (key: string) => toast.error(t(key), { title: t('toast.titles.error') })
    const success = (key: string) => toast.success(t(key), { title: t('toast.titles.success') })
    const form = useForm({
        defaultValues: {
            name: editing?.name ?? '',
            apiToken: '',
            zoneIds: editing?.zones.map((zone) => zone.id) ?? ([] as string[]),
        },
        onSubmit: async ({ value }) => {
            if (!canManage || pending.current || unavailable) return
            if (!selectedProvider) {
                fail('admin.dnsConnections.providers.unavailable')
                return
            }
            if (isStale) {
                fail('admin.dnsConnections.messages.changed')
                return
            }
            const parsed = saveDnsConnectionSchema.safeParse({
                provider: selectedProvider.id,
                name: value.name,
                apiToken: value.apiToken || undefined,
                zoneIds: value.zoneIds,
                connectionId: editing?.id,
                expectedRevision: editing?.revision ?? 0,
            })
            if (!parsed.success) {
                fail(parsed.error.issues[0]?.message ?? 'admin.dnsConnections.errors.invalid_input')
                return
            }
            pending.current = true
            setIsPending(true)
            try {
                const result = await saveDnsConnectionHandler({ data: parsed.data })
                if (!result.success) {
                    fail(result.message)
                    await invalidate()
                    return
                }
                form.reset()
                setEditorOpen(false)
                setEditing(null)
                setZones([])
                success(result.message)
                await invalidate(result.connection)
                if (result.connection.verification?.status !== 'connected')
                    await verifyConnection(result.connection)
            } catch {
                fail('admin.dnsConnections.errors.requestFailed')
            } finally {
                pending.current = false
                setIsPending(false)
            }
        },
    })
    async function verifyConnection(connection: DnsConnection) {
        const result = await verifyDnsConnectionHandler({
            data: {
                connectionId: connection.id,
                expectedRevision: connection.revision,
            },
        })
        if (!result.success) {
            fail(result.message)
            return
        }
        if (result.connection.verification?.status === 'connected')
            success('admin.providers.verified')
        else
            fail(
                `admin.dnsConnections.errors.${result.connection.verification?.error ?? 'provider_unavailable'}`,
            )
        await invalidate(result.connection, undefined, true)
    }
    async function handleVerify(connection: DnsConnection) {
        if (!canManage || pending.current || unavailable) return
        pending.current = true
        setIsPending(true)
        try {
            await verifyConnection(connection)
        } catch {
            fail('admin.dnsConnections.errors.requestFailed')
        } finally {
            pending.current = false
            setIsPending(false)
        }
    }
    function handleEditorOpenChange(open: boolean) {
        if (pending.current) return
        if (!open) {
            form.reset()
            setEditing(null)
            setZones([])
        }
        setEditorOpen(open)
    }
    function handleCreate() {
        if (!canManage || pending.current || unavailable) return
        setEditing(null)
        form.reset({ name: '', apiToken: '', zoneIds: [] })
        setZones([])
        setEditorOpen(true)
    }
    function handleEdit(connection: DnsConnection) {
        if (!canManage || pending.current || unavailable) return
        setProviderId(connection.provider)
        setEditing(connection)
        form.reset({
            name: connection.name,
            apiToken: '',
            zoneIds: connection.zones.map((zone) => zone.id),
        })
        setZones(connection.zones)
        setEditorOpen(true)
    }
    async function handleTest() {
        if (!canManage || pending.current || unavailable) return
        if (!selectedProvider?.capabilities.zoneDiscovery) {
            fail('admin.dnsConnections.providers.unavailable')
            return
        }
        const parsed = testDnsConnectionSchema.safeParse({
            provider: selectedProvider.id,
            connectionId: editing?.id,
            apiToken: form.getFieldValue('apiToken') || undefined,
            zoneIds: [],
        })
        if (!parsed.success) {
            fail(parsed.error.issues[0]?.message ?? 'admin.dnsConnections.validation.token')
            return
        }
        pending.current = true
        setIsPending(true)
        try {
            const result = await testDnsConnectionHandler({ data: parsed.data })
            if (!result.success) {
                fail(result.message)
                return
            }
            const selected = new Set(form.getFieldValue('zoneIds'))
            const merged = new Map(
                zones.filter((zone) => selected.has(zone.id)).map((zone) => [zone.id, zone]),
            )
            for (const zone of result.result.zones) merged.set(zone.id, zone)
            setZones([...merged.values()])
            success(result.message)
        } catch {
            fail('admin.dnsConnections.errors.requestFailed')
        } finally {
            pending.current = false
            setIsPending(false)
        }
    }
    function handleZoneChange(id: string, selected: boolean) {
        if (pending.current || lockedZoneIds.has(id)) return
        const ids = form.getFieldValue('zoneIds')
        if (selected && ids.length >= MAX_DNS_CONNECTION_ZONES) {
            fail('admin.dnsConnections.validation.zones')
            return
        }
        form.setFieldValue(
            'zoneIds',
            selected ? [...new Set([...ids, id])] : ids.filter((value) => value !== id),
        )
    }
    async function handleConfirmDelete() {
        if (
            !canManage ||
            !deleteTarget ||
            pending.current ||
            unavailable ||
            deleteTarget.references.length
        )
            return
        const current = connectionsQuery.data?.find(
            (connection) => connection.id === deleteTarget.id,
        )
        if (!current || current.revision !== deleteTarget.revision || current.references.length) {
            fail(
                current?.references.length
                    ? 'admin.dnsConnections.errors.connection_in_use'
                    : 'admin.dnsConnections.errors.connection_conflict',
            )
            setDeleteTarget(null)
            return
        }
        pending.current = true
        setIsPending(true)
        try {
            const result = await deleteDnsConnectionHandler({
                data: { connectionId: deleteTarget.id, expectedRevision: deleteTarget.revision },
            })
            if (!result.success) fail(result.message)
            else success(result.message)
            setDeleteTarget(null)
            await invalidate(undefined, result.success ? deleteTarget.id : undefined)
        } catch {
            fail('admin.dnsConnections.errors.requestFailed')
        } finally {
            pending.current = false
            setIsPending(false)
        }
    }
    useQuickAction('createDnsConnection', handleCreate, !connectionsQuery.isPending)
    return {
        state: {
            canManage,
            connections: connectionsQuery.data ?? [],
            isLoading: canView && connectionsQuery.isPending,
            isError: connectionsQuery.isError,
            isPending,
            locked,
            providerUnavailable,
            canDiscoverZones: selectedProvider?.capabilities.zoneDiscovery === true,
            providerId,
            providerOptions: (providersQuery.isError ? [] : (providersQuery.data ?? [])).map(
                (provider) => ({
                    value: provider.id,
                    label: t(`admin.dnsConnections.providers.${provider.id}`),
                }),
            ),
            supportsCertificates: supportsDns01(selectedProvider),
            supportsIpv4: supportsDdns(selectedProvider, 'A'),
            supportsIpv6: supportsDdns(selectedProvider, 'AAAA'),
            supportsProxy: selectedProvider?.capabilities.proxyOptions === 'cloudflare',
            isStale,
            editorOpen,
            editing,
            deleteTarget,
            zones,
            lockedZoneIds,
            formId,
        },
        handler: {
            handleProviderChange: (id: DnsProviderId) => {
                if (!editing && !pending.current && id !== providerId) {
                    setProviderId(id)
                    form.setFieldValue('apiToken', '')
                    form.setFieldValue('zoneIds', [])
                    setZones([])
                }
            },
            handleCreate,
            handleEdit,
            handleEditorOpenChange,
            handleDelete: (connection: DnsConnection) => {
                if (canManage && !pending.current && !unavailable && !connection.references.length)
                    setDeleteTarget(connection)
            },
            handleDeleteOpenChange: (open: boolean) => {
                if (!open && !pending.current) setDeleteTarget(null)
            },
            handleConfirmDelete,
            handleVerify,
            handleSubmit: (event: FormEvent<HTMLFormElement>) => {
                event.preventDefault()
                event.stopPropagation()
                void form.handleSubmit()
            },
            handleTest: () => {
                void handleTest()
            },
            handleZoneChange,
        },
        form,
    }
}
