import '@tanstack/react-start/server-only'
import { z } from 'zod'
import {
    managedBackupStartSchema,
    managedBackupConfigurationUpdateSchema,
    managedBackupDeleteSchema,
    managedBackupRestoreSchema,
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
import { getLocalBackupDemoStatus, deleteLocalBackupDemoService } from './backups-demo.server.ts'
import { publishApplicationChange } from '@/server/WebSockets/applicationChanges.ts'
import { offHostConfigurationUpdateSchema } from '@/lib/Backups/offHostValidation.ts'

export const updateOffHostConfigurationSchema = offHostConfigurationUpdateSchema.omit({
    actorId: true,
})

export const requestBackupSchema = managedBackupStartSchema.omit({ actorId: true })
export const updateBackupConfigurationSchema = managedBackupConfigurationUpdateSchema.omit({
    actorId: true,
})
export const deleteBackupSchema = managedBackupDeleteSchema
    .omit({ actorId: true })
    .extend({ jobId: z.uuid() })
export const restoreBackupSchema = managedBackupRestoreSchema
    .omit({ actorId: true, actorName: true })
    .extend({ jobId: z.uuid() })

export function createBackupAdminService(dependencies: BackupAdminDependencies) {
    async function artifactAction(input: unknown, operation: 'delete' | 'restore') {
        const actor = await dependencies.authorize(PERMISSIONS.BACKUPS_MANAGE)
        const parsed = (
            operation === 'delete' ? deleteBackupSchema : restoreBackupSchema
        ).safeParse(input)
        if (!parsed.success) throw new BackupDomainError('invalid_input')
        await dependencies.limit(actor.id)
        const { jobId, ...request } = parsed.data
        if (await dependencies.localDemo?.()) {
            if (operation === 'restore') throw new BackupDomainError('appliance_required')
            if (!dependencies.demoDelete) throw new BackupDomainError('unavailable')
            const result = await dependencies.demoDelete({ ...parsed.data, actorId: actor.id })
            publishApplicationChange()
            return result
        }
        const result = await dependencies.transaction(async (transaction) => {
            await transaction.authorize(actor.id, PERMISSIONS.BACKUPS_MANAGE)
            let status
            if (operation === 'delete') {
                if (!dependencies.controller.delete) throw new BackupDomainError('unavailable')
                status = await dependencies.controller.delete(jobId, {
                    ...request,
                    actorId: actor.id,
                })
            } else {
                if (!dependencies.controller.restore) throw new BackupDomainError('unavailable')
                status = await dependencies.controller.restore(
                    jobId,
                    managedBackupRestoreSchema.parse({
                        ...request,
                        actorId: actor.id,
                        actorName: (actor.displayName?.trim() || actor.id).slice(0, 160),
                    }),
                )
            }
            await transaction.audit({
                actorUserId: actor.id,
                actorKind: 'user',
                action: operation === 'delete' ? 'delete' : 'request',
                resource: 'config-export',
                targetId: jobId,
                result: 'success',
                metadata: { operationId: parsed.data.requestId },
            })
            return status
        })
        publishApplicationChange()
        return result
    }
    async function mutate(input: unknown, configuration: boolean) {
        const actor = await dependencies.authorize(PERMISSIONS.BACKUPS_MANAGE)
        const parsed = (
            configuration ? updateBackupConfigurationSchema : requestBackupSchema
        ).safeParse(input)
        if (!parsed.success) throw new BackupDomainError('invalid_input')
        await dependencies.limit(actor.id)
        if (await dependencies.localDemo?.()) throw new BackupDomainError('appliance_required')
        return dependencies.transaction(async (transaction) => {
            await transaction.authorize(actor.id, PERMISSIONS.BACKUPS_MANAGE)
            const result = await (configuration
                ? dependencies.controller.configure(
                      managedBackupConfigurationUpdateSchema.parse({
                          ...parsed.data,
                          actorId: actor.id,
                      }),
                  )
                : dependencies.controller.start(
                      managedBackupStartSchema.parse({ ...parsed.data, actorId: actor.id }),
                  ))
            // Acquire the global audit lock only after controller I/O. Root admission is already durably journaled
            // and remains authoritative if the application audit insert or commit fails.
            await transaction.audit({
                actorUserId: actor.id,
                actorKind: 'user',
                action: configuration ? 'update' : 'request',
                resource: configuration ? 'security-settings' : 'config-export',
                targetId: parsed.data.requestId,
                result: 'success',
                metadata: {},
            })
            return result
        })
    }
    return {
        async updateOffHostConfigurationService(input: unknown) {
            const actor = await dependencies.authorize(PERMISSIONS.BACKUPS_MANAGE)
            const parsed = updateOffHostConfigurationSchema.safeParse(input)
            if (!parsed.success) throw new BackupDomainError('invalid_input')
            await dependencies.limit(actor.id)
            if (await dependencies.localDemo?.()) throw new BackupDomainError('appliance_required')
            const result = await dependencies.transaction(async (transaction) => {
                await transaction.authorize(actor.id, PERMISSIONS.BACKUPS_MANAGE)
                if (!dependencies.controller.configureOffHost)
                    throw new BackupDomainError('unavailable')
                const status = await dependencies.controller.configureOffHost({
                    ...parsed.data,
                    actorId: actor.id,
                })
                await transaction.audit({
                    actorUserId: actor.id,
                    actorKind: 'user',
                    action: 'update',
                    resource: 'security-settings',
                    targetId: parsed.data.requestId,
                    result: 'success',
                    metadata: {},
                })
                return status
            })
            publishApplicationChange()
            return result
        },
        async getBackupsStatusService() {
            await dependencies.authorize(PERMISSIONS.BACKUPS_VIEW)
            return (await dependencies.localDemo?.()) ?? dependencies.controller.status()
        },
        requestBackupService: (input: unknown) => mutate(input, false),
        updateBackupConfigurationService: (input: unknown) => mutate(input, true),
        deleteBackupService: (input: unknown) => artifactAction(input, 'delete'),
        restoreBackupService: (input: unknown) => artifactAction(input, 'restore'),
    }
}
export const {
    getBackupsStatusService,
    requestBackupService,
    updateBackupConfigurationService,
    deleteBackupService,
    restoreBackupService,
    updateOffHostConfigurationService,
} = createBackupAdminService({
    localDemo: getLocalBackupDemoStatus,
    demoDelete: deleteLocalBackupDemoService,
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
