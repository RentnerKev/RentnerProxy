import { beforeEach, describe, expect, test } from 'bun:test'
import { createMiddlewareHarness } from '@/tests/Helpers/middlewareCoverage.ts'
import { DnsConnectionDomainError } from '@/server/Admin/DnsConnections/dns-connections.errors.ts'

const boundary = createMiddlewareHarness()
boundary.mockServices('@/server/Admin/DnsConnections/dns-connections.service.ts', [
    'getDnsConnectionsService',
    'saveDnsConnectionService',
    'testDnsConnectionService',
    'verifyDnsConnectionService',
    'deleteDnsConnectionService',
])
boundary.mockServices('@/server/Admin/DnsConnections/dns-providers.service.ts', [
    'getDnsProvidersService',
])
const handlers = await import('@/features/Admin/DnsConnections/middleware.ts')
const id = '0198d98a-0000-7000-8000-000000000881'
const reference = { connectionId: id, expectedRevision: 1 }
beforeEach(() => boundary.reset())

describe('DNS connection request boundary', () => {
    test.each([
        [
            handlers.saveDnsConnectionHandler,
            'saveDnsConnectionService',
            {
                expectedRevision: 0,
                name: 'Fixture',
                apiToken: 'fixture-token',
                zoneIds: ['a'.repeat(32)],
            },
            'connection',
        ],
        [
            handlers.testDnsConnectionHandler,
            'testDnsConnectionService',
            { connectionId: id },
            'result',
        ],
        [
            handlers.verifyDnsConnectionHandler,
            'verifyDnsConnectionService',
            reference,
            'connection',
        ],
    ])(
        'delegates validated %s with no-store and sanitized failures',
        async (handler, service, data, key) => {
            boundary.values.set(service, { id })
            expect(await boundary.invoke(handler, data)).toMatchObject({
                success: true,
                [key]: { id },
            })
            expect(boundary.argumentsFor(service)).toEqual([[data]])
            expect(boundary.headers.get('Cache-Control')).toBe('private, no-store')
            boundary.calls.length = 0
            await expect(
                boundary.invoke(handler, { ...data, unexpectedCredential: 'fixture-private' }),
            ).rejects.toThrow('admin.dnsConnections.errors.invalid_input')
            expect(boundary.argumentsFor(service)).toEqual([])
            boundary.failures.set(service, new Error('private token fixture'))
            expect(await boundary.invoke(handler, data)).toEqual({
                success: false,
                message: 'admin.dnsConnections.errors.controller_unavailable',
            })
        },
    )

    test('deletes exactly the revision-bound connection and returns no provider response', async () => {
        boundary.values.set('deleteDnsConnectionService', { privateProviderDetail: 'omitted' })
        expect(await boundary.invoke(handlers.deleteDnsConnectionHandler, reference)).toEqual({
            success: true,
            message: 'admin.dnsConnections.messages.deleted',
        })
        expect(boundary.argumentsFor('deleteDnsConnectionService')).toEqual([[reference]])
    })

    test.each([
        ['connection_conflict', 409],
        ['connection_in_use', 409],
        ['connection_not_found', 404],
        ['controller_unavailable', 503],
        ['provider_rate_limited', 429],
        ['invalid_input', 422],
    ] as const)('maps DNS code %s to HTTP %s', async (code, status) => {
        boundary.failures.set('deleteDnsConnectionService', new DnsConnectionDomainError(code))
        expect(await boundary.invoke(handlers.deleteDnsConnectionHandler, reference)).toEqual({
            success: false,
            message: `admin.dnsConnections.errors.${code}`,
        })
        expect(boundary.status).toBe(status)
    })

    test.each([
        [handlers.getDnsConnectionsHandler, 'getDnsConnectionsService'],
        [handlers.getDnsConnectionProvidersHandler, 'getDnsProvidersService'],
    ])('localizes failed uncached %s queries', async (handler, service) => {
        boundary.values.set(service, ['fixture'])
        expect(await boundary.invoke(handler)).toEqual(['fixture'])
        expect(boundary.headers.get('Cache-Control')).toBe('private, no-store')
        if (service === 'getDnsProvidersService')
            expect(boundary.argumentsFor(service)).toEqual([['connections']])
        boundary.failures.set(service, new Error('fixture-private detail'))
        await expect(boundary.invoke(handler)).rejects.toThrow('admin.dnsConnections.')
    })
})
