import '@tanstack/react-start/server-only'

import { PERMISSIONS } from '@/config/permissions.config.ts'
import { updateNotificationConfigurationSchema } from '@/lib/Notifications/validation.ts'
import type { UpdateNotificationConfigurationInput } from '@/lib/Notifications/Types/validation.types.ts'
import { requirePermissionService } from '@/server/Auth/Access/authorization.service.ts'
import { requirePermissionInTransaction } from '@/server/Auth/Access/rbac.service.ts'
import { getAuthDatabase } from '@/server/Auth/Core/database.server.ts'
import { appendAuditEventInTransactionService } from '@/server/Audit/audit.service.ts'
import { consumeRateLimit } from '@/server/Valkey/rate-limiter.service.ts'
import { publishApplicationChange } from '@/server/WebSockets/applicationChanges.ts'
import {
    observeNotificationSignals,
    summarizeNotificationState,
} from '@/server/Notifications/incident-engine.ts'
import {
    buildNotificationConfiguration,
    summarizeNotificationConfiguration,
} from '@/server/Notifications/notification-settings.ts'
import {
    readNotificationConfiguration,
    lockNotificationConfiguration,
    writeNotificationConfiguration,
    readNotificationRuntime,
    lockNotificationRuntime,
    writeNotificationRuntime,
} from '@/server/Notifications/notification-storage.ts'
import { NotificationDomainError } from '@/server/Notifications/notification.errors.ts'
import type { NotificationAdminDependencies } from './Types/notifications.types.ts'

export function createNotificationAdminService(dependencies: NotificationAdminDependencies) {
    return {
        async getNotificationConfigurationService() {
            await dependencies.authorize(PERMISSIONS.NOTIFICATIONS_VIEW)
            const configuration = await dependencies.transaction(
                dependencies.readConfiguration,
                true,
            )
            return summarizeNotificationConfiguration(configuration)
        },
        async getNotificationStatusService() {
            await dependencies.authorize(PERMISSIONS.NOTIFICATIONS_VIEW)
            const runtime = await dependencies.transaction(dependencies.readRuntime, true)
            return summarizeNotificationState(runtime.engine)
        },
        async updateNotificationConfigurationService(input: UpdateNotificationConfigurationInput) {
            const actor = await dependencies.authorize(PERMISSIONS.NOTIFICATIONS_MANAGE)
            const parsed = updateNotificationConfigurationSchema.safeParse(input)
            if (!parsed.success) throw new NotificationDomainError('invalid_input')
            await dependencies.limit(actor.id)
            const snapshot = await dependencies.transaction(dependencies.readConfiguration, true)
            // Validate destinations and encrypt outside the write transaction; never send a probe.
            const configuration = await dependencies.buildConfiguration(snapshot, parsed.data)
            const summary = await dependencies.transaction(async (transaction) => {
                await dependencies.authorizeInTransaction(
                    transaction,
                    actor.id,
                    PERMISSIONS.NOTIFICATIONS_MANAGE,
                )
                const current = await dependencies.lockConfiguration(transaction)
                if (current.revision !== parsed.data.expectedRevision)
                    throw new NotificationDomainError('configuration_conflict')
                const runtime = await dependencies.lockRuntime(transaction)
                const engine = observeNotificationSignals(
                    runtime.engine,
                    {
                        enabled: configuration.enabled,
                        pausedAfterRestore: configuration.pausedAfterRestore,
                        channels: configuration.channels.map(
                            ({
                                id,
                                name,
                                kind,
                                revision,
                                enabled,
                                events,
                                minimumSeverity,
                                thresholdSeconds,
                                recovery,
                            }) => ({
                                id,
                                name,
                                kind,
                                revision,
                                enabled,
                                events,
                                minimumSeverity,
                                thresholdSeconds,
                                recovery,
                            }),
                        ),
                    },
                    [],
                    dependencies.now(),
                    dependencies.makeId,
                )
                await dependencies.writeConfiguration(transaction, configuration)
                await dependencies.writeRuntime(transaction, { ...runtime, engine })
                await dependencies.audit(transaction, {
                    actorUserId: actor.id,
                    actorKind: 'user',
                    action: 'update',
                    resource: 'proxy-runtime-settings',
                    targetId: null,
                    result: 'success',
                    metadata: {
                        setting: 'notifications',
                        revision: configuration.revision,
                        channelCount: configuration.channels.length,
                        enabled: configuration.enabled,
                        pausedAfterRestore: configuration.pausedAfterRestore,
                    },
                })
                return summarizeNotificationConfiguration(configuration)
            }, false)
            dependencies.publish()
            return summary
        },
    }
}

export const {
    getNotificationConfigurationService,
    getNotificationStatusService,
    updateNotificationConfigurationService,
} = createNotificationAdminService({
    authorize: requirePermissionService,
    authorizeInTransaction: requirePermissionInTransaction,
    transaction: (run, readOnly) =>
        getAuthDatabase().transaction(
            run,
            readOnly ? { isolationLevel: 'repeatable read', accessMode: 'read only' } : undefined,
        ),
    limit: async (actorId) => {
        await consumeRateLimit({
            scope: 'notification-configuration',
            identifier: actorId,
            limit: 10,
            windowMs: 60_000,
        })
    },
    readConfiguration: readNotificationConfiguration,
    lockConfiguration: lockNotificationConfiguration,
    writeConfiguration: writeNotificationConfiguration,
    readRuntime: readNotificationRuntime,
    lockRuntime: lockNotificationRuntime,
    writeRuntime: writeNotificationRuntime,
    buildConfiguration: buildNotificationConfiguration,
    audit: appendAuditEventInTransactionService,
    publish: publishApplicationChange,
    now: Date.now,
    makeId: () => crypto.randomUUID(),
})
