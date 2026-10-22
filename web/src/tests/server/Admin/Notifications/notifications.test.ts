import { describe, expect, mock, test } from 'bun:test'
import { PERMISSIONS, PERMISSION_REGISTRY } from '@/config/permissions.config.ts'
import { createNotificationAdminService } from '@/server/Admin/Notifications/notifications.service.ts'
import type { NotificationAdminDependencies } from '@/server/Admin/Notifications/Types/notifications.types.ts'
import type { StoredNotificationConfiguration } from '@/server/Notifications/Types/notification-internal.types.ts'
import type { AuthTransaction } from '@/server/Auth/Core/Types/database.types.ts'
import type { UpdateNotificationConfigurationInput } from '@/lib/Notifications/Types/validation.types.ts'
import { NotificationDomainError } from '@/server/Notifications/notification.errors.ts'
import { AuthDomainError } from '@/server/Auth/Core/errors.server.ts'
import {
    createNotificationState,
    observeNotificationSignals,
} from '@/server/Notifications/incident-engine.ts'
import { auditEventInputSchema } from '@/features/Admin/AuditLogs/validation.ts'

const actorId = '00000000-0000-4000-8000-000000000001'
const channelId = '00000000-0000-4000-8000-000000000002'
const initial: StoredNotificationConfiguration = {
    version: 1,
    revision: 1,
    enabled: true,
    pausedAfterRestore: false,
    channels: [
        {
            id: channelId,
            name: 'Office',
            kind: 'webhook',
            revision: 1,
            enabled: true,
            events: ['ddns'],
            minimumSeverity: 'error',
            thresholdSeconds: 0,
            recovery: true,
            destination: { ciphertext: 'encrypted-private-destination', iv: 'private-iv' },
            hasAuthorization: true,
        },
    ],
}
const input: UpdateNotificationConfigurationInput = {
    expectedRevision: 1,
    enabled: false,
    channels: initial.channels.map(
        ({
            destination: _destination,
            hasAuthorization: _authorization,
            revision: _revision,
            ...channel
        }) => ({ ...channel, events: [...channel.events] }),
    ),
}
const transaction = {} as AuthTransaction

function setup(commitFails = false) {
    const order: string[] = []
    let configuration = structuredClone(initial)
    let runtime = {
        version: 1 as const,
        engine: createNotificationState(),
        certificateCursor: null as string | null,
        collectionLease: null as { token: string; expiresAt: number } | null,
    }
    let insideTransaction = false
    const modes: boolean[] = []
    const dependencies = {
        authorize: mock(async () => ({ id: actorId })),
        authorizeInTransaction: mock(async () => {
            order.push('authorize')
        }),
        transaction: async (run, readOnly) => {
            modes.push(readOnly)
            const savedConfiguration = structuredClone(configuration)
            const savedRuntime = structuredClone(runtime)
            insideTransaction = true
            try {
                const result = await run(transaction)
                if (!readOnly) {
                    if (commitFails) throw new Error('commit failed')
                    order.push('commit')
                }
                return result
            } catch (error) {
                configuration = savedConfiguration
                runtime = savedRuntime
                throw error
            } finally {
                insideTransaction = false
            }
        },
        limit: mock(async () => {}),
        readConfiguration: mock(async () => structuredClone(configuration)),
        lockConfiguration: mock(async () => {
            order.push('lockConfiguration')
            return structuredClone(configuration)
        }),
        writeConfiguration: mock(async (_transaction, value) => {
            order.push('writeConfiguration')
            configuration = structuredClone(value)
        }),
        readRuntime: mock(async () => structuredClone(runtime)),
        lockRuntime: mock(async () => {
            order.push('lockRuntime')
            return structuredClone(runtime)
        }),
        writeRuntime: mock(async (_transaction, value) => {
            order.push('writeRuntime')
            runtime = structuredClone(value)
        }),
        buildConfiguration: mock(async (current, next) => {
            if (current.revision !== next.expectedRevision)
                throw new NotificationDomainError('configuration_conflict')
            return {
                ...current,
                revision: current.revision + 1,
                enabled: next.enabled,
                pausedAfterRestore: false,
            }
        }),
        audit: mock(async (_transaction, event) => {
            order.push('audit')
            auditEventInputSchema.parse(event)
        }),
        publish: mock(() => {
            expect(insideTransaction).toBe(false)
            order.push('publish')
        }),
        now: () => 2_000,
        makeId: () => crypto.randomUUID(),
    } satisfies NotificationAdminDependencies
    return {
        order,
        dependencies,
        service: createNotificationAdminService(dependencies),
        modes,
        configuration: () => configuration,
        runtime: () => runtime,
        setConfiguration: (value: StoredNotificationConfiguration) => {
            configuration = value
        },
        setEngine: (engine: typeof runtime.engine) => {
            runtime.engine = engine
        },
    }
}

describe('notification configuration transaction failures', () => {
    test.each(['writeRuntime', 'audit', 'commit'] as const)(
        'rolls back configuration and runtime and skips publish when %s fails',
        async (failure) => {
            const fixture = setup(failure === 'commit')
            const before = structuredClone({
                configuration: fixture.configuration(),
                runtime: fixture.runtime(),
            })
            if (failure !== 'commit')
                fixture.dependencies[failure].mockImplementationOnce(async () => {
                    throw new Error(`${failure} failed`)
                })
            await expect(
                fixture.service.updateNotificationConfigurationService(input),
            ).rejects.toThrow(`${failure} failed`)
            expect(fixture.configuration()).toEqual(before.configuration)
            expect(fixture.runtime()).toEqual(before.runtime)
            expect(fixture.dependencies.writeConfiguration).toHaveBeenCalledTimes(1)
            expect(fixture.dependencies.writeRuntime).toHaveBeenCalledTimes(1)
            expect(fixture.dependencies.audit).toHaveBeenCalledTimes(
                failure === 'writeRuntime' ? 0 : 1,
            )
            expect(fixture.dependencies.publish).not.toHaveBeenCalled()
        },
    )
})

describe('notification admin authorization and persistence', () => {
    test.each(['delivery', 'marker'] as const)(
        'rejects adoption of retired IDs retained by a %s',
        async (retainedBy) => {
            const fixture = setup()
            const personal = {
                ...initial.channels[0]!,
                id: '00000000-0000-4000-8000-000000000003',
                ownerUserId: actorId,
            }
            const engine = observeNotificationSignals(
                createNotificationState(),
                { ...initial, channels: [personal] },
                [
                    {
                        source: 'snapshot',
                        category: 'ddns',
                        resourceId: 'private-resource',
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
            if (retainedBy === 'marker') engine.deliveries = []
            else for (const incident of engine.incidents) incident.channels = []
            fixture.setEngine(engine)
            await expect(
                fixture.service.updateNotificationConfigurationService({
                    ...input,
                    channels: [{ ...input.channels[0]!, id: personal.id }],
                }),
            ).rejects.toThrow('invalid_input')
            expect(fixture.dependencies.writeConfiguration).not.toHaveBeenCalled()
            expect(fixture.dependencies.writeRuntime).not.toHaveBeenCalled()
        },
    )

    test('hides personal channels from administrators and preserves them on global edits', async () => {
        const fixture = setup()
        const personal = {
            ...initial.channels[0]!,
            id: '00000000-0000-4000-8000-000000000003',
            ownerUserId: actorId,
            name: 'Private destination',
        }
        fixture.setConfiguration({ ...initial, channels: [...initial.channels, personal] })
        fixture.setEngine(
            observeNotificationSignals(
                createNotificationState(),
                { ...initial, channels: [personal] },
                [
                    {
                        source: 'snapshot',
                        category: 'ddns',
                        resourceId: 'private-resource',
                        health: 'failing',
                        severity: 'error',
                        occurredAt: new Date(1_000).toISOString(),
                        evidence: 'private',
                        failures: 1,
                    },
                ],
                1_000,
                () => crypto.randomUUID(),
            ),
        )
        const configuration = await fixture.service.getNotificationConfigurationService()
        expect(configuration.channels.map((channel) => channel.id)).toEqual([channelId])
        const status = await fixture.service.getNotificationStatusService()
        expect(status.incidents).toEqual([])
        expect(status.deliveries).toEqual([])
        const updated = await fixture.service.updateNotificationConfigurationService(input)
        expect(updated.channels.map((channel) => channel.id)).toEqual([channelId])
        expect(fixture.dependencies.audit.mock.calls.at(-1)?.[1].metadata?.channelCount).toBe(1)
        expect(
            fixture.configuration().channels.find((channel) => channel.id === personal.id),
        ).toEqual(personal)
        expect(
            fixture.dependencies.buildConfiguration.mock.calls[0]?.[0].channels.map(
                (channel: StoredNotificationConfiguration['channels'][number]) => channel.id,
            ),
        ).toEqual([channelId])
    })

    test('rejects global attempts to reuse another owner’s channel ID', async () => {
        const fixture = setup()
        const personal = {
            ...initial.channels[0]!,
            id: '00000000-0000-4000-8000-000000000003',
            ownerUserId: actorId,
        }
        fixture.setConfiguration({ ...initial, channels: [...initial.channels, personal] })
        await expect(
            fixture.service.updateNotificationConfigurationService({
                ...input,
                channels: [{ ...input.channels[0]!, id: personal.id }],
            }),
        ).rejects.toThrow('invalid_input')
        expect(fixture.dependencies.buildConfiguration).not.toHaveBeenCalled()
        expect(fixture.dependencies.writeConfiguration).not.toHaveBeenCalled()
    })

    test('registers distinct view and manage permissions', () => {
        expect(
            PERMISSION_REGISTRY.some(
                (permission) => permission.key === PERMISSIONS.NOTIFICATIONS_VIEW,
            ),
        ).toBe(true)
        expect(
            PERMISSION_REGISTRY.some(
                (permission) => permission.key === PERMISSIONS.NOTIFICATIONS_MANAGE,
            ),
        ).toBe(true)
    })

    test.each(['authentication_required', 'permission_denied'] as const)(
        'rejects %s GET and POST before reading storage',
        async (code) => {
            const { service, dependencies } = setup()
            dependencies.authorize = mock(async () => {
                throw new AuthDomainError(code, 'Denied')
            })
            await expect(service.getNotificationConfigurationService()).rejects.toThrow('Denied')
            await expect(service.getNotificationStatusService()).rejects.toThrow('Denied')
            await expect(service.updateNotificationConfigurationService(input)).rejects.toThrow(
                'Denied',
            )
            expect(dependencies.readConfiguration).not.toHaveBeenCalled()
            expect(dependencies.readRuntime).not.toHaveBeenCalled()
            expect(dependencies.buildConfiguration).not.toHaveBeenCalled()
            expect(dependencies.limit).not.toHaveBeenCalled()
        },
    )

    test('read-only summaries require view permission and redact destinations and leases', async () => {
        const fixture = setup()
        const engine = observeNotificationSignals(
            createNotificationState(),
            initial,
            [
                {
                    source: 'snapshot',
                    category: 'ddns',
                    resourceId: 'resource',
                    health: 'failing',
                    severity: 'error',
                    occurredAt: new Date(1_000).toISOString(),
                    evidence: 'private-evidence',
                    failures: 1,
                },
            ],
            1_000,
            () => crypto.randomUUID(),
        )
        fixture.setEngine(engine)
        const config = await fixture.service.getNotificationConfigurationService()
        const status = await fixture.service.getNotificationStatusService()
        expect(fixture.modes).toEqual([true, true])
        expect(fixture.dependencies.authorize).toHaveBeenCalledWith(PERMISSIONS.NOTIFICATIONS_VIEW)
        expect(config.channels[0]?.destinationConfigured).toBe(true)
        expect(config.channels[0]?.hasAuthorization).toBe(true)
        const serialized = JSON.stringify({ config, status })
        for (const forbidden of [
            'ciphertext',
            'private-iv',
            'private-evidence',
            'leaseToken',
            'encrypted-private-destination',
        ])
            expect(serialized).not.toContain(forbidden)
        expect(fixture.dependencies.writeConfiguration).not.toHaveBeenCalled()
    })

    test('write validates independently, reauthorizes under lock, and rejects stale CAS without writes', async () => {
        const fixture = setup()
        const extra = { secret: 'forbidden' }
        await expect(
            fixture.service.updateNotificationConfigurationService({
                ...input,
                channels: [
                    {
                        ...input.channels[0]!,
                        destination: {
                            kind: 'webhook',
                            url: 'https://example.test',
                            authorizationToken: null,
                            allowedPrivateCidrs: [],
                            ...extra,
                        },
                    },
                ],
            } as UpdateNotificationConfigurationInput),
        ).rejects.toThrow('invalid_input')
        expect(fixture.dependencies.limit).not.toHaveBeenCalled()
        fixture.dependencies.lockConfiguration = mock(async () => ({ ...initial, revision: 2 }))
        await expect(fixture.service.updateNotificationConfigurationService(input)).rejects.toThrow(
            'configuration_conflict',
        )
        expect(fixture.dependencies.authorizeInTransaction).toHaveBeenCalledWith(
            transaction,
            actorId,
            PERMISSIONS.NOTIFICATIONS_MANAGE,
        )
        expect(fixture.dependencies.writeConfiguration).not.toHaveBeenCalled()
        expect(fixture.dependencies.lockRuntime).not.toHaveBeenCalled()
        expect(fixture.dependencies.publish).not.toHaveBeenCalled()
    })

    test('transaction permission revocation prevents mutation', async () => {
        const fixture = setup()
        fixture.dependencies.authorizeInTransaction = mock(async () => {
            throw new AuthDomainError('permission_denied', 'Revoked')
        })
        await expect(fixture.service.updateNotificationConfigurationService(input)).rejects.toThrow(
            'Revoked',
        )
        expect(fixture.dependencies.writeConfiguration).not.toHaveBeenCalled()
        expect(fixture.dependencies.audit).not.toHaveBeenCalled()
        expect(fixture.dependencies.publish).not.toHaveBeenCalled()
    })

    test('disable atomically cancels queued delivery, audits safe metadata and publishes after commit', async () => {
        const fixture = setup()
        fixture.setEngine(
            observeNotificationSignals(
                createNotificationState(),
                initial,
                [
                    {
                        source: 'snapshot',
                        category: 'ddns',
                        resourceId: 'resource',
                        health: 'failing',
                        severity: 'error',
                        occurredAt: new Date(1_000).toISOString(),
                        evidence: 'failure',
                        failures: 1,
                    },
                ],
                1_000,
                () => crypto.randomUUID(),
            ),
        )
        const summary = await fixture.service.updateNotificationConfigurationService(input)
        expect(summary.revision).toBe(2)
        expect(summary.enabled).toBe(false)
        expect(fixture.modes).toEqual([true, false])
        expect(fixture.runtime().engine.deliveries[0]?.status).toBe('cancelled')
        expect(fixture.dependencies.limit).toHaveBeenCalledWith(actorId)
        expect(fixture.dependencies.audit).toHaveBeenCalledWith(transaction, {
            actorUserId: actorId,
            actorKind: 'user',
            action: 'update',
            resource: 'proxy-runtime-settings',
            targetId: null,
            result: 'success',
            metadata: {
                setting: 'notifications',
                revision: 2,
                channelCount: 1,
                enabled: false,
                pausedAfterRestore: false,
            },
        })
        expect(fixture.dependencies.publish).toHaveBeenCalledTimes(1)
        expect(fixture.dependencies.buildConfiguration).toHaveBeenCalledTimes(1)
        expect(fixture.order.slice(-8)).toEqual([
            'authorize',
            'lockConfiguration',
            'lockRuntime',
            'writeConfiguration',
            'writeRuntime',
            'audit',
            'commit',
            'publish',
        ])
    })
})
