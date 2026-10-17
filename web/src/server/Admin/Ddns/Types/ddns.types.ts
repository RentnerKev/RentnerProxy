import type { PermissionKey } from '@/config/Types/permissions-config.types.ts'
import type { AuditEventInput } from '@/lib/Admin/AuditLogs/Types/audit-events.types.ts'
import type { DdnsDraft } from '@/lib/Ddns/Types/ddns.types.ts'
import type { DnsConnection } from '@/lib/DnsConnections/Types/dns-connections.types.ts'
import type { DdnsController } from '@/server/Controller/Types/ddns.types.ts'
import type { EncryptedSecret } from '@/server/Auth/Core/Types/encryption.types.ts'
export interface DdnsReceiptService {
    issue(
        actor: string,
        intent: 'save' | 'enable',
        revision: number,
        draft: DdnsDraft,
    ): Promise<{ receipt: string; expiresAt: number }>
    verify(
        actor: string,
        intent: 'save' | 'enable',
        revision: number,
        draft: DdnsDraft,
        receipt: string,
    ): Promise<void>
}
export interface DdnsReceiptDependencies {
    readonly encrypt: (value: string, context: string) => Promise<EncryptedSecret>
    readonly decrypt: (value: EncryptedSecret, context: string) => Promise<string>
    readonly now: () => number
}
export interface DdnsDependencies {
    readonly authorize: (permission: PermissionKey) => Promise<{ readonly id: string }>
    readonly controller: DdnsController
    readonly connections: () => Promise<readonly DnsConnection[]>
    readonly receipt: DdnsReceiptService
    readonly limit: (actor: string, provider: boolean) => Promise<void>
    readonly audit: (event: AuditEventInput) => Promise<void>
}
