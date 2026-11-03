import { beforeEach, describe, expect, test } from 'bun:test'
import { createMiddlewareHarness } from '@/tests/Helpers/middlewareCoverage.ts'
import { DockerDiscoveryError } from '@/server/Admin/DockerDiscovery/docker-discovery.errors.ts'

const boundary = createMiddlewareHarness()
boundary.mockServices('@/server/Admin/DockerDiscovery/discovery-management.service.ts', [
    'getDiscoveryOverviewService',
    'connectDiscoveryService',
    'inspectDiscoveryService',
    'changeDiscoveryService',
])
const handlers = await import('@/features/Admin/DockerDiscovery/middleware.ts')
beforeEach(() => boundary.reset())

describe('Docker discovery boundary', () => {
    test.each([
        [
            handlers.connectDiscoveryHandler,
            'connectDiscoveryService',
            {
                expectedRevision: 0,
                connectorRevision: 0,
                endpoint: 'unix:///var/run/docker.sock',
                acknowledgeRestore: false,
            },
        ],
        [
            handlers.inspectDiscoveryHandler,
            'inspectDiscoveryService',
            { endpoint: 'unix:///var/run/docker.sock' },
        ],
        [
            handlers.changeDiscoveryHandler,
            'changeDiscoveryService',
            { expectedRevision: 0, action: 'disable' },
        ],
    ])(
        'validates and forwards %s requests with private responses',
        async (handler, service, input) => {
            boundary.values.set(service, { revision: 1 })
            expect(await boundary.invoke(handler, input)).toEqual({
                success: true,
                value: { revision: 1 },
            })
            expect(boundary.argumentsFor(service)).toEqual([[input]])
            expect(boundary.headers.get('Cache-Control')).toBe('private, no-store')
            boundary.failures.set(service, new Error('private Docker endpoint detail'))
            expect(await boundary.invoke(handler, input)).toEqual({
                success: false,
                message: 'admin.dockerDiscovery.errors.controller_unavailable',
            })
        },
    )

    test.each([
        ['conflict', 409],
        ['invalid_input', 422],
        ['controller_unavailable', 503],
    ] as const)('maps discovery code %s to HTTP %s', async (code, status) => {
        boundary.failures.set('changeDiscoveryService', new DockerDiscoveryError(code))
        expect(
            await boundary.invoke(handlers.changeDiscoveryHandler, {
                expectedRevision: 0,
                action: 'disable',
            }),
        ).toEqual({ success: false, message: `admin.dockerDiscovery.errors.${code}` })
        expect(boundary.status).toBe(status)
    })

    test('requires an enable preview receipt and localizes unavailable overview queries', async () => {
        await expect(
            boundary.invoke(handlers.changeDiscoveryHandler, {
                expectedRevision: 0,
                action: 'enable',
            }),
        ).rejects.toThrow()
        expect(boundary.argumentsFor('changeDiscoveryService')).toEqual([])
        boundary.values.set('getDiscoveryOverviewService', { enabled: false })
        expect(await boundary.invoke(handlers.getDiscoveryOverviewHandler)).toEqual({
            enabled: false,
        })
        boundary.failures.set('getDiscoveryOverviewService', new Error('private detail'))
        await expect(boundary.invoke(handlers.getDiscoveryOverviewHandler)).rejects.toThrow(
            'admin.dockerDiscovery.errors.controller_unavailable',
        )
    })
})
