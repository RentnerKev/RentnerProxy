// oxlint-disable-next-line import/no-unassigned-import -- Encrypted destinations must remain behind the server boundary.
import '@tanstack/react-start/server-only'

import { NOTIFICATION_SECRET_CONTEXT } from '@/config/notifications.config.ts'
import { notificationDestinationSchema } from '@/lib/Notifications/validation.ts'
import type {
    NotificationConfiguration,
    NotificationDestination,
} from '@/lib/Notifications/Types/notifications.types.ts'
import type { UpdateNotificationConfigurationInput } from '@/lib/Notifications/Types/validation.types.ts'
import {
    decodeBase64Url,
    decryptSecret,
    encryptSecret,
} from '@/server/Auth/Core/encryption.server.ts'
import { validateNotificationDestination } from './delivery.service.ts'
import { NotificationDomainError } from './notification.errors.ts'
import type {
    EncryptedNotificationDestination,
    StoredNotificationChannel,
    StoredNotificationConfiguration,
} from './Types/notification-internal.types.ts'

export const DEFAULT_NOTIFICATION_CONFIGURATION: StoredNotificationConfiguration = {
    version: 1,
    revision: 0,
    enabled: false,
    pausedAfterRestore: false,
    channels: [],
}

async function sealDestination(
    id: string,
    destination: NotificationDestination,
): Promise<EncryptedNotificationDestination> {
    const encrypted = await encryptSecret(
        JSON.stringify(destination),
        NOTIFICATION_SECRET_CONTEXT + id,
    )
    return {
        ciphertext: Buffer.from(encrypted.ciphertext).toString('base64url'),
        iv: Buffer.from(encrypted.iv).toString('base64url'),
    }
}

export async function openNotificationDestination(
    channel: StoredNotificationChannel,
): Promise<NotificationDestination> {
    try {
        const ciphertext = decodeBase64Url(channel.destination.ciphertext)
        const iv = decodeBase64Url(channel.destination.iv)
        if (!ciphertext || !iv) throw new NotificationDomainError('configuration_unavailable')
        const plaintext = await decryptSecret(
            { ciphertext, iv },
            NOTIFICATION_SECRET_CONTEXT + channel.id,
        )
        const destination = notificationDestinationSchema.parse(JSON.parse(plaintext))
        if (destination.kind !== channel.kind)
            throw new NotificationDomainError('configuration_unavailable')
        validateNotificationDestination(destination)
        return destination
    } catch {
        throw new NotificationDomainError('configuration_unavailable')
    }
}

export async function buildNotificationConfiguration(
    current: StoredNotificationConfiguration,
    input: UpdateNotificationConfigurationInput,
): Promise<StoredNotificationConfiguration> {
    if (input.expectedRevision !== current.revision || current.revision >= 4_294_967_295)
        throw new NotificationDomainError('configuration_conflict')
    const channels = await Promise.all(
        input.channels.map(async (channel): Promise<StoredNotificationChannel> => {
            const existing = current.channels.find((saved) => saved.id === channel.id)
            const { destination, ...policy } = channel
            if (!destination && (!existing || existing.kind !== channel.kind))
                throw new NotificationDomainError('destination_required')
            if (destination) {
                try {
                    validateNotificationDestination(destination)
                } catch {
                    throw new NotificationDomainError('destination_blocked')
                }
            }
            const unchanged =
                existing &&
                !destination &&
                JSON.stringify(policy) ===
                    JSON.stringify({
                        id: existing.id,
                        name: existing.name,
                        kind: existing.kind,
                        enabled: existing.enabled,
                        events: existing.events,
                        minimumSeverity: existing.minimumSeverity,
                        thresholdSeconds: existing.thresholdSeconds,
                        recovery: existing.recovery,
                    })
            const revision = unchanged ? existing.revision : (existing?.revision ?? 0) + 1
            if (revision > 4_294_967_295)
                throw new NotificationDomainError('configuration_conflict')
            return {
                ...policy,
                revision,
                destination: destination
                    ? await sealDestination(channel.id, destination)
                    : existing!.destination,
                hasAuthorization: destination
                    ? destination.kind === 'webhook' && destination.authorizationToken !== null
                    : existing!.hasAuthorization,
            }
        }),
    )
    return {
        version: 1,
        revision: current.revision + 1,
        enabled: input.enabled,
        pausedAfterRestore: input.enabled ? false : current.pausedAfterRestore,
        channels,
    }
}

export function summarizeNotificationConfiguration(
    configuration: StoredNotificationConfiguration,
): NotificationConfiguration {
    return {
        version: 1,
        revision: configuration.revision,
        enabled: configuration.enabled,
        pausedAfterRestore: configuration.pausedAfterRestore,
        channels: configuration.channels.map((channel) => ({
            id: channel.id,
            name: channel.name,
            kind: channel.kind,
            revision: channel.revision,
            enabled: channel.enabled,
            events: channel.events,
            minimumSeverity: channel.minimumSeverity,
            thresholdSeconds: channel.thresholdSeconds,
            recovery: channel.recovery,
            destinationConfigured: true,
            hasAuthorization: channel.hasAuthorization,
        })),
    }
}
