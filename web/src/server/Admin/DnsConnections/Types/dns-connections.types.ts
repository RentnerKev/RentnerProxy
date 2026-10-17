import type { PermissionKey } from '@/config/Types/permissions-config.types.ts'
import type { AuditEventInput } from '@/lib/Admin/AuditLogs/Types/audit-events.types.ts'
import type { createDnsConnectionsController } from '@/server/Controller/dns-connections.server.ts'

export interface DnsConnectionsDependencies {
    readonly authorize: (permission: PermissionKey) => Promise<{ readonly id: string }>
    readonly controller: ReturnType<typeof createDnsConnectionsController>
    readonly audit: (event: AuditEventInput) => Promise<void>
    readonly limitProvider: (actorId: string) => Promise<void>
    readonly createId: () => string
}
