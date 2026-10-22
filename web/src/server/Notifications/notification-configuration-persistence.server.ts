import '@tanstack/react-start/server-only'

import type { AuthTransaction } from '@/server/Auth/Core/Types/database.types.ts'
import type {
    NotificationConfigurationPersistenceDependencies,
    NotificationConfigurationPersistenceInput,
} from './Types/notification-configuration-persistence.types.ts'
import { observeNotificationSignals } from './incident-engine.ts'
import { NotificationDomainError } from './notification.errors.ts'

/** The caller reauthorizes and checks configuration CAS before this transaction tail. */
export async function persistNotificationConfigurationInTransaction(
    dependencies: NotificationConfigurationPersistenceDependencies,
    transaction: AuthTransaction,
    {
        actorId,
        configuration,
        effective,
        newIds,
        channelCount,
    }: NotificationConfigurationPersistenceInput,
): Promise<void> {
    const runtime = await dependencies.lockRuntime(transaction)
    if (
        runtime.engine.deliveries.some((delivery) => newIds.has(delivery.channelId)) ||
        runtime.engine.incidents.some((incident) =>
            incident.channels.some((marker) => newIds.has(marker.channelId)),
        )
    )
        throw new NotificationDomainError('invalid_input')
    const engine = observeNotificationSignals(
        runtime.engine,
        effective,
        [],
        dependencies.now(),
        dependencies.makeId,
    )
    await dependencies.writeConfiguration(transaction, configuration)
    await dependencies.writeRuntime(transaction, { ...runtime, engine })
    await dependencies.audit(transaction, {
        actorUserId: actorId,
        actorKind: 'user',
        action: 'update',
        resource: 'proxy-runtime-settings',
        targetId: null,
        result: 'success',
        metadata: {
            setting: 'notifications',
            revision: configuration.revision,
            channelCount,
            enabled: configuration.enabled,
            pausedAfterRestore: configuration.pausedAfterRestore,
        },
    })
}
