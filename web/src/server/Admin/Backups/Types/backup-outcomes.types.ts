import type { AuditEventInput } from '@/lib/Admin/AuditLogs/Types/audit-events.types.ts'
import type {
    ManagedBackupAuditAcknowledgement,
    ManagedBackupStatus,
    ManagedBackupAuditEvent,
} from '@/lib/Backups/Types/backups.types.ts'

export interface BackupAuditCursor {
    readonly storeId: string | null
    readonly sequence: number
    readonly restorePending?: true | undefined
}
export interface BackupAuditTransaction {
    readonly cursor: BackupAuditCursor
    readonly enqueue: (
        events: readonly ManagedBackupAuditEvent[],
    ) => Promise<{ readonly accepted: number; readonly changed: boolean }>
    readonly append: (events: readonly AuditEventInput[]) => Promise<void>
    readonly save: (cursor: BackupAuditCursor) => Promise<void>
}
export interface BackupAuditDependencies {
    readonly changed?: (() => void) | undefined
    readonly status: (signal: AbortSignal) => Promise<ManagedBackupStatus>
    readonly acknowledge: (
        cursor: ManagedBackupAuditAcknowledgement,
        signal: AbortSignal,
    ) => Promise<unknown>
    readonly transaction: <T>(
        run: (transaction: BackupAuditTransaction) => Promise<T>,
    ) => Promise<T>
}
export interface BackupAuditWorkerDependencies {
    readonly ingest: (signal: AbortSignal) => Promise<unknown>
    readonly unavailable: () => void
}
