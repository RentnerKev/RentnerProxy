import { z } from 'zod'
import type { AuditEventInput } from '@/lib/Admin/AuditLogs/Types/audit-events.types.ts'
import type { ManagedBackupStatus } from '@/lib/Backups/Types/backups.types.ts'
import type { BackupAuditCursor, BackupAuditDependencies } from './Types/backup-outcomes.types.ts'

export const backupAuditCursorSchema = z.strictObject({
    storeId: z.uuid().nullable(),
    sequence: z.number().int().nonnegative().safe(),
    restorePending: z.literal(true).optional(),
})
export function planBackupAuditBatch(cursor: BackupAuditCursor, status: ManagedBackupStatus) {
    // Only the trusted restore transaction may authorize rebasing after an older database image.
    const previous =
        cursor.restorePending && status.auditEvents.length > 0
            ? status.auditEvents[0]!.sequence - 1
            : cursor.storeId === status.storeId
              ? cursor.sequence
              : 0
    let sequence = -1
    for (const event of status.auditEvents) {
        if (event.sequence <= sequence || (sequence >= 0 && event.sequence !== sequence + 1))
            throw new Error('Invalid backup event sequence')
        sequence = event.sequence
    }
    const batch = status.auditEvents.filter((event) => event.sequence > previous).slice(0, 100)
    if (batch.length > 0 && batch[0]!.sequence !== previous + 1)
        throw new Error('Missing backup audit events')
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
        sourceEvents: batch,
        cursor:
            cursor.restorePending && batch.length === 0
                ? cursor
                : { storeId: status.storeId, sequence: batch.at(-1)?.sequence ?? previous },
    }
}

export function createBackupAuditIngestor(dependencies: BackupAuditDependencies) {
    return async (signal: AbortSignal) => {
        const committed = await dependencies.transaction(async (transaction) => {
            signal.throwIfAborted()
            // Read under the cursor lock: snapshots from different root stores must not overtake each other.
            const status = await dependencies.status(signal)
            signal.throwIfAborted()
            const planned = planBackupAuditBatch(transaction.cursor, status)
            const admission = await transaction.enqueue(planned.sourceEvents)
            if (
                !Number.isSafeInteger(admission.accepted) ||
                admission.accepted < 0 ||
                admission.accepted > planned.events.length
            )
                throw new Error('Invalid backup notification admission')
            const accepted = planned.sourceEvents.slice(0, admission.accepted)
            const batch: { events: AuditEventInput[]; cursor: BackupAuditCursor } = {
                events: planned.events.slice(0, admission.accepted),
                cursor:
                    transaction.cursor.restorePending && accepted.length === 0
                        ? transaction.cursor
                        : {
                              storeId: status.storeId,
                              sequence:
                                  accepted.at(-1)?.sequence ??
                                  (transaction.cursor.storeId === status.storeId
                                      ? transaction.cursor.sequence
                                      : 0),
                          },
            }
            if (batch.events.length > 0) await transaction.append(batch.events)
            signal.throwIfAborted()
            if (
                batch.cursor.storeId !== transaction.cursor.storeId ||
                batch.cursor.sequence !== transaction.cursor.sequence ||
                batch.cursor.restorePending !== transaction.cursor.restorePending
            )
                await transaction.save(batch.cursor)
            signal.throwIfAborted()
            return { count: batch.events.length, cursor: batch.cursor, changed: admission.changed }
        })
        if (committed.changed) dependencies.changed?.()
        signal.throwIfAborted()
        // Producer disposal is safe only after the transaction has durably committed.
        if (!committed.cursor.restorePending && committed.cursor.storeId !== null)
            await dependencies.acknowledge(
                { storeId: committed.cursor.storeId, sequence: committed.cursor.sequence },
                signal,
            )
        return committed.count
    }
}
