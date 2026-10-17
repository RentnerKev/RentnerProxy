import type { DdnsDraft, DdnsTarget } from '@/lib/Ddns/Types/ddns.types.ts'
import type { DnsConnection } from '@/lib/DnsConnections/Types/dns-connections.types.ts'
export interface DdnsRecordEditorContext {
    readonly draft: DdnsDraft
    readonly revision: number
    readonly target: DdnsTarget | null
}
export interface DdnsDeletionContext {
    readonly target: DdnsTarget
    readonly revision: number
}
export interface DdnsRecordEditorProps {
    readonly editor: DdnsRecordEditorContext
    readonly connections: readonly DnsConnection[]
    readonly canChooseConnection: boolean
    readonly pending: boolean
    readonly locked: boolean
    readonly stale: boolean
    readonly onClose: () => void
    readonly onSave: (draft: DdnsDraft, revision: number) => Promise<void>
}
export interface DdnsSettingsProps {
    readonly draft: DdnsDraft
    readonly revision: number
    readonly pending: boolean
    readonly locked: boolean
    readonly stale: boolean
    readonly onClose: () => void
    readonly onSave: (draft: DdnsDraft, revision: number) => Promise<void>
}
