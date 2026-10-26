import type { DnsConnection } from '@/lib/DnsConnections/Types/dns-connections.types.ts'

export interface DnsConnectionsPageProps {
    readonly permissions: readonly string[]
    readonly liveEnabled?: boolean
}
export interface DnsConnectionCardProps {
    readonly connection: DnsConnection
    readonly canManage: boolean
    readonly isPending: boolean
    readonly onEdit: (connection: DnsConnection) => void
    readonly onDelete: (connection: DnsConnection) => void
    readonly onVerify: (connection: DnsConnection) => Promise<void>
}
