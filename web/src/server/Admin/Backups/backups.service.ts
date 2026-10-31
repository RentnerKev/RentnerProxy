import '@tanstack/react-start/server-only'
import {
    managedBackupStartSchema,
    managedBackupConfigurationUpdateSchema,
} from '@/lib/Backups/validation.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { requirePermissionService } from '@/server/Auth/Access/authorization.service.ts'
import { requirePermissionInTransaction } from '@/server/Auth/Access/rbac.service.ts'
import { getAuthDatabase } from '@/server/Auth/Core/database.server.ts'
import { appendAuditEventInTransactionService } from '@/server/Audit/audit.service.ts'
import { consumeRateLimit } from '@/server/Valkey/rate-limiter.service.ts'
import { backupsController } from '@/server/Controller/backups.server.ts'
import type { BackupAdminDependencies } from './Types/backups-service.types.ts'
import { BackupDomainError } from './backup.errors.ts'

export const requestBackupSchema = managedBackupStartSchema.omit({ actorId: true })
export const updateBackupConfigurationSchema = managedBackupConfigurationUpdateSchema.omit({
    actorId: true,
})

export function createBackupAdminService(dependencies: BackupAdminDependencies) {
    async function mutate(input: unknown, configuration: boolean) {
        const actor = await dependencies.authorize(PERMISSIONS.BACKUPS_MANAGE)
        const parsed = (
            configuration ? updateBackupConfigurationSchema : requestBackupSchema
        ).safeParse(input)
        if (!parsed.success) throw new BackupDomainError('invalid_input')
        await dependencies.limit(actor.id)
        return dependencies.transaction(async (transaction) => {
            await transaction.authorize(actor.id, PERMISSIONS.BACKUPS_MANAGE)
            // Admission requires an audit write. The root journal remains authoritative if the database commit later fails.
            await transaction.audit({
                actorUserId: actor.id,
                actorKind: 'user',
                action: configuration ? 'update' : 'request',
                resource: configuration ? 'security-settings' : 'config-export',
                targetId: parsed.data.requestId,
                result: 'success',
                metadata: {},
            })
            return configuration
                ? dependencies.controller.configure(
                      managedBackupConfigurationUpdateSchema.parse({
                          ...parsed.data,
                          actorId: actor.id,
                      }),
                  )
                : dependencies.controller.start(
                      managedBackupStartSchema.parse({ ...parsed.data, actorId: actor.id }),
                  )
        })
    }
    return {
        async getBackupsStatusService() {
            await dependencies.authorize(PERMISSIONS.BACKUPS_VIEW)
            return dependencies.controller.status()
        },
        requestBackupService: (input: unknown) => mutate(input, false),
        updateBackupConfigurationService: (input: unknown) => mutate(input, true),
    }
}
export const { getBackupsStatusService, requestBackupService, updateBackupConfigurationService } =
    createBackupAdminService({
        authorize: requirePermissionService,
        controller: backupsController,
        limit: async (actorId) => {
            await consumeRateLimit({
                scope: 'backup-mutation',
                limit: 10,
                windowMs: 60_000,
                identifier: actorId,
            })
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
