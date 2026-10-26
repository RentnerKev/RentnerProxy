// oxlint-disable no-await-in-loop -- Authorization failures are verified individually before checking call counts.
import { describe, expect, mock, spyOn, test } from 'bun:test'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import type { PermissionKey } from '@/config/Types/permissions-config.types.ts'
import { createDnsConnectionsService } from '@/server/Admin/DnsConnections/dns-connections.service.ts'
import { DnsConnectionDomainError } from '@/server/Admin/DnsConnections/dns-connections.errors.ts'
import type { DnsConnectionsDependencies } from '@/server/Admin/DnsConnections/Types/dns-connections.types.ts'
import type { DnsConnection } from '@/lib/DnsConnections/Types/dns-connections.types.ts'
import { validateDnsConnectionInput } from '@/features/Admin/DnsConnections/middleware.ts'
import { saveDnsConnectionSchema } from '@/features/Admin/DnsConnections/validation.ts'

const id = '0198d98a-0000-7000-8000-000000000001'
const actorId = '0198d98a-0000-7000-8000-000000000002'
const zoneId = 'a'.repeat(32)
const connection: DnsConnection = {
    id,
    provider: 'cloudflare',
    ownership: 'instance',
    name: 'Test',
    createdByUserId: actorId,
    revision: 1,
    zones: [{ id: zoneId, name: 'example.com' }],
    references: [],
    createdAt: '2026-10-15T12:00:00Z',
    updatedAt: '2026-10-15T12:00:00Z',
}
const input = {
    name: 'Test',
    expectedRevision: 0,
    zoneIds: [zoneId],
    apiToken: 'private-test-token',
}
function setup(
    permissions: readonly PermissionKey[] = [
        PERMISSIONS.DNS_CONNECTIONS_VIEW,
        PERMISSIONS.DNS_CONNECTIONS_MANAGE,
    ],
) {
    const deps: DnsConnectionsDependencies = {
        authorize: mock(async (permission) => {
            if (!permissions.includes(permission)) throw new Error('denied')
            return { id: actorId }
        }),
        controller: {
            providers: mock(async () => []),
            list: mock(async () => [connection]),
            save: mock(async () => connection),
            delete: mock(async () => {}),
            verify: mock(async () => connection),
            test: mock(async () => ({
                zones: connection.zones,
                selectedZoneIds: [zoneId],
                checkedAt: connection.updatedAt,
                dnsWriteVerified: false as const,
            })),
            validateReference: mock(async (reference) => ({
                reference,
                revision: 1,
                zone: connection.zones[0]!,
            })),
        },
        audit: mock(async () => {}),
        limitProvider: mock(async () => {}),
        createId: () => id,
    }
    return { deps, service: createDnsConnectionsService(deps) }
}
describe('DNS connection service authorization and mutations', () => {
    test('denies every operation before contacting the controller', async () => {
        const { deps, service } = setup([])
        for (const operation of [
            () => service.getDnsConnectionsService(),
            () => service.saveDnsConnectionService(input),
            () => service.testDnsConnectionService({ apiToken: input.apiToken }),
            () => service.deleteDnsConnectionService({ connectionId: id, expectedRevision: 1 }),
            () => service.verifyDnsConnectionService({ connectionId: id, expectedRevision: 1 }),
            () =>
                service.validateDnsConnectionReferenceService({
                    connectionId: id,
                    zoneId,
                    consumer: { type: 'ddns', id },
                }),
        ])
            await expect(operation()).rejects.toThrow('denied')
        for (const method of Object.values(deps.controller)) expect(method).not.toHaveBeenCalled()
        expect(deps.limitProvider).not.toHaveBeenCalled()
    })
    test('manage permission works independently of view; view cannot mutate', async () => {
        const manage = setup([PERMISSIONS.DNS_CONNECTIONS_MANAGE])
        await expect(manage.service.getDnsConnectionsService()).rejects.toThrow('denied')
        await manage.service.saveDnsConnectionService(input)
        const viewer = setup([PERMISSIONS.DNS_CONNECTIONS_VIEW])
        expect(await viewer.service.getDnsConnectionsService()).toEqual([connection])
        await expect(viewer.service.saveDnsConnectionService(input)).rejects.toThrow('denied')
    })
    test('binds actual actor, generated ID and revision; audits no credentials', async () => {
        const { deps, service } = setup()
        await service.saveDnsConnectionService(input)
        expect(deps.controller.save).toHaveBeenCalledWith(id, { ...input, actorUserId: actorId })
        expect(deps.limitProvider).toHaveBeenCalledWith(actorId)
        expect(deps.audit).toHaveBeenCalledWith({
            actorUserId: actorId,
            actorKind: 'user',
            action: 'create',
            resource: 'security-settings',
            metadata: { changedFields: ['dnsConnections'] },
            targetId: id,
            result: 'success',
        })
        await service.saveDnsConnectionService({ ...input, connectionId: id, expectedRevision: 1 })
        expect(deps.audit).toHaveBeenCalledWith({
            actorUserId: actorId,
            actorKind: 'user',
            action: 'rotate',
            resource: 'security-settings',
            metadata: { changedFields: ['dnsConnections'] },
            targetId: id,
            result: 'success',
        })
    })
    test('rate limits provider operations before calling core', async () => {
        const { deps } = setup()
        const service = createDnsConnectionsService({
            ...deps,
            limitProvider: async () => {
                throw new Error('limited')
            },
        })
        await expect(
            service.testDnsConnectionService({ apiToken: input.apiToken }),
        ).rejects.toThrow('limited')
        await expect(service.saveDnsConnectionService(input)).rejects.toThrow('limited')
        await expect(
            service.verifyDnsConnectionService({ connectionId: id, expectedRevision: 1 }),
        ).rejects.toThrow('limited')
        expect(deps.controller.test).not.toHaveBeenCalled()
        expect(deps.controller.save).not.toHaveBeenCalled()
        expect(deps.controller.verify).not.toHaveBeenCalled()
    })
    test('keeps core success when audit fails and never retries', async () => {
        const { deps } = setup()
        const log = spyOn(console, 'error').mockImplementation(() => {})
        try {
            const service = createDnsConnectionsService({
                ...deps,
                audit: async () => {
                    throw new Error('database unavailable')
                },
            })
            expect(await service.saveDnsConnectionService(input)).toEqual(connection)
            expect(deps.controller.save).toHaveBeenCalledTimes(1)
        } finally {
            log.mockRestore()
        }
    })
    test('preserves safe conflict errors and audits failure without payload', async () => {
        const { deps } = setup()
        const service = createDnsConnectionsService({
            ...deps,
            controller: {
                ...deps.controller,
                save: async () => {
                    throw new DnsConnectionDomainError('connection_conflict')
                },
            },
        })
        await expect(service.saveDnsConnectionService(input)).rejects.toThrow('connection_conflict')
        expect(deps.audit).toHaveBeenCalledWith({
            actorUserId: actorId,
            actorKind: 'user',
            action: 'create',
            resource: 'security-settings',
            metadata: { changedFields: ['dnsConnections'] },
            targetId: id,
            result: 'failure',
        })
    })
    test('validation never throws Zod issues containing rejected tokens', async () => {
        try {
            validateDnsConnectionInput(saveDnsConnectionSchema, {
                ...input,
                apiToken: '\nprivate-test-token',
                injected: 'secret',
            })
            throw new Error('Expected validation error')
        } catch (error) {
            expect(error).toBeInstanceOf(Error)
            expect(String(error)).toBe('Error: admin.dnsConnections.errors.invalid_input')
            expect(JSON.stringify(error)).not.toContain('private-test-token')
        }
    })
})
