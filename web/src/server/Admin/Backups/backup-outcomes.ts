import { z } from 'zod'
import type { AuditEventInput } from '@/lib/Admin/AuditLogs/Types/audit-events.types.ts'
import type { ManagedBackupStatus } from '@/lib/Backups/Types/backups.types.ts'
import type { BackupAuditCursor, BackupAuditDependencies } from './Types/backup-outcomes.types.ts'

export const backupAuditCursorSchema = z.strictObject({
    storeId: z.uuid().nullable(),
    sequence: z.number().int().nonnegative().safe(),
})
export function planBackupAuditBatch(cursor: BackupAuditCursor, status: ManagedBackupStatus) {
    const previous = cursor.storeId === status.storeId ? cursor.sequence : 0
    let sequence = -1
    for (const event of status.auditEvents) {
        if (event.sequence <= sequence) throw new Error('Invalid backup event sequence')
        sequence = event.sequence
    }
    const batch = status.auditEvents.filter((event) => event.sequence > previous).slice(0, 100)
    const events: AuditEventInput[] = batch.map((event) => ({
        actorUserId: event.actorId,
        actorKind: event.actorId === null ? 'system' : 'user',
        action:
            event.kind === 'requested'
                ? 'request'
                : event.kind === 'started'
                  ? 'started'
                  : event.kind === 'succeeded'
                    ? 'save'
                    : event.kind === 'failed' || event.kind === 'interrupted'
                      ? 'failed'
                      : event.kind === 'pruned'
                        ? 'delete'
                        : 'update',
        resource: event.kind === 'configuration_updated' ? 'security-settings' : 'config-export',
        targetId: event.jobId,
        result: event.kind === 'failed' || event.kind === 'interrupted' ? 'failure' : 'success',
        metadata: {
            ...(event.jobId ? { operationId: event.jobId } : {}),
            occurredAt: new Date(event.at).toISOString(),
        },
    }))
    return {
        events,
        cursor: { storeId: status.storeId, sequence: batch.at(-1)?.sequence ?? previous },
    }
}

export function createBackupAuditIngestor(dependencies: BackupAuditDependencies) {
    return (signal: AbortSignal) =>
        dependencies.transaction(async (transaction) => {
            signal.throwIfAborted()
            // Read under the cursor lock: snapshots from different root stores must not overtake each other.
            const status = await dependencies.status(signal)
            signal.throwIfAborted()
            const batch = planBackupAuditBatch(transaction.cursor, status)
            if (batch.events.length > 0) await transaction.append(batch.events)
            signal.throwIfAborted()
            if (
                batch.cursor.storeId !== transaction.cursor.storeId ||
                batch.cursor.sequence !== transaction.cursor.sequence
            )
                await transaction.save(batch.cursor)
            signal.throwIfAborted()
            return batch.events.length
        })
}
