import { useForm } from '@tanstack/react-form'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useRef, useState, useEffect, type FormEvent } from 'react'
import { toast } from '@rentnerkev/toasts/toast'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { MAX_DNS_CONNECTION_ZONES } from '@/config/dns-connections.config.ts'
import { DNS_CONNECTION_LIVE_QUERY_KEYS } from '@/config/ddns.config.ts'
import type {
    CloudflareZone,
    DnsConnection,
} from '@/lib/DnsConnections/Types/dns-connections.types.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import useLiveInvalidation from '@/shared/Live/Hooks/useLiveInvalidation.ts'
import useQueryErrorToast from '@/shared/Notifications/Hooks/useQueryErrorToast.ts'
import {
    deleteDnsConnectionHandler,
    getDnsConnectionsHandler,
    saveDnsConnectionHandler,
    testDnsConnectionHandler,
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
    const [editorOpen, setEditorOpen] = useState(false)
    const [editing, setEditing] = useState<DnsConnection | null>(null)
    const [deleteTarget, setDeleteTarget] = useState<DnsConnection | null>(null)
    const [zones, setZones] = useState<readonly CloudflareZone[]>([])
    const [isPending, setIsPending] = useState(false)
    const pending = useRef(false)
    const connectionsQuery = useQuery({
        queryKey: ['dns-connections'],
        queryFn: () => getDnsConnectionsHandler(),
        enabled: canView,
        retry: false,
    })
    useLiveInvalidation({
        topic: 'dns-connections',
        query: {},
        enabled: canView && liveEnabled,
        queryKeys: DNS_CONNECTION_LIVE_QUERY_KEYS,
    })
    useQueryErrorToast(
        connectionsQuery.isError,
        'admin.dnsConnections.errors.controller_unavailable',
    )
    const invalidate = () =>
        Promise.all(
            DNS_CONNECTION_LIVE_QUERY_KEYS.map((queryKey) =>
                queryClient.invalidateQueries({ queryKey }),
            ),
        )
    const isStale =
        !!editing &&
        !connectionsQuery.data?.some(
            (connection) =>
                connection.id === editing.id && connection.revision === editing.revision,
        )
    const lockedZoneIds = new Set(editing?.references.map((reference) => reference.zoneId) ?? [])
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
            if (!canManage || pending.current) return
            if (isStale) {
                fail('admin.dnsConnections.messages.changed')
                return
            }
            const parsed = saveDnsConnectionSchema.safeParse({
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
                await invalidate()
            } catch {
                fail('admin.dnsConnections.errors.requestFailed')
            } finally {
                pending.current = false
                setIsPending(false)
            }
        },
    })
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
        if (!canManage || pending.current) return
        setEditing(null)
        form.reset({ name: '', apiToken: '', zoneIds: [] })
        setZones([])
        setEditorOpen(true)
    }
    function handleEdit(connection: DnsConnection) {
        if (!canManage || pending.current) return
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
        if (!canManage || pending.current) return
        const parsed = testDnsConnectionSchema.safeParse({
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
        if (!canManage || !deleteTarget || pending.current || deleteTarget.references.length) return
        pending.current = true
        setIsPending(true)
        try {
            const result = await deleteDnsConnectionHandler({
                data: { connectionId: deleteTarget.id, expectedRevision: deleteTarget.revision },
            })
            if (!result.success) fail(result.message)
            else success(result.message)
            setDeleteTarget(null)
            await invalidate()
        } catch {
            fail('admin.dnsConnections.errors.requestFailed')
        } finally {
            pending.current = false
            setIsPending(false)
        }
    }
    return {
        state: {
            canManage,
            connections: connectionsQuery.data ?? [],
            isLoading: canView && connectionsQuery.isPending,
            isError: connectionsQuery.isError,
            isPending,
            isStale,
            editorOpen,
            editing,
            deleteTarget,
            zones,
            lockedZoneIds,
            formId,
        },
        handler: {
            handleCreate,
            handleEdit,
            handleEditorOpenChange,
            handleDelete: (connection: DnsConnection) => {
                if (canManage && !pending.current && !connection.references.length)
                    setDeleteTarget(connection)
            },
            handleDeleteOpenChange: (open: boolean) => {
                if (!open && !pending.current) setDeleteTarget(null)
            },
            handleConfirmDelete,
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
