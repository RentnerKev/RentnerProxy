import type { AuthenticatedUser } from '@/lib/Auth/Types/auth.types.ts'
import type { PermissionKey } from '@/config/Types/permissions-config.types.ts'
import type { HostKind, HostTagState } from '@/lib/HostTags/Types/host-tags.types.ts'
import type { AuditEventInput } from '@/lib/Admin/AuditLogs/Types/audit-events.types.ts'
import type { AuthTransaction } from '@/server/Auth/Core/Types/database.types.ts'

export interface HostTagDependencies {
    readonly authorize: (permission: PermissionKey) => Promise<AuthenticatedUser>
    readonly reauthorize: (
        transaction: AuthTransaction,
        actorId: string,
        permission: PermissionKey,
    ) => Promise<unknown>
    readonly transaction: <T>(
        run: (transaction: AuthTransaction) => Promise<T>,
        readOnly?: boolean,
    ) => Promise<T>
    readonly lock: (transaction: AuthTransaction) => Promise<unknown>
    readonly read: (transaction: AuthTransaction, kind: HostKind) => Promise<HostTagState>
    readonly write: (
        transaction: AuthTransaction,
        kind: HostKind,
        state: HostTagState,
    ) => Promise<void>
    readonly hostExists: (
        transaction: AuthTransaction,
        kind: HostKind,
        hostId: string,
    ) => Promise<boolean>
    readonly audit: (transaction: AuthTransaction, input: AuditEventInput) => Promise<unknown>
    readonly newId: () => string
}
