import type { AuthTransaction } from '@/server/Auth/Core/Types/database.types.ts'
import type { AuthenticatedUser } from '@/lib/Auth/Types/auth.types.ts'
import type { PermissionKey } from '@/config/Types/permissions-config.types.ts'
import type { HostKind, HostTagState } from '@/lib/HostTags/Types/host-tags.types.ts'
import type { ProxyHostSummary } from '@/lib/Admin/ProxyHostManagement/Types/proxy-hosts.types.ts'
import type { RedirectHostSummary } from '@/lib/Admin/RedirectHostManagement/Types/redirect-hosts.types.ts'
import type { BulkHostAction } from '@/lib/HostBulkActions/Types/bulk-hosts.types.ts'
import type { AuditEventInput } from '@/lib/Admin/AuditLogs/Types/audit-events.types.ts'

export type BulkHost = ProxyHostSummary | RedirectHostSummary
export interface BulkHostDependencies {
    readonly authorize: (permission: PermissionKey) => Promise<AuthenticatedUser>
    readonly reauthorize: (
        transaction: AuthTransaction,
        actorId: string,
        permission: PermissionKey,
    ) => Promise<unknown>
    readonly transaction: <T>(
        run: (transaction: AuthTransaction) => Promise<T>,
        readOnly: boolean,
    ) => Promise<T>
    readonly savepoint: <T>(
        transaction: AuthTransaction,
        run: (nested: AuthTransaction) => Promise<T>,
    ) => Promise<T>
    readonly lock: (transaction: AuthTransaction) => Promise<unknown>
    readonly read: (
        transaction: AuthTransaction,
        kind: HostKind,
        ids: readonly string[],
    ) => Promise<readonly BulkHost[]>
    readonly readTags: (transaction: AuthTransaction, kind: HostKind) => Promise<HostTagState>
    readonly validate: (
        transaction: AuthTransaction,
        host: BulkHost,
        action: BulkHostAction,
        preview: boolean,
    ) => Promise<void>
    readonly write: (
        transaction: AuthTransaction,
        kind: HostKind,
        host: BulkHost,
        action: BulkHostAction,
        tags: HostTagState,
    ) => Promise<void>
    readonly audit: (transaction: AuthTransaction, event: AuditEventInput) => Promise<unknown>
    readonly reconcile: (actorId: string) => Promise<'applied' | 'pending'>
    readonly now: () => number
}
