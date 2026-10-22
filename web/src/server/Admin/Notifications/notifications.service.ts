import '@tanstack/react-start/server-only'

import { PERMISSIONS } from '@/config/permissions.config.ts'
import { NOTIFICATION_LIMITS } from '@/config/notifications.config.ts'
import { updateNotificationConfigurationSchema } from '@/lib/Notifications/validation.ts'
import type { UpdateNotificationConfigurationInput } from '@/lib/Notifications/Types/validation.types.ts'
import { requirePermissionService } from '@/server/Auth/Access/authorization.service.ts'
import { requirePermissionInTransaction } from '@/server/Auth/Access/rbac.service.ts'
import { getAuthDatabase } from '@/server/Auth/Core/database.server.ts'
import { appendAuditEventInTransactionService } from '@/server/Audit/audit.service.ts'
import { consumeRateLimit } from '@/server/Valkey/rate-limiter.service.ts'
import { publishApplicationChange } from '@/server/WebSockets/applicationChanges.ts'
import { summarizeNotificationState } from '@/server/Notifications/incident-engine.ts'
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
import { persistNotificationConfigurationInTransaction } from '@/server/Notifications/notification-configuration-persistence.server.ts'
import { NotificationDomainError } from '@/server/Notifications/notification.errors.ts'
import { filterNotificationStateForChannels } from '@/server/Notifications/notification-access.ts'
import type { NotificationAdminDependencies } from './Types/notifications.types.ts'

export function createNotificationAdminService(dependencies: NotificationAdminDependencies) {
    return {
        async getNotificationConfigurationService() {
            await dependencies.authorize(PERMISSIONS.NOTIFICATIONS_VIEW)
            const configuration = await dependencies.transaction(
                dependencies.readConfiguration,
                true,
            )
            return summarizeNotificationConfiguration({
                ...configuration,
                channels: configuration.channels.filter((channel) => !channel.ownerUserId),
            })
        },
        async getNotificationStatusService() {
            await dependencies.authorize(PERMISSIONS.NOTIFICATIONS_VIEW)
            return dependencies.transaction(async (transaction) => {
                const configuration = await dependencies.readConfiguration(transaction)
                const runtime = await dependencies.readRuntime(transaction)
                const channels = configuration.channels.filter((channel) => !channel.ownerUserId)
                return summarizeNotificationState(
                    filterNotificationStateForChannels(runtime.engine, channels),
                )
            }, true)
        },
        async updateNotificationConfigurationService(input: UpdateNotificationConfigurationInput) {
            const actor = await dependencies.authorize(PERMISSIONS.NOTIFICATIONS_MANAGE)
            const parsed = updateNotificationConfigurationSchema.safeParse(input)
            if (!parsed.success) throw new NotificationDomainError('invalid_input')
            await dependencies.limit(actor.id)
            const snapshot = await dependencies.transaction(dependencies.readConfiguration, true)
            const personal = snapshot.channels.filter((channel) => channel.ownerUserId)
            if (
                parsed.data.channels.some((channel) =>
                    personal.some((owned) => owned.id === channel.id),
                ) ||
                personal.length + parsed.data.channels.length > NOTIFICATION_LIMITS.totalChannels
            )
                throw new NotificationDomainError('invalid_input')
            // Validate destinations and encrypt outside the write transaction; never send a probe.
            const built = await dependencies.buildConfiguration(
                {
                    ...snapshot,
                    channels: snapshot.channels.filter((channel) => !channel.ownerUserId),
                },
                parsed.data,
            )
            const configuration = { ...built, channels: [...built.channels, ...personal] }
            const summary = await dependencies.transaction(async (transaction) => {
                await dependencies.authorizeInTransaction(
                    transaction,
                    actor.id,
                    PERMISSIONS.NOTIFICATIONS_MANAGE,
                )
                const current = await dependencies.lockConfiguration(transaction)
                if (current.revision !== parsed.data.expectedRevision)
                    throw new NotificationDomainError('configuration_conflict')
                const newIds = new Set(
                    parsed.data.channels
                        .filter(
                            (channel) =>
                                !current.channels.some(
                                    (saved) => !saved.ownerUserId && saved.id === channel.id,
                                ),
                        )
                        .map((channel) => channel.id),
                )
                await persistNotificationConfigurationInTransaction(dependencies, transaction, {
                    actorId: actor.id,
                    configuration,
                    newIds,
                    channelCount: built.channels.length,
                    effective: {
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
                })
                return summarizeNotificationConfiguration(built)
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
