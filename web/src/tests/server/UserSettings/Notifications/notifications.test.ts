import { describe, expect, mock, test } from 'bun:test'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import type { AuthenticatedUser } from '@/lib/Auth/Types/auth.types.ts'
import type { PermissionKey } from '@/config/Types/permissions-config.types.ts'
import type { UpdatePersonalNotificationConfigurationInput } from '@/lib/Notifications/Types/validation.types.ts'
import { createPersonalNotificationService } from '@/server/UserSettings/Notifications/notifications.service.ts'
import type { PersonalNotificationDependencies } from '@/server/UserSettings/Notifications/Types/notifications.types.ts'
import type { AuthTransaction } from '@/server/Auth/Core/Types/database.types.ts'
import type {
    NotificationRuntime,
    StoredNotificationConfiguration,
} from '@/server/Notifications/Types/notification-internal.types.ts'
import {
    createNotificationState,
    finishNotificationDelivery,
    observeNotificationSignals,
} from '@/server/Notifications/incident-engine.ts'
import { claimNotificationTestDelivery } from '@/server/Notifications/notification-test.ts'
import { NotificationDomainError } from '@/server/Notifications/notification.errors.ts'
import { AuthDomainError } from '@/server/Auth/Core/errors.server.ts'
import { auditEventInputSchema } from '@/features/Admin/AuditLogs/validation.ts'
import type { NotificationDeliveryClaim } from '@/server/Notifications/Types/notification-internal.types.ts'
import type { NotificationDeliveryResult } from '@/lib/Notifications/Types/notifications.types.ts'
import type { UpdateNotificationConfigurationInput } from '@/lib/Notifications/Types/validation.types.ts'

const actorId = '00000000-0000-4000-8000-000000000001'
const ownId = '00000000-0000-4000-8000-000000000002'
const foreignId = '00000000-0000-4000-8000-000000000003'
const otherActorId = '00000000-0000-4000-8000-000000000004'
const transaction = {} as AuthTransaction
const policy = {
    id: ownId,
    name: 'Personal',
    kind: 'webhook' as const,
    enabled: true,
    events: ['ddns' as const],
    minimumSeverity: 'error' as const,
    thresholdSeconds: 0,
    recovery: true,
}
const channel = {
    ...policy,
    revision: 1,
    ownerUserId: actorId,
    destination: { ciphertext: 'sealed-secret', iv: 'sealed-iv' },
    hasAuthorization: true,
}
const initial: StoredNotificationConfiguration = {
    version: 1,
    revision: 1,
    enabled: true,
    pausedAfterRestore: false,
    channels: [channel, { ...channel, id: foreignId, ownerUserId: otherActorId, name: 'Foreign' }],
}
const input: UpdatePersonalNotificationConfigurationInput = {
    expectedRevision: 1,
    channels: [{ ...policy, events: [...policy.events] }],
}

function setup() {
    let configuration = structuredClone(initial)
    let permissions: PermissionKey[] = [PERMISSIONS.APP_ACCESS, PERMISSIONS.DDNS_VIEW]
    let privateTarget = false
    let insideTransaction = false
    let runtime: NotificationRuntime = {
        version: 1,
        engine: createNotificationState(),
        certificateCursor: null,
        collectionLease: null,
    }
    const user = (): AuthenticatedUser => ({
        id: actorId,
        permissions,
        displayName: 'User',
        email: 'user@example.test',
        profileImageVersion: null,
        roles: [],
        language: 'de',
        themeMode: 'dark',
    })
    const dependencies = {
        authorize: mock(async () => user()),
        authorizeInTransaction: mock(async () => user()),
        transaction: async (run, _readOnly) => {
            insideTransaction = true
            try {
                return await run(transaction)
            } finally {
                insideTransaction = false
            }
        },
        limit: mock(async () => {}),
        limitTest: mock(async () => {}),
        readConfiguration: mock(async () => structuredClone(configuration)),
        lockConfiguration: mock(async () => structuredClone(configuration)),
        writeConfiguration: mock(async (_transaction, next) => {
            configuration = structuredClone(next)
        }),
        readRuntime: mock(async () => structuredClone(runtime)),
        lockRuntime: mock(async () => structuredClone(runtime)),
        writeRuntime: mock(async (_transaction, next) => {
            runtime = structuredClone(next)
        }),
        buildConfiguration: mock(
            async (
                current: StoredNotificationConfiguration,
                next: UpdateNotificationConfigurationInput,
            ): Promise<StoredNotificationConfiguration> => {
                expect(insideTransaction).toBe(false)
                if (current.revision !== next.expectedRevision)
                    throw new NotificationDomainError('configuration_conflict')
                return {
                    ...current,
                    revision: current.revision + 1,
                    enabled: next.enabled,
                    pausedAfterRestore: next.enabled ? false : current.pausedAfterRestore,
                    channels: next.channels.map(({ destination: _destination, ...item }) => ({
                        ...item,
                        revision: current.revision + 1,
                        destination: channel.destination,
                        hasAuthorization: true,
                    })),
                }
            },
        ),
        openDestination: mock(async () => {
            expect(insideTransaction).toBe(false)
            return {
                kind: 'webhook' as const,
                url: 'https://public.example.test',
                authorizationToken: 'write-only-secret',
                allowedPrivateCidrs: privateTarget ? ['10.0.0.0/8'] : [],
            }
        }),
        effectiveConfiguration: mock(async (_transaction, next) => next),
        smtpConfigured: () => false,
        deliver: mock(
            async (_claim: NotificationDeliveryClaim): Promise<NotificationDeliveryResult> => {
                expect(insideTransaction).toBe(false)
                return { success: true as const }
            },
        ),
        acknowledge: mock(async (leaseToken, result) => {
            runtime.engine = finishNotificationDelivery(
                runtime.engine,
                configuration,
                leaseToken,
                result,
                3_000,
            )
        }),
        audit: mock(async (_transaction, event) => {
            auditEventInputSchema.parse(event)
        }),
        publish: mock(() => {
            expect(insideTransaction).toBe(false)
        }),
        now: () => 2_000,
        makeId: () => crypto.randomUUID(),
    } satisfies PersonalNotificationDependencies
    return {
        dependencies,
        service: createPersonalNotificationService(dependencies),
        configuration: () => configuration,
        runtime: () => runtime,
        setConfiguration: (next: StoredNotificationConfiguration) => {
            configuration = next
        },
        setPermissions: (next: PermissionKey[]) => {
            permissions = next
        },
        setPrivate: () => {
            privateTarget = true
        },
        setEngine: (engine: NotificationRuntime['engine']) => {
            runtime.engine = engine
        },
    }
}

describe('personal notification authorization and delivery', () => {
    test('reads return only the actor channels, freshly allowed categories, and no destination or lease secrets', async () => {
        const fixture = setup()
        let engine = createNotificationState()
        for (const item of initial.channels)
            engine = claimNotificationTestDelivery(engine, initial, item.id, 1_000, () =>
                crypto.randomUUID(),
            ).state
        fixture.setEngine(engine)
        fixture.setPermissions([
            PERMISSIONS.APP_ACCESS,
            PERMISSIONS.DDNS_VIEW,
            PERMISSIONS.CERTIFICATES_VIEW,
        ])
        const settings = await fixture.service.getPersonalNotificationSettingsService()
        const status = await fixture.service.getPersonalNotificationStatusService()
        expect(settings.configuration.channels.map((item) => item.id)).toEqual([ownId])
        expect(settings.allowedCategories).toEqual(['certificate_renewal', 'ddns'])
        expect(settings.canUsePrivateDestinations).toBe(false)
        expect(settings.smtpConfigured).toBe(false)
        expect(status.deliveries.map((item) => item.channelId)).toEqual([ownId])
        for (const secret of ['sealed-secret', 'sealed-iv', 'leaseToken', foreignId])
            expect(JSON.stringify({ settings, status })).not.toContain(secret)
        expect(fixture.dependencies.deliver).not.toHaveBeenCalled()
    })

    test('saving changes only the actor slice, seals outside transactions and never sends a notification', async () => {
        const fixture = setup()
        const summary = await fixture.service.updatePersonalNotificationConfigurationService(input)
        expect(summary.configuration.revision).toBe(2)
        expect(fixture.configuration().channels.find((item) => item.id === foreignId)).toEqual(
            initial.channels[1]!,
        )
        expect(
            fixture.configuration().channels.find((item) => item.id === ownId)?.ownerUserId,
        ).toBe(actorId)
        expect(JSON.stringify(summary)).not.toContain('sealed-secret')
        expect(fixture.dependencies.deliver).not.toHaveBeenCalled()
        expect(fixture.dependencies.publish).toHaveBeenCalledTimes(1)
        expect(fixture.dependencies.effectiveConfiguration).toHaveBeenCalled()
    })

    test.each([otherActorId, undefined])(
        'cannot adopt channels owned by %s',
        async (ownerUserId) => {
            const fixture = setup()
            fixture.setConfiguration({ ...initial, channels: [{ ...channel, ownerUserId }] })
            await expect(
                fixture.service.updatePersonalNotificationConfigurationService(input),
            ).rejects.toThrow('invalid_input')
            expect(fixture.dependencies.buildConfiguration).not.toHaveBeenCalled()
            expect(fixture.dependencies.writeConfiguration).not.toHaveBeenCalled()
        },
    )

    test('strict schemas reject injected ownership and fresh category revocation prevents edits and history disclosure', async () => {
        const fixture = setup()
        const injected = {
            ...input,
            channels: [{ ...input.channels[0]!, ownerUserId: otherActorId }],
        }
        await expect(
            fixture.service.updatePersonalNotificationConfigurationService(injected),
        ).rejects.toThrow('invalid_input')
        fixture.setEngine(
            claimNotificationTestDelivery(createNotificationState(), initial, ownId, 1_000, () =>
                crypto.randomUUID(),
            ).state,
        )
        fixture.setPermissions([PERMISSIONS.APP_ACCESS])
        expect((await fixture.service.getPersonalNotificationStatusService()).deliveries).toEqual(
            [],
        )
        await expect(
            fixture.service.updatePersonalNotificationConfigurationService(input),
        ).rejects.toThrow('invalid_input')
        expect(fixture.dependencies.writeConfiguration).not.toHaveBeenCalled()
    })

    test('permission changes during sealing fail the repeated transaction checks', async () => {
        const fixture = setup()
        fixture.dependencies.buildConfiguration.mockImplementation(async (current) => {
            fixture.setPermissions([PERMISSIONS.APP_ACCESS])
            return { ...current, revision: 2 }
        })
        await expect(
            fixture.service.updatePersonalNotificationConfigurationService(input),
        ).rejects.toThrow('invalid_input')
        expect(fixture.dependencies.lockRuntime).not.toHaveBeenCalled()
        fixture.dependencies.authorizeInTransaction.mockImplementation(async () => {
            throw new AuthDomainError('permission_denied', 'Revoked')
        })
        await expect(fixture.service.getPersonalNotificationSettingsService()).rejects.toThrow(
            'Revoked',
        )
    })

    test('retained private destinations require current manage permission and cannot bypass validation by omitting destination', async () => {
        const fixture = setup()
        fixture.setPrivate()
        await expect(
            fixture.service.updatePersonalNotificationConfigurationService(input),
        ).rejects.toThrow('destination_blocked')
        fixture.setPermissions([
            PERMISSIONS.APP_ACCESS,
            PERMISSIONS.DDNS_VIEW,
            PERMISSIONS.NOTIFICATIONS_MANAGE,
        ])
        await expect(
            fixture.service.updatePersonalNotificationConfigurationService(input),
        ).resolves.toBeDefined()
        expect(fixture.dependencies.openDestination).toHaveBeenCalledTimes(2)
    })

    test('global CAS conflicts preserve all state and skip publish and audit', async () => {
        const fixture = setup()
        fixture.dependencies.lockConfiguration.mockImplementation(async () => ({
            ...initial,
            revision: 2,
        }))
        await expect(
            fixture.service.updatePersonalNotificationConfigurationService(input),
        ).rejects.toThrow('configuration_conflict')
        expect(fixture.configuration()).toEqual(initial)
        expect(fixture.dependencies.lockRuntime).not.toHaveBeenCalled()
        expect(fixture.dependencies.audit).not.toHaveBeenCalled()
        expect(fixture.dependencies.publish).not.toHaveBeenCalled()
    })

    test('empty first saves preserve activation, and restore pause requires administrator resume', async () => {
        const fixture = setup()
        fixture.setConfiguration({
            version: 1,
            revision: 0,
            enabled: false,
            pausedAfterRestore: false,
            channels: [],
        })
        const empty = await fixture.service.updatePersonalNotificationConfigurationService({
            expectedRevision: 0,
            channels: [],
        })
        expect(empty.configuration.revision).toBe(0)
        expect(fixture.dependencies.writeConfiguration).not.toHaveBeenCalled()
        expect(fixture.dependencies.writeRuntime).not.toHaveBeenCalled()
        expect(fixture.dependencies.audit).not.toHaveBeenCalled()
        expect(fixture.dependencies.publish).not.toHaveBeenCalled()
        await expect(
            fixture.service.updatePersonalNotificationConfigurationService({
                expectedRevision: 1,
                channels: [],
            }),
        ).rejects.toThrow('configuration_conflict')
        const create = {
            expectedRevision: 0,
            channels: [
                {
                    ...input.channels[0]!,
                    destination: {
                        kind: 'webhook' as const,
                        url: 'https://public.example.test',
                        authorizationToken: null,
                        allowedPrivateCidrs: [],
                    },
                },
            ],
        }
        expect(
            (await fixture.service.updatePersonalNotificationConfigurationService(create))
                .configuration.enabled,
        ).toBe(true)
        fixture.setConfiguration({ ...initial, enabled: false, pausedAfterRestore: true })
        const paused = await fixture.service.updatePersonalNotificationConfigurationService(input)
        expect(paused.configuration.enabled).toBe(false)
        expect(paused.configuration.pausedAfterRestore).toBe(true)
        await expect(
            fixture.service.updatePersonalNotificationConfigurationService({
                ...input,
                expectedRevision: 2,
                resumeDelivery: true,
            }),
        ).rejects.toThrow('invalid_input')
        fixture.setPermissions([
            PERMISSIONS.APP_ACCESS,
            PERMISSIONS.DDNS_VIEW,
            PERMISSIONS.NOTIFICATIONS_MANAGE,
        ])
        const resumed = await fixture.service.updatePersonalNotificationConfigurationService({
            ...input,
            expectedRevision: 2,
            resumeDelivery: true,
        })
        expect(resumed.configuration.enabled).toBe(true)
        expect(resumed.configuration.pausedAfterRestore).toBe(false)
    })

    test('deleted channel IDs in durable history cannot be claimed by a new owner', async () => {
        const fixture = setup()
        fixture.setEngine(
            claimNotificationTestDelivery(
                createNotificationState(),
                initial,
                foreignId,
                1_000,
                () => crypto.randomUUID(),
            ).state,
        )
        fixture.setConfiguration({ ...initial, channels: [channel] })
        await expect(
            fixture.service.updatePersonalNotificationConfigurationService({
                ...input,
                channels: [
                    {
                        ...input.channels[0]!,
                        id: foreignId,
                        destination: { kind: 'email', recipients: ['test@example.test'] },
                        kind: 'email',
                    },
                ],
            }),
        ).rejects.toThrow('invalid_input')
        expect(fixture.dependencies.writeConfiguration).not.toHaveBeenCalled()
        // The same protection applies when only an incident marker survived retention.
        fixture.setEngine(
            observeNotificationSignals(
                createNotificationState(),
                initial,
                [
                    {
                        source: 'snapshot',
                        category: 'ddns',
                        resourceId: 'private',
                        health: 'failing',
                        severity: 'error',
                        occurredAt: new Date(1_000).toISOString(),
                        evidence: 'secret',
                        failures: 1,
                    },
                ],
                1_000,
                () => crypto.randomUUID(),
            ),
        )
        fixture.runtime().engine.deliveries = []
        await expect(
            fixture.service.updatePersonalNotificationConfigurationService({
                ...input,
                channels: [
                    {
                        ...input.channels[0]!,
                        id: foreignId,
                        destination: { kind: 'email', recipients: ['test@example.test'] },
                        kind: 'email',
                    },
                ],
            }),
        ).rejects.toThrow('invalid_input')
    })

    test('explicit tests reserve durable history before sending outside the transaction and terminally acknowledge failures', async () => {
        const fixture = setup()
        // An unrelated owner's global update must not invalidate this channel's test revision.
        fixture.setConfiguration({ ...initial, revision: 9 })
        fixture.dependencies.deliver.mockImplementation(async (claim) => {
            expect(fixture.runtime().engine.deliveries[0]?.status).toBe('inflight')
            expect(claim.payload.type).toBe('test')
            return { success: false, code: 'timeout', retryable: true }
        })
        const result = await fixture.service.testPersonalNotificationChannelService({
            expectedRevision: 1,
            channelId: ownId,
        })
        expect(result).toEqual({ success: false, code: 'timeout', retryable: false })
        expect(fixture.dependencies.limitTest).toHaveBeenCalledWith(actorId)
        expect(fixture.runtime().engine.deliveries[0]?.status).toBe('failed')
        expect(fixture.runtime().engine.deliveries[0]?.attempts).toBe(1)
        expect(fixture.dependencies.publish).toHaveBeenCalledTimes(2)
        expect(fixture.dependencies.audit.mock.calls[0]?.[1].metadata?.eventId).toBe(
            fixture.runtime().engine.deliveries[0]?.id,
        )
    })

    test('tests reject rate limits, foreign channels, stale revisions, disabled channels and restore pauses before any send', async () => {
        const fixture = setup()
        const probe = { expectedRevision: 1, channelId: ownId }
        fixture.dependencies.limitTest.mockImplementationOnce(async () => {
            throw new Error('Rate limited')
        })
        await expect(fixture.service.testPersonalNotificationChannelService(probe)).rejects.toThrow(
            'Rate limited',
        )
        await expect(
            fixture.service.testPersonalNotificationChannelService({
                ...probe,
                channelId: foreignId,
            }),
        ).rejects.toThrow('invalid_input')
        await expect(
            fixture.service.testPersonalNotificationChannelService({
                ...probe,
                expectedRevision: 0,
            }),
        ).rejects.toThrow('configuration_conflict')
        for (const next of [
            { ...initial, enabled: false },
            { ...initial, pausedAfterRestore: true },
            { ...initial, channels: [{ ...channel, enabled: false }] },
        ]) {
            fixture.setConfiguration(next)
            // oxlint-disable-next-line no-await-in-loop -- Each case changes the same configuration fixture.
            await expect(
                fixture.service.testPersonalNotificationChannelService(probe),
            ).rejects.toThrow('configuration_unavailable')
        }
        expect(fixture.dependencies.deliver).not.toHaveBeenCalled()
        expect(fixture.dependencies.writeRuntime).not.toHaveBeenCalled()
    })
})
