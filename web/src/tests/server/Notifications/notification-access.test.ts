import { describe, expect, mock, test } from 'bun:test'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import {
    canUsePrivateNotificationDestinations,
    getAllowedNotificationCategories,
} from '@/lib/Notifications/notification-access.ts'
import {
    filterNotificationConfigurationByOwnerAccess,
    filterNotificationStateForChannels,
} from '@/server/Notifications/notification-access.ts'
import { createAuthorizedNotificationDelivery } from '@/server/Notifications/notification-delivery.server.ts'
import { NotificationDomainError } from '@/server/Notifications/notification.errors.ts'
import {
    createNotificationState,
    claimNotificationDelivery,
    finishNotificationDelivery,
    observeNotificationSignals,
} from '@/server/Notifications/incident-engine.ts'
import type {
    StoredNotificationChannel,
    StoredNotificationConfiguration,
} from '@/server/Notifications/Types/notification-internal.types.ts'
import { PAYLOAD } from './Types/transport-test.types.ts'

const ownerId = '00000000-0000-4000-8000-000000000001'
const channel: StoredNotificationChannel = {
    id: '00000000-0000-4000-8000-000000000002',
    ownerUserId: ownerId,
    name: 'Personal',
    kind: 'webhook',
    revision: 1,
    enabled: true,
    events: ['ddns', 'certificate_renewal'],
    minimumSeverity: 'warning',
    thresholdSeconds: 0,
    recovery: true,
    hasAuthorization: false,
    destination: { ciphertext: 'sealed', iv: 'sealed' },
}
const globalChannel: StoredNotificationChannel = {
    ...channel,
    id: '00000000-0000-4000-8000-000000000003',
    ownerUserId: undefined,
}
const configuration: StoredNotificationConfiguration = {
    version: 1,
    revision: 1,
    enabled: true,
    pausedAfterRestore: false,
    channels: [globalChannel, channel],
}
const claim = {
    id: PAYLOAD.id,
    channelId: channel.id,
    channelRevision: 1,
    payload: PAYLOAD,
    leaseToken: '00000000-0000-4000-8000-000000000004',
    channel,
}

describe('notification ownership and current access', () => {
    test('passes the currently authorized owner appearance only to email delivery', async () => {
        const mailAppearance = { themeMode: 'dark' as const, accentColor: '#8844ee' }
        const destination = { kind: 'email' as const, recipients: ['test@example.test'] }
        const deliver = mock(async () => ({ success: true as const }))
        const send = createAuthorizedNotificationDelivery({
            authorize: async () => ({ channel, allowPrivateDestinations: false, mailAppearance }),
            open: async () => destination,
            deliver,
        })
        expect(await send(claim)).toEqual({ success: true })
        expect(deliver).toHaveBeenCalledWith(destination, PAYLOAD, undefined, mailAppearance)
    })

    test('maps categories to domain permissions without granting them from notification administration', () => {
        expect(
            getAllowedNotificationCategories([
                PERMISSIONS.APP_ACCESS,
                PERMISSIONS.NOTIFICATIONS_MANAGE,
            ]),
        ).toEqual([])
        expect(
            getAllowedNotificationCategories([
                PERMISSIONS.CERTIFICATES_VIEW,
                PERMISSIONS.REDIRECT_HOSTS_VIEW,
            ]),
        ).toEqual(['certificate_renewal', 'proxy_configuration'])
        expect(canUsePrivateNotificationDestinations([PERMISSIONS.NOTIFICATIONS_VIEW])).toBeFalse()
        expect(canUsePrivateNotificationDestinations([PERMISSIONS.NOTIFICATIONS_MANAGE])).toBeTrue()
    })

    test('preserves legacy channels and removes missing, disabled or app-revoked owners', () => {
        for (const owners of [
            new Map(),
            new Map([[ownerId, null]]),
            new Map([[ownerId, { permissions: [PERMISSIONS.DDNS_VIEW] }]]),
        ]) {
            expect(
                filterNotificationConfigurationByOwnerAccess(configuration, owners).channels,
            ).toEqual([globalChannel])
        }
        expect(configuration.channels).toHaveLength(2)
    })

    test('limits effective events to the owner’s current domain access', () => {
        const effective = filterNotificationConfigurationByOwnerAccess(
            configuration,
            new Map([
                [
                    ownerId,
                    {
                        permissions: [PERMISSIONS.APP_ACCESS, PERMISSIONS.CERTIFICATES_VIEW],
                    },
                ],
            ]),
        )
        expect(effective.channels[1]?.events).toEqual(['certificate_renewal'])
        expect(effective.channels[1]?.revision).toBe(channel.revision)
        expect(channel.events).toEqual(['ddns', 'certificate_renewal'])
    })

    test('scopes status to owned admissions and removes history of revoked categories', () => {
        const state = observeNotificationSignals(
            createNotificationState(),
            configuration,
            [
                {
                    source: 'snapshot',
                    category: 'ddns',
                    resourceId: 'record',
                    health: 'failing',
                    severity: 'error',
                    occurredAt: new Date(1_000).toISOString(),
                    evidence: 'private',
                    failures: 1,
                },
            ],
            1_000,
            () => crypto.randomUUID(),
        )
        state.deferredCount = 5
        state.saturationCount = 10
        const scoped = filterNotificationStateForChannels(state, [channel], ['ddns'])
        expect(scoped.deliveries).toHaveLength(1)
        expect(scoped.deliveries[0]?.channelId).toBe(channel.id)
        expect(scoped.incidents[0]?.channels).toHaveLength(1)
        expect(scoped.deferredCount).toBe(0)
        expect(scoped.saturationCount).toBe(0)
        expect(
            filterNotificationStateForChannels(state, [channel], ['certificate_renewal']).incidents,
        ).toEqual([])
        expect(filterNotificationStateForChannels(state, [], ['ddns']).incidents).toEqual([])
        const edited = filterNotificationStateForChannels(
            state,
            [{ ...channel, revision: 2 }],
            ['ddns'],
        )
        expect(edited.incidents).toHaveLength(1)
        expect(edited.deliveries).toHaveLength(1)
    })

    test('does not decrypt or send after dispatch authorization is revoked', async () => {
        const open = mock(async () => ({
            kind: 'email' as const,
            recipients: ['test@example.test'],
        }))
        const deliver = mock(async () => ({ success: true as const }))
        const send = createAuthorizedNotificationDelivery({
            authorize: async () => null,
            open,
            deliver,
        })
        expect(await send(claim)).toEqual({ success: false, code: 'cancelled', retryable: false })
        expect(open).not.toHaveBeenCalled()
        expect(deliver).not.toHaveBeenCalled()
    })

    test('blocks retained private destinations after administrative permission is revoked', async () => {
        const deliver = mock(async () => ({ success: true as const }))
        const send = createAuthorizedNotificationDelivery({
            authorize: async () => ({ channel, allowPrivateDestinations: false }),
            open: async () => ({
                kind: 'webhook',
                url: 'http://192.168.1.2/events',
                authorizationToken: null,
                allowedPrivateCidrs: ['192.168.0.0/16'],
            }),
            deliver,
        })
        expect(await send(claim)).toEqual({
            success: false,
            code: 'destination_blocked',
            retryable: false,
        })
        expect(deliver).not.toHaveBeenCalled()
    })

    test('a transient authorization database failure preserves the queued incident for retry', async () => {
        const own = { ...configuration, channels: [channel] }
        const state = observeNotificationSignals(
            createNotificationState(),
            own,
            [
                {
                    source: 'event',
                    category: 'ddns',
                    resourceId: 'record',
                    health: 'failing',
                    severity: 'error',
                    occurredAt: new Date(1_000).toISOString(),
                    evidence: 'outage',
                    failures: 1,
                },
            ],
            1_000,
            () => crypto.randomUUID(),
        )
        const queued = claimNotificationDelivery(state, own, 1_000, () => crypto.randomUUID())
        const open = mock(async () => ({
            kind: 'email' as const,
            recipients: ['test@example.test'],
        }))
        const deliver = mock(async () => ({ success: true as const }))
        const send = createAuthorizedNotificationDelivery({
            authorize: async () => {
                throw new Error('private database connection details')
            },
            open,
            deliver,
        })
        const result = await send({ ...queued.delivery!, channel })
        expect(result).toEqual({ success: false, code: 'destination_unavailable', retryable: true })
        expect(open).not.toHaveBeenCalled()
        expect(deliver).not.toHaveBeenCalled()
        const retained = finishNotificationDelivery(
            queued.state,
            own,
            queued.delivery!.leaseToken,
            result,
            1_001,
        )
        expect(retained.deliveries[0]?.status).toBe('pending')
        expect(
            claimNotificationDelivery(retained, own, retained.deliveries[0]!.nextAttemptAt, () =>
                crypto.randomUUID(),
            ).delivery?.id,
        ).toBe(queued.delivery!.id)
    })

    test('corrupt sealed destinations stay terminal while unexpected transport failures remain retryable', async () => {
        const deliver = mock(async () => {
            throw new Error('private receiver error')
        })
        const corrupt = createAuthorizedNotificationDelivery({
            authorize: async () => ({ channel, allowPrivateDestinations: true }),
            open: async () => {
                throw new NotificationDomainError('configuration_unavailable')
            },
            deliver,
        })
        expect(await corrupt(claim)).toEqual({
            success: false,
            code: 'configuration_unavailable',
            retryable: false,
        })
        expect(deliver).not.toHaveBeenCalled()
        const transient = createAuthorizedNotificationDelivery({
            authorize: async () => ({ channel, allowPrivateDestinations: true }),
            open: async () => ({ kind: 'email', recipients: ['test@example.test'] }),
            deliver,
        })
        expect(await transient(claim)).toEqual({
            success: false,
            code: 'destination_unavailable',
            retryable: true,
        })
    })
})
