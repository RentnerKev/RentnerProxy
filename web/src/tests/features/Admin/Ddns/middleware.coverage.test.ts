import { beforeEach, describe, expect, test } from 'bun:test'
import { createMiddlewareHarness } from '@/tests/Helpers/middlewareCoverage.ts'
import { DdnsDomainError } from '@/server/Admin/Ddns/ddns.errors.ts'

const boundary = createMiddlewareHarness()
boundary.mockServices('@/server/Admin/Ddns/ddns.service.ts', [
    'getDdnsStatusService',
    'getDdnsConnectionsService',
    'previewDdnsService',
    'saveDdnsService',
    'enableDdnsService',
    'disableDdnsService',
    'syncDdnsService',
    'applyDdnsService',
])
boundary.mockServices('@/server/Admin/DnsConnections/dns-providers.service.ts', [
    'getDdnsProviderContextService',
])
const handlers = await import('@/features/Admin/Ddns/middleware.ts')
const draft = { intervalSeconds: 300, updateOnStart: true, ipv4: true, ipv6: false, targets: [] }
beforeEach(() => boundary.reset())

describe('DDNS action boundary', () => {
    test.each([
        [
            handlers.previewDdnsHandler,
            'previewDdnsService',
            { expectedRevision: 0, draft, intent: 'save' },
        ],
        [
            handlers.saveDdnsHandler,
            'saveDdnsService',
            { expectedRevision: 0, draft, receipt: 'fixture-receipt', confirmedPause: false },
        ],
        [
            handlers.enableDdnsHandler,
            'enableDdnsService',
            { expectedRevision: 1, receipt: 'fixture-receipt', confirmed: true },
        ],
        [handlers.disableDdnsHandler, 'disableDdnsService', { expectedRevision: 1 }],
        [handlers.syncDdnsHandler, 'syncDdnsService', { expectedRevision: 1 }],
        [
            handlers.applyDdnsHandler,
            'applyDdnsService',
            { expectedRevision: 0, draft, enabled: false },
        ],
    ])(
        'validates revisions before delegating %s and keeps errors private',
        async (handler, service, data) => {
            boundary.values.set(service, { revision: 2 })
            expect(await boundary.invoke(handler, data)).toEqual({
                success: true,
                value: { revision: 2 },
            })
            expect(boundary.argumentsFor(service)).toEqual([[data]])
            expect(boundary.headers.get('Cache-Control')).toBe('private, no-store')
            expect(boundary.methods.get(handler as object)).toBe('POST')
            boundary.calls.length = 0
            await expect(
                boundary.invoke(handler, { ...data, expectedRevision: -1 }),
            ).rejects.toThrow('admin.ddns.errors.invalid_input')
            expect(boundary.argumentsFor(service)).toEqual([])
            boundary.failures.set(service, new Error('private provider detail'))
            expect(await boundary.invoke(handler, data)).toEqual({
                success: false,
                message: 'admin.ddns.errors.controller_unavailable',
            })
        },
    )

    test.each([
        ['conflict', 409],
        ['busy', 409],
        ['retry_deferred', 429],
        ['store_unavailable', 503],
        ['preview_required', 422],
    ] as const)('preserves %s status and bounded retry metadata', async (code, status) => {
        boundary.failures.set('syncDdnsService', new DdnsDomainError(code, 30))
        expect(await boundary.invoke(handlers.syncDdnsHandler, { expectedRevision: 1 })).toEqual({
            success: false,
            message: `admin.ddns.errors.${code}`,
        })
        expect(boundary.status).toBe(status)
        expect(boundary.headers.get('Retry-After')).toBe('30')
        boundary.failures.set(
            'syncDdnsService',
            new DdnsDomainError(code, undefined, 'provider_unauthorized'),
        )
        expect(await boundary.invoke(handlers.syncDdnsHandler, { expectedRevision: 1 })).toEqual({
            success: false,
            message: 'admin.ddns.recordErrors.provider_unauthorized',
        })
    })

    test.each([
        [
            handlers.getDdnsStatusHandler,
            'getDdnsStatusService',
            'admin.ddns.errors.controller_unavailable',
        ],
        [
            handlers.getDdnsConnectionsHandler,
            'getDdnsConnectionsService',
            'admin.ddns.errors.connection_unavailable',
        ],
        [
            handlers.getDdnsProvidersHandler,
            'getDdnsProviderContextService',
            'admin.dnsConnections.providers.unavailable',
        ],
    ])(
        'returns uncached %s queries and localizes service failures',
        async (handler, service, fallback) => {
            boundary.values.set(service, ['fixture'])
            expect(await boundary.invoke(handler)).toEqual(['fixture'])
            expect(boundary.headers.get('Cache-Control')).toBe('private, no-store')
            boundary.failures.set(service, new Error('private provider detail'))
            await expect(boundary.invoke(handler)).rejects.toThrow(fallback)
        },
    )
})
