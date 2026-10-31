import '@tanstack/react-start/server-only'
import { eq, sql } from 'drizzle-orm'
import { systemSettings } from '@/db/schema.ts'
import { getAuthDatabase } from '@/server/Auth/Core/database.server.ts'
import { appendAuditEventsInTransactionService } from '@/server/Audit/audit.service.ts'
import { backupsController } from '@/server/Controller/backups.server.ts'
import { backupAuditCursorSchema, createBackupAuditIngestor } from './backup-outcomes.ts'
import { createBackupAuditWorker } from './backup-outcomes.worker.ts'

const CURSOR_KEY = 'managed_backup_audit_cursor_v1'
const ingest = createBackupAuditIngestor({
    status: (signal) => backupsController.status(signal),
    acknowledge: (cursor, signal) => backupsController.acknowledgeAudit(cursor, signal),
    transaction: (run) =>
        getAuthDatabase().transaction(async (transaction) => {
            await transaction.execute(sql`set local statement_timeout = '5000ms'`)
            await transaction.execute(sql`set local lock_timeout = '5000ms'`)
            await transaction
                .insert(systemSettings)
                .values({ key: CURSOR_KEY, value: sql`${{ storeId: null, sequence: 0 }}` })
                .onConflictDoNothing({ target: systemSettings.key })
            const [row] = await transaction
                .select({ value: systemSettings.value })
                .from(systemSettings)
                .where(eq(systemSettings.key, CURSOR_KEY))
                .limit(1)
                .for('update')
            if (!row) throw new Error('Backup audit cursor unavailable')
            const cursor = backupAuditCursorSchema.parse(
                typeof row.value === 'string' ? JSON.parse(row.value) : row.value,
            )
            return run({
                cursor,
                append: (events) => appendAuditEventsInTransactionService(transaction, events),
                save: async (value) => {
                    await transaction
                        .update(systemSettings)
                        .set({
                            value: sql`${backupAuditCursorSchema.parse(value)}`,
                            updatedAt: new Date(),
                        })
                        .where(eq(systemSettings.key, CURSOR_KEY))
                },
            })
        }),
})
export const backupOutcomesWorker = createBackupAuditWorker({
    ingest,
    unavailable: () => {
        if (process.env.NODE_ENV === 'production')
            console.warn('[backups] Audit synchronization temporarily unavailable')
    },
})
