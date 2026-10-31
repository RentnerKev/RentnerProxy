import type { AuditEventInput } from '@/lib/Admin/AuditLogs/Types/audit-events.types.ts'
import type { ManagedBackupStatus } from '@/lib/Backups/Types/backups.types.ts'

export interface BackupAuditCursor {
    readonly storeId: string | null
    readonly sequence: number
}
export interface BackupAuditTransaction {
    readonly cursor: BackupAuditCursor
    readonly append: (events: readonly AuditEventInput[]) => Promise<void>
    readonly save: (cursor: BackupAuditCursor) => Promise<void>
}
export interface BackupAuditDependencies {
    readonly status: (signal: AbortSignal) => Promise<ManagedBackupStatus>
    readonly transaction: <T>(
        run: (transaction: BackupAuditTransaction) => Promise<T>,
    ) => Promise<T>
}
export interface BackupAuditWorkerDependencies {
    readonly ingest: (signal: AbortSignal) => Promise<unknown>
    readonly unavailable: () => void
}
