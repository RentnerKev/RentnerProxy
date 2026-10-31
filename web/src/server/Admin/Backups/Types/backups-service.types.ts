import type { PermissionKey } from '@/config/Types/permissions-config.types.ts'
import type { AuditEventInput } from '@/lib/Admin/AuditLogs/Types/audit-events.types.ts'
import type { backupsController } from '@/server/Controller/backups.server.ts'

export interface BackupMutationTransaction {
    readonly authorize: (actorId: string, permission: PermissionKey) => Promise<unknown>
    readonly audit: (event: AuditEventInput) => Promise<void>
}
export interface BackupAdminDependencies {
    readonly authorize: (permission: PermissionKey) => Promise<{ readonly id: string }>
    readonly limit: (actorId: string) => Promise<void>
    readonly transaction: <T>(
        run: (transaction: BackupMutationTransaction) => Promise<T>,
    ) => Promise<T>
    readonly controller: typeof backupsController
}
