import '@tanstack/react-start/server-only'

import { PERMISSIONS } from '@/config/permissions.config.ts'
import { NOTIFICATION_LIMITS } from '@/config/notifications.config.ts'
import type { AuthenticatedUser } from '@/lib/Auth/Types/auth.types.ts'
import {
    canUsePrivateNotificationDestinations,
    getAllowedNotificationCategories,
} from '@/lib/Notifications/notification-access.ts'
import {
    testPersonalNotificationChannelSchema,
    updatePersonalNotificationConfigurationSchema,
} from '@/lib/Notifications/validation.ts'
import type {
    NotificationDestination,
    PersonalNotificationSettings,
} from '@/lib/Notifications/Types/notifications.types.ts'
import type {
    TestPersonalNotificationChannelInput,
    UpdatePersonalNotificationConfigurationInput,
} from '@/lib/Notifications/Types/validation.types.ts'
import { requirePermissionService } from '@/server/Auth/Access/authorization.service.ts'
import { requirePermissionInTransaction } from '@/server/Auth/Access/rbac.service.ts'
import { getAuthDatabase } from '@/server/Auth/Core/database.server.ts'
import { appendAuditEventInTransactionService } from '@/server/Audit/audit.service.ts'
import { getSmtpConfiguration } from '@/server/env.server.ts'
import { consumeRateLimit } from '@/server/Valkey/rate-limiter.service.ts'
import { publishApplicationChange } from '@/server/WebSockets/applicationChanges.ts'
import { summarizeNotificationState } from '@/server/Notifications/incident-engine.ts'
import {
    buildNotificationConfiguration,
    openNotificationDestination,
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
import {
    filterNotificationStateForChannels,
    resolveEffectiveNotificationConfigurationInTransaction,
} from '@/server/Notifications/notification-access.ts'
import { deliverAuthorizedNotificationClaim } from '@/server/Notifications/notification-delivery.server.ts'
import { acknowledgeNotificationDelivery } from '@/server/Notifications/notification-repository.ts'
import { claimNotificationTestDelivery } from '@/server/Notifications/notification-test.ts'
import { persistNotificationConfigurationInTransaction } from '@/server/Notifications/notification-configuration-persistence.server.ts'
import { NotificationDomainError } from '@/server/Notifications/notification.errors.ts'
import type { StoredNotificationConfiguration } from '@/server/Notifications/Types/notification-internal.types.ts'
import type { PersonalNotificationDependencies } from './Types/notifications.types.ts'

function ownConfiguration(configuration: StoredNotificationConfiguration, actorId: string) {
    return {
        ...configuration,
        channels: configuration.channels.filter((channel) => channel.ownerUserId === actorId),
    }
}

function checkPolicy(
    actor: AuthenticatedUser,
    input: UpdatePersonalNotificationConfigurationInput,
    destinations: ReadonlyMap<string, NotificationDestination>,
) {
    const allowed = getAllowedNotificationCategories(actor.permissions)
    const manage = canUsePrivateNotificationDestinations(actor.permissions)
    if (input.resumeDelivery !== undefined && !manage)
        throw new NotificationDomainError('invalid_input')
    for (const channel of input.channels) {
        if (channel.events.some((event) => !allowed.includes(event)))
            throw new NotificationDomainError('invalid_input')
        const destination = destinations.get(channel.id)
        if (
            destination?.kind === 'webhook' &&
            destination.allowedPrivateCidrs.length > 0 &&
            !manage
        )
            throw new NotificationDomainError('destination_blocked')
    }
}

export function createPersonalNotificationService(dependencies: PersonalNotificationDependencies) {
    function settings(
        configuration: StoredNotificationConfiguration,
        actor: AuthenticatedUser,
    ): PersonalNotificationSettings {
        const manage = canUsePrivateNotificationDestinations(actor.permissions)
        return {
            configuration: summarizeNotificationConfiguration(
                ownConfiguration(configuration, actor.id),
            ),
            allowedCategories: getAllowedNotificationCategories(actor.permissions),
            canUsePrivateDestinations: manage,
            canResumeDelivery: manage,
            smtpConfigured: dependencies.smtpConfigured(),
        }
    }

    return {
        async getPersonalNotificationSettingsService() {
            const actor = await dependencies.authorize(PERMISSIONS.APP_ACCESS)
            return dependencies.transaction(async (transaction) => {
                const fresh = await dependencies.authorizeInTransaction(
                    transaction,
                    actor.id,
                    PERMISSIONS.APP_ACCESS,
                )
                return settings(await dependencies.readConfiguration(transaction), fresh)
            }, true)
        },
        async getPersonalNotificationStatusService() {
            const actor = await dependencies.authorize(PERMISSIONS.APP_ACCESS)
            return dependencies.transaction(async (transaction) => {
                const fresh = await dependencies.authorizeInTransaction(
                    transaction,
                    actor.id,
                    PERMISSIONS.APP_ACCESS,
                )
                const configuration = ownConfiguration(
                    await dependencies.readConfiguration(transaction),
                    actor.id,
                )
                const runtime = await dependencies.readRuntime(transaction)
                return summarizeNotificationState(
                    filterNotificationStateForChannels(
                        runtime.engine,
                        configuration.channels,
                        getAllowedNotificationCategories(fresh.permissions),
                    ),
                )
            }, true)
        },
        async updatePersonalNotificationConfigurationService(
            input: UpdatePersonalNotificationConfigurationInput,
        ) {
            const actor = await dependencies.authorize(PERMISSIONS.APP_ACCESS)
            const parsed = updatePersonalNotificationConfigurationSchema.safeParse(input)
            if (!parsed.success) throw new NotificationDomainError('invalid_input')
            await dependencies.limit(actor.id)
            const { snapshot, fresh } = await dependencies.transaction(
                async (transaction) => ({
                    fresh: await dependencies.authorizeInTransaction(
                        transaction,
                        actor.id,
                        PERMISSIONS.APP_ACCESS,
                    ),
                    snapshot: await dependencies.readConfiguration(transaction),
                }),
                true,
            )
            const own = ownConfiguration(snapshot, actor.id)
            // An empty untouched setup must not consume the initial activation generation.
            if (
                snapshot.revision === 0 &&
                !snapshot.enabled &&
                !snapshot.pausedAfterRestore &&
                snapshot.channels.length === 0 &&
                parsed.data.channels.length === 0 &&
                parsed.data.resumeDelivery !== true
            ) {
                if (parsed.data.expectedRevision !== snapshot.revision)
                    throw new NotificationDomainError('configuration_conflict')
                return settings(snapshot, fresh)
            }
            const foreign = snapshot.channels.filter((channel) => channel.ownerUserId !== actor.id)
            if (
                parsed.data.channels.some((channel) =>
                    foreign.some((saved) => saved.id === channel.id),
                ) ||
                foreign.length + parsed.data.channels.length > NOTIFICATION_LIMITS.totalChannels
            )
                throw new NotificationDomainError('invalid_input')
            const destinations = new Map<string, NotificationDestination>()
            await Promise.all(
                parsed.data.channels.map(async (channel) => {
                    const saved = own.channels.find((candidate) => candidate.id === channel.id)
                    if (channel.destination) destinations.set(channel.id, channel.destination)
                    else if (saved)
                        destinations.set(channel.id, await dependencies.openDestination(saved))
                }),
            )
            checkPolicy(fresh, parsed.data, destinations)
            const firstConfiguration =
                snapshot.revision === 0 &&
                snapshot.channels.length === 0 &&
                parsed.data.channels.length > 0
            const enabled =
                parsed.data.resumeDelivery === true || firstConfiguration || snapshot.enabled
            const built = await dependencies.buildConfiguration(own, {
                expectedRevision: parsed.data.expectedRevision,
                enabled,
                channels: parsed.data.channels,
            })
            const configuration: StoredNotificationConfiguration = {
                ...built,
                pausedAfterRestore:
                    parsed.data.resumeDelivery === true ? false : snapshot.pausedAfterRestore,
                channels: [
                    ...foreign,
                    ...built.channels.map((channel) => ({ ...channel, ownerUserId: actor.id })),
                ],
            }
            const result = await dependencies.transaction(async (transaction) => {
                const currentActor = await dependencies.authorizeInTransaction(
                    transaction,
                    actor.id,
                    PERMISSIONS.APP_ACCESS,
                )
                checkPolicy(currentActor, parsed.data, destinations)
                const current = await dependencies.lockConfiguration(transaction)
                if (current.revision !== parsed.data.expectedRevision)
                    throw new NotificationDomainError('configuration_conflict')
                const effective = await dependencies.effectiveConfiguration(
                    transaction,
                    configuration,
                )
                const previousIds = new Set(
                    current.channels
                        .filter((channel) => channel.ownerUserId === actor.id)
                        .map((channel) => channel.id),
                )
                const newIds = new Set(
                    parsed.data.channels
                        .filter((channel) => !previousIds.has(channel.id))
                        .map((channel) => channel.id),
                )
                await persistNotificationConfigurationInTransaction(dependencies, transaction, {
                    actorId: actor.id,
                    configuration,
                    effective,
                    newIds,
                    channelCount: built.channels.length,
                })
                return settings(configuration, currentActor)
            }, false)
            dependencies.publish()
            return result
        },
        async testPersonalNotificationChannelService(input: TestPersonalNotificationChannelInput) {
            const actor = await dependencies.authorize(PERMISSIONS.APP_ACCESS)
            const parsed = testPersonalNotificationChannelSchema.safeParse(input)
            if (!parsed.success) throw new NotificationDomainError('invalid_input')
            await dependencies.limitTest(actor.id)
            const claim = await dependencies.transaction(async (transaction) => {
                const fresh = await dependencies.authorizeInTransaction(
                    transaction,
                    actor.id,
                    PERMISSIONS.APP_ACCESS,
                )
                const configuration = await dependencies.lockConfiguration(transaction)
                const channel = configuration.channels.find(
                    (candidate) =>
                        candidate.id === parsed.data.channelId &&
                        candidate.ownerUserId === actor.id,
                )
                const allowed = getAllowedNotificationCategories(fresh.permissions)
                if (!channel || channel.events.some((event) => !allowed.includes(event)))
                    throw new NotificationDomainError('invalid_input')
                if (channel.revision !== parsed.data.expectedRevision)
                    throw new NotificationDomainError('configuration_conflict')
                const runtime = await dependencies.lockRuntime(transaction)
                const result = claimNotificationTestDelivery(
                    runtime.engine,
                    { ...configuration, channels: [channel] },
                    channel.id,
                    dependencies.now(),
                    dependencies.makeId,
                )
                await dependencies.writeRuntime(transaction, { ...runtime, engine: result.state })
                await dependencies.audit(transaction, {
                    actorUserId: actor.id,
                    actorKind: 'user',
                    action: 'request',
                    resource: 'proxy-runtime-settings',
                    targetId: channel.id,
                    result: 'success',
                    metadata: { setting: 'notifications', eventId: result.delivery.id },
                })
                return { ...result.delivery, channel }
            }, false)
            dependencies.publish()
            let result
            try {
                result = await dependencies.deliver(claim)
            } catch {
                result = {
                    success: false as const,
                    code: 'configuration_unavailable' as const,
                    retryable: false,
                }
            }
            const terminal = result.success ? result : { ...result, retryable: false }
            await dependencies.acknowledge(claim.leaseToken, terminal)
            dependencies.publish()
            return terminal
        },
    }
}

export const {
    getPersonalNotificationSettingsService,
    getPersonalNotificationStatusService,
    updatePersonalNotificationConfigurationService,
    testPersonalNotificationChannelService,
} = createPersonalNotificationService({
    authorize: requirePermissionService,
    authorizeInTransaction: requirePermissionInTransaction,
    transaction: (run, readOnly) =>
        getAuthDatabase().transaction(
            run,
            readOnly ? { isolationLevel: 'repeatable read', accessMode: 'read only' } : undefined,
        ),
    limit: async (actorId) => {
        await consumeRateLimit({
            scope: 'personal-notification-configuration',
            identifier: actorId,
            limit: 10,
            windowMs: 60_000,
        })
    },
    limitTest: async (actorId) => {
        await consumeRateLimit({
            scope: 'personal-notification-test',
            identifier: actorId,
            limit: 3,
            windowMs: 300_000,
        })
        await consumeRateLimit({
            scope: 'personal-notification-test-global',
            identifier: 'global',
            limit: 100,
            windowMs: 300_000,
        })
    },
    readConfiguration: readNotificationConfiguration,
    lockConfiguration: lockNotificationConfiguration,
    writeConfiguration: writeNotificationConfiguration,
    readRuntime: readNotificationRuntime,
    lockRuntime: lockNotificationRuntime,
    writeRuntime: writeNotificationRuntime,
    buildConfiguration: buildNotificationConfiguration,
    openDestination: openNotificationDestination,
    effectiveConfiguration: resolveEffectiveNotificationConfigurationInTransaction,
    smtpConfigured: () => getSmtpConfiguration() !== null,
    deliver: deliverAuthorizedNotificationClaim,
    acknowledge: acknowledgeNotificationDelivery,
    audit: appendAuditEventInTransactionService,
    publish: publishApplicationChange,
    now: Date.now,
    makeId: () => crypto.randomUUID(),
})
