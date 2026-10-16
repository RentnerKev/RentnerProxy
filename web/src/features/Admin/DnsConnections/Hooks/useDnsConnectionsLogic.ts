import { useForm } from '@tanstack/react-form'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useRef, useState, type FormEvent } from 'react'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { MAX_DNS_CONNECTION_ZONES } from '@/config/dns-connections.config.ts'
import type {
    CloudflareZone,
    DnsConnection,
} from '@/lib/DnsConnections/Types/dns-connections.types.ts'
import {
    deleteDnsConnectionHandler,
    getDnsConnectionsHandler,
    saveDnsConnectionHandler,
    testDnsConnectionHandler,
} from '../middleware.ts'
import { saveDnsConnectionSchema, testDnsConnectionSchema } from '../validation.ts'
import type {
    DnsConnectionsLogicContract,
    DnsConnectionsPageProps,
} from '../Types/dns-connections-ui.types.ts'

export default function useDnsConnectionsLogic({ permissions }: DnsConnectionsPageProps) {
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
    const [error, setError] = useState<string | null>(null)
    const [notice, setNotice] = useState<string | null>(null)
    const connectionsQuery = useQuery({
        queryKey: ['dns-connections'],
        queryFn: () => getDnsConnectionsHandler(),
        enabled: canView,
    })
    const invalidate = () => queryClient.invalidateQueries({ queryKey: ['dns-connections'] })
    const lockedZoneIds = new Set(editing?.references.map((reference) => reference.zoneId) ?? [])

    // Secrets stay in this mounted form only. Query/mutation caches never receive tokens.
    const form = useForm({
        defaultValues: {
            name: editing?.name ?? '',
            apiToken: '',
            zoneIds: editing?.zones.map((zone) => zone.id) ?? ([] as string[]),
        },
        onSubmit: async ({ value }) => {
            if (!canManage || pending.current) return
            setError(null)
            const parsed = saveDnsConnectionSchema.safeParse({
                name: value.name,
                apiToken: value.apiToken || undefined,
                zoneIds: value.zoneIds,
                connectionId: editing?.id,
                expectedRevision: editing?.revision ?? 0,
            })
            if (!parsed.success) {
                setError(
                    parsed.error.issues[0]?.message ?? 'admin.dnsConnections.errors.invalid_input',
                )
                return
            }
            pending.current = true
            setIsPending(true)
            try {
                const result = await saveDnsConnectionHandler({ data: parsed.data })
                if (!result.success) {
                    setError(result.message)
                    return
                }
                form.reset()
                setEditorOpen(false)
                setEditing(null)
                setZones([])
                setNotice(result.message)
                await invalidate()
            } catch {
                setError('admin.dnsConnections.errors.requestFailed')
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
            setError(null)
        }
        setEditorOpen(open)
    }

    function handleCreate() {
        if (!canManage || pending.current) return
        form.reset()
        setEditing(null)
        setZones([])
        setError(null)
        setNotice(null)
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
        setError(null)
        setNotice(null)
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
            setError(parsed.error.issues[0]?.message ?? 'admin.dnsConnections.validation.token')
            return
        }
        pending.current = true
        setIsPending(true)
        setError(null)
        setNotice(null)
        try {
            const result = await testDnsConnectionHandler({
                data: parsed.data,
            })
            if (!result.success) {
                setError(result.message)
                return
            }
            // Preserve previous selections even if a replacement token cannot see them.
            // The save endpoint revalidates every selected zone against the current token.
            const selectedZoneIds = new Set(form.getFieldValue('zoneIds'))
            const merged = new Map(
                zones.filter((zone) => selectedZoneIds.has(zone.id)).map((zone) => [zone.id, zone]),
            )
            for (const zone of result.result.zones) merged.set(zone.id, zone)
            setZones([...merged.values()])
            setNotice(result.message)
        } catch {
            setError('admin.dnsConnections.errors.requestFailed')
        } finally {
            pending.current = false
            setIsPending(false)
        }
    }

    async function handleRefresh() {
        if (pending.current) return
        // Refresh explicitly discards the open draft, including any replacement token.
        handleEditorOpenChange(false)
        setDeleteTarget(null)
        setError(null)
        const result = await connectionsQuery.refetch()
        if (result.isError) setError('admin.dnsConnections.errors.requestFailed')
    }

    function handleZoneChange(zoneId: string, selected: boolean) {
        if (pending.current || lockedZoneIds.has(zoneId)) return
        const selectedIds = form.getFieldValue('zoneIds')
        if (selected && selectedIds.length >= MAX_DNS_CONNECTION_ZONES) {
            setError('admin.dnsConnections.validation.zones')
            return
        }
        form.setFieldValue(
            'zoneIds',
            selected
                ? [...new Set([...selectedIds, zoneId])]
                : selectedIds.filter((id) => id !== zoneId),
        )
    }

    function handleDelete(connection: DnsConnection) {
        if (!canManage || pending.current || connection.references.length > 0) return
        setError(null)
        setNotice(null)
        setDeleteTarget(connection)
    }

    async function handleConfirmDelete() {
        if (!canManage || !deleteTarget || pending.current || deleteTarget.references.length > 0)
            return
        pending.current = true
        setIsPending(true)
        setError(null)
        try {
            const result = await deleteDnsConnectionHandler({
                data: { connectionId: deleteTarget.id, expectedRevision: deleteTarget.revision },
            })
            if (!result.success) {
                setError(result.message)
                setDeleteTarget(null)
                return
            }
            setDeleteTarget(null)
            setNotice(result.message)
            await invalidate()
        } catch {
            setError('admin.dnsConnections.errors.requestFailed')
            setDeleteTarget(null)
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
            editorOpen,
            editing,
            deleteTarget,
            zones,
            lockedZoneIds,
            error,
            notice,
            formId,
        },
        handler: {
            handleCreate,
            handleEdit,
            handleEditorOpenChange,
            handleDelete,
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
            handleRefresh: () => {
                void handleRefresh()
            },
            handleZoneChange,
        },
        form,
    } satisfies DnsConnectionsLogicContract & { form: typeof form }
}
