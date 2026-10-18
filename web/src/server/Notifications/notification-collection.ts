import { NOTIFICATION_LIMITS } from '@/config/notifications.config.ts'
import { observeNotificationSignals } from './incident-engine.ts'
import type {
    NotificationCollectionClaim,
    NotificationRuntime,
    StoredNotificationConfiguration,
} from './Types/notification-internal.types.ts'
import type { NotificationCollectedBatch } from './Types/notification-worker.types.ts'

export function leaseNotificationCollection(
    runtime: NotificationRuntime,
    configuration: StoredNotificationConfiguration,
    now: number,
    token: string,
) {
    if (
        !configuration.enabled ||
        configuration.pausedAfterRestore ||
        !configuration.channels.some((channel) => channel.enabled) ||
        (runtime.collectionLease && runtime.collectionLease.expiresAt > now)
    )
        return null
    return {
        runtime: {
            ...runtime,
            collectionLease: { token, expiresAt: now + NOTIFICATION_LIMITS.leaseMs },
        },
        claim: {
            token,
            configurationRevision: configuration.revision,
            certificateCursor: runtime.certificateCursor,
        },
    }
}

export function commitNotificationCollectedBatch(
    runtime: NotificationRuntime,
    configuration: StoredNotificationConfiguration,
    claim: NotificationCollectionClaim,
    batch: NotificationCollectedBatch,
    now: number,
    makeId: () => string,
) {
    if (runtime.collectionLease?.token !== claim.token) return { runtime, changed: false }
    const eligible =
        runtime.collectionLease.expiresAt > now &&
        configuration.revision === claim.configurationRevision &&
        configuration.enabled &&
        !configuration.pausedAfterRestore
    if (!eligible) return { runtime: { ...runtime, collectionLease: null }, changed: false }
    const engine = observeNotificationSignals(
        runtime.engine,
        configuration,
        batch.observations,
        now,
        makeId,
    )
    return {
        runtime: {
            version: 1 as const,
            engine,
            collectionLease: null,
            certificateCursor: batch.certificateCursor,
        },
        changed: JSON.stringify(engine) !== JSON.stringify(runtime.engine),
    }
}
