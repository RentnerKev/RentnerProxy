import type { FormEvent } from 'react'
import type {
    CloudflareZone,
    DnsConnection,
} from '@/lib/DnsConnections/Types/dns-connections.types.ts'

export interface DnsConnectionsPageProps {
    readonly permissions: readonly string[]
}

export interface DnsConnectionsLogicContract {
    readonly state: {
        readonly canManage: boolean
        readonly connections: readonly DnsConnection[]
        readonly isLoading: boolean
        readonly isError: boolean
        readonly isPending: boolean
        readonly editorOpen: boolean
        readonly editing: DnsConnection | null
        readonly deleteTarget: DnsConnection | null
        readonly zones: readonly CloudflareZone[]
        readonly lockedZoneIds: ReadonlySet<string>
        readonly error: string | null
        readonly notice: string | null
        readonly formId: string
    }
    readonly handler: {
        readonly handleCreate: () => void
        readonly handleEdit: (connection: DnsConnection) => void
        readonly handleEditorOpenChange: (open: boolean) => void
        readonly handleDelete: (connection: DnsConnection) => void
        readonly handleDeleteOpenChange: (open: boolean) => void
        readonly handleConfirmDelete: () => Promise<void>
        readonly handleSubmit: (event: FormEvent<HTMLFormElement>) => void
        readonly handleTest: () => void
        readonly handleRefresh: () => void
        readonly handleZoneChange: (zoneId: string, selected: boolean) => void
    }
}
