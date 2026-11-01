import '@tanstack/react-start/server-only'
import { z } from 'zod'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { requirePermissionService } from '@/server/Auth/Access/authorization.service.ts'
import { requirePermissionInTransaction } from '@/server/Auth/Access/rbac.service.ts'
import { getAuthDatabase } from '@/server/Auth/Core/database.server.ts'
import { appendAuditEventInTransactionService } from '@/server/Audit/audit.service.ts'
import { consumeRateLimit } from '@/server/Valkey/rate-limiter.service.ts'
import { downloadBackupController } from '@/server/Controller/backups-download.server.ts'
import type { BackupMutationTransaction } from './Types/backups-service.types.ts'

interface Dependencies {
    authorize: () => Promise<{ readonly id: string }>
    limit: (actorId: string) => Promise<void>
    download: (id: string, signal: AbortSignal) => Promise<Response>
    transaction: <T>(run: (transaction: BackupMutationTransaction) => Promise<T>) => Promise<T>
}

export function createBackupDownloadService(dependencies: Dependencies) {
    return async (id: string, signal: AbortSignal): Promise<Response> => {
        const actor = await dependencies.authorize()
        if (id !== id.toLowerCase() || !z.uuid().safeParse(id).success)
            return Response.json({ error: 'not_found' }, { status: 404 })
        await dependencies.limit(actor.id)
        signal.throwIfAborted()
        const response = await dependencies.download(id, signal)
        if (!response.ok) return response
        try {
            signal.throwIfAborted()
            await dependencies.transaction(async (transaction) => {
                await transaction.authorize(actor.id, PERMISSIONS.BACKUPS_MANAGE)
                await transaction.audit({
                    actorUserId: actor.id,
                    actorKind: 'user',
                    action: 'request',
                    resource: 'config-export',
                    targetId: id,
                    result: 'success',
                    metadata: {},
                })
            })
            signal.throwIfAborted()
            return response
        } catch (error) {
            await response.body?.cancel().catch(() => {})
            throw error
        }
    }
}

export const downloadBackupService = createBackupDownloadService({
    authorize: () => requirePermissionService(PERMISSIONS.BACKUPS_MANAGE),
    download: downloadBackupController,
    limit: async (identifier) => {
        await consumeRateLimit({ scope: 'backup-download', limit: 5, windowMs: 60_000, identifier })
    },
    transaction: (run) =>
        getAuthDatabase().transaction((transaction) =>
            run({
                authorize: (actorId, permission) =>
                    requirePermissionInTransaction(transaction, actorId, permission),
                audit: (event) => appendAuditEventInTransactionService(transaction, event),
            }),
        ),
})
