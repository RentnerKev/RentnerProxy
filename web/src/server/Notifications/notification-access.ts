// oxlint-disable-next-line import/no-unassigned-import -- Owner access is resolved only on the server.
import '@tanstack/react-start/server-only'

import { PERMISSIONS } from '@/config/permissions.config.ts'
import type { PermissionKey } from '@/config/Types/permissions-config.types.ts'
import { getAllowedNotificationCategories } from '@/lib/Notifications/notification-access.ts'
import type { NotificationCategory } from '@/lib/Notifications/Types/notifications.types.ts'
import { resolveActiveUserAccessInTransaction } from '@/server/Auth/Access/rbac.service.ts'
import type { AuthTransaction } from '@/server/Auth/Core/Types/database.types.ts'
import type {
    StoredNotificationChannel,
    StoredNotificationConfiguration,
} from './Types/notification-internal.types.ts'
import type { NotificationState } from './Types/notification-state.types.ts'

interface NotificationOwnerAccess {
    readonly permissions: readonly PermissionKey[]
}

export function filterNotificationConfigurationByOwnerAccess(
    configuration: StoredNotificationConfiguration,
    owners: ReadonlyMap<string, NotificationOwnerAccess | null>,
): StoredNotificationConfiguration {
    return {
        ...configuration,
        channels: configuration.channels.flatMap((channel) => {
            if (!channel.ownerUserId) return [channel]
            const owner = owners.get(channel.ownerUserId)
            if (!owner?.permissions.includes(PERMISSIONS.APP_ACCESS)) return []
            const allowed = getAllowedNotificationCategories(owner.permissions)
            const events = channel.events.filter((event) => allowed.includes(event))
            return events.length > 0 ? [{ ...channel, events }] : []
        }),
    }
}

export async function resolveEffectiveNotificationConfigurationInTransaction(
    transaction: AuthTransaction,
    configuration: StoredNotificationConfiguration,
): Promise<StoredNotificationConfiguration> {
    const ownerIds = [
        ...new Set(
            configuration.channels.flatMap((channel) =>
                channel.ownerUserId ? [channel.ownerUserId] : [],
            ),
        ),
    ]
    const entries = await Promise.all(
        ownerIds.map(
            async (ownerId) =>
                [
                    ownerId,
                    await resolveActiveUserAccessInTransaction(transaction, ownerId),
                ] as const,
        ),
    )
    return filterNotificationConfigurationByOwnerAccess(configuration, new Map(entries))
}

export function filterNotificationStateForChannels(
    state: NotificationState,
    channels: readonly StoredNotificationChannel[],
    allowedCategories?: readonly NotificationCategory[],
): NotificationState {
    const ids = new Set(channels.map((channel) => channel.id))
    const categoryAllowed = (category: NotificationCategory) =>
        !allowedCategories || allowedCategories.includes(category)
    const deliveries = state.deliveries.filter(
        (delivery) => ids.has(delivery.channelId) && categoryAllowed(delivery.payload.category),
    )
    const incidentIds = new Set(deliveries.map((delivery) => delivery.payload.incidentId))
    return {
        ...state,
        incidents: state.incidents
            .filter(
                (incident) =>
                    categoryAllowed(incident.category) &&
                    (incidentIds.has(incident.id) ||
                        incident.channels.some((marker) => ids.has(marker.channelId))),
            )
            .map((incident) =>
                Object.assign({}, incident, {
                    channels: incident.channels.filter((marker) => ids.has(marker.channelId)),
                }),
            ),
        deliveries,
        deferredCount: 0,
        saturationCount: 0,
    }
}
