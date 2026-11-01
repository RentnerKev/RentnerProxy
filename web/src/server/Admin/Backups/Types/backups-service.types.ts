import type { PermissionKey } from '@/config/Types/permissions-config.types.ts'
import type { AuditEventInput } from '@/lib/Admin/AuditLogs/Types/audit-events.types.ts'
import type { backupsController } from '@/server/Controller/backups.server.ts'
import type { ManagedBackupStatus } from '@/lib/Backups/Types/backups.types.ts'
import type { BackupActionInput } from '@/lib/Backups/Types/backups-client.types.ts'

export interface BackupMutationTransaction {
    readonly authorize: (actorId: string, permission: PermissionKey) => Promise<unknown>
    readonly audit: (event: AuditEventInput) => Promise<void>
}
export interface BackupAdminDependencies {
    readonly localDemo?: () => Promise<ManagedBackupStatus | null>
    readonly demoDelete?: (
        input: BackupActionInput & { readonly actorId: string },
    ) => Promise<ManagedBackupStatus>
    readonly authorize: (
        permission: PermissionKey,
    ) => Promise<{ readonly id: string; readonly displayName?: string }>
    readonly limit: (actorId: string) => Promise<void>
    readonly transaction: <T>(
        run: (transaction: BackupMutationTransaction) => Promise<T>,
    ) => Promise<T>
    readonly controller: Pick<typeof backupsController, 'status' | 'start' | 'configure'> &
        Partial<Pick<typeof backupsController, 'delete' | 'restore'>>
}
