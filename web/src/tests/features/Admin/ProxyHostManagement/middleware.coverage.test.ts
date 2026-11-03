import { beforeEach, describe, expect, test } from 'bun:test'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { createMiddlewareHarness } from '@/tests/Helpers/middlewareCoverage.ts'
import { ProxyHostDomainError } from '@/server/Admin/ProxyHostManagement/proxy-hosts.errors.ts'
import { CertificateDomainError } from '@/server/Admin/CertificateManagement/certificates.errors.ts'

class EditorError extends Error {
    constructor(readonly code: string) {
        super(code)
    }
}
const boundary = createMiddlewareHarness()
boundary.mockServices('@/server/Admin/ProxyHostManagement/proxy-hosts.service.ts', [
    'searchProxyHostsService',
    'createProxyHostService',
    'deleteProxyHostService',
    'disableProxyHostService',
    'enableProxyHostService',
    'updateProxyHostService',
])
boundary.mockServices('@/server/Admin/ProxyHostManagement/upstream-health.service.ts', [
    'getProxyHostUpstreamHealthService',
])
boundary.mockServices('@/server/Admin/HostTags/host-list.service.ts', ['getProxyHostPageService'])
boundary.mockServices('@/server/ProxyRuntime/proxy-runtime.service.ts', [
    'applyProxyConfigurationService',
    'getProxyRuntimeStatusService',
])
boundary.mockServices('@/server/ProxyRuntime/proxy-host-config-editor.service.ts', [
    'getProxyHostConfigEditorService',
    'saveProxyHostConfigEditorService',
    'resetProxyHostConfigEditorService',
])
boundary.mockServices(
    '@/server/ProxyRuntime/proxy-config-editor.service.ts',
    [
        'getProxyConfigEditorService',
        'resetProxyConfigEditorService',
        'saveProxyConfigEditorService',
    ],
    { ProxyConfigEditorError: EditorError },
)
const handlers = await import('@/features/Admin/ProxyHostManagement/middleware.ts')
const id = '0198d98a-0000-7000-8000-000000000881'
const revision = `sha256:${'a'.repeat(64)}`
const host = {
    domains: ['example.com'],
    forwardScheme: 'http',
    forwardHost: '127.0.0.1',
    forwardPort: 8080,
    enabled: true,
}
beforeEach(() => boundary.reset())

describe('proxy host server function boundary', () => {
    test.each([
        [
            handlers.createProxyHostHandler,
            'createProxyHostService',
            host,
            PERMISSIONS.PROXY_HOSTS_CREATE,
        ],
        [
            handlers.updateProxyHostHandler,
            'updateProxyHostService',
            { ...host, proxyHostId: id },
            PERMISSIONS.PROXY_HOSTS_UPDATE,
        ],
        [
            handlers.deleteProxyHostHandler,
            'deleteProxyHostService',
            { proxyHostId: id },
            PERMISSIONS.PROXY_HOSTS_DELETE,
        ],
        [
            handlers.enableProxyHostHandler,
            'enableProxyHostService',
            { proxyHostId: id },
            PERMISSIONS.PROXY_HOSTS_ENABLE,
        ],
        [
            handlers.disableProxyHostHandler,
            'disableProxyHostService',
            { proxyHostId: id },
            PERMISSIONS.PROXY_HOSTS_DISABLE,
        ],
    ])(
        'checks permission before %s and distinguishes pending configuration',
        async (handler, service, data, permission) => {
            boundary.failures.set('requirePermissionService', new Error('denied'))
            expect(await boundary.invoke(handler, data)).toMatchObject({ success: false })
            expect(boundary.argumentsFor(service)).toEqual([])
            expect(boundary.argumentsFor('requirePermissionService')).toEqual([[permission]])
            boundary.failures.clear()
            for (const runtimeStatus of ['applied', 'pending']) {
                boundary.values.set(service, { runtimeStatus })
                // oxlint-disable-next-line no-await-in-loop -- Each outcome changes the shared boundary fixture.
                const result = await boundary.invoke(handler, data)
                expect(result).toMatchObject({ success: true, runtimeStatus })
                if (runtimeStatus === 'pending')
                    expect(result).toMatchObject({
                        message: 'admin.proxyHosts.runtime.savedPending',
                    })
            }
        },
    )

    test.each([
        ['proxy_host_not_found', 404],
        ['invalid_input', 400],
        ['domain_conflict', 409],
    ] as const)('maps proxy-host code %s to safe HTTP %s', async (code, status) => {
        boundary.failures.set(
            'deleteProxyHostService',
            new ProxyHostDomainError(code, 'private database detail'),
        )
        expect(await boundary.invoke(handlers.deleteProxyHostHandler, { proxyHostId: id })).toEqual(
            { success: false, message: `admin.proxyHosts.errors.${code}` },
        )
        expect(boundary.status).toBe(status)
    })

    test('preserves certificate availability failure codes without exposing service messages', async () => {
        for (const [code, status] of [
            ['controller_unavailable', 503],
            ['invalid_certificate', 422],
        ] as const) {
            boundary.failures.set('enableProxyHostService', new CertificateDomainError(code))
            expect(
                // oxlint-disable-next-line no-await-in-loop -- Each outcome changes the shared boundary fixture.
                await boundary.invoke(handlers.enableProxyHostHandler, { proxyHostId: id }),
            ).toEqual({ success: false, message: `admin.certificates.errors.${code}` })
            expect(boundary.status).toBe(status)
        }
    })

    test.each([
        [
            handlers.getProxyHostUpstreamHealthHandler,
            'getProxyHostUpstreamHealthService',
            { proxyHostId: id },
        ],
        [handlers.getProxyRuntimeStatusHandler, 'getProxyRuntimeStatusService', undefined],
        [handlers.getProxyHostPageHandler, 'getProxyHostPageService', {}],
        [handlers.getProxyConfigEditorHandler, 'getProxyConfigEditorService', undefined],
        [
            handlers.getProxyHostConfigEditorHandler,
            'getProxyHostConfigEditorService',
            { proxyHostId: id },
        ],
        [handlers.searchProxyHostsHandler, 'searchProxyHostsService', { query: 'fixture' }],
    ])(
        'delegates %s queries and localizes unavailable services',
        async (handler, service, data) => {
            boundary.values.set(service, { safe: true })
            expect(await boundary.invoke(handler, data)).toEqual({ safe: true })
            boundary.failures.set(service, new Error('private controller detail'))
            await expect(boundary.invoke(handler, data)).rejects.toThrow('admin.proxyHosts.')
        },
    )

    test.each([
        [
            handlers.saveProxyConfigEditorHandler,
            'saveProxyConfigEditorService',
            { baseRevision: revision, settings: {} },
        ],
        [
            handlers.resetProxyConfigEditorHandler,
            'resetProxyConfigEditorService',
            { baseRevision: revision },
        ],
    ])(
        'validates global revision and reports %s pending/applied status',
        async (handler, service, input) => {
            for (const runtimeStatus of ['pending', 'applied']) {
                boundary.values.set(service, runtimeStatus)
                // oxlint-disable-next-line no-await-in-loop -- Each outcome changes the shared boundary fixture.
                expect(await boundary.invoke(handler, input)).toMatchObject({
                    success: true,
                    runtimeStatus,
                })
            }
            await expect(
                boundary.invoke(handler, { ...input, baseRevision: 'invalid' }),
            ).rejects.toThrow()
            for (const [code, status] of [
                ['configuration_conflict', 409],
                ['host_not_found', 404],
                ['runtime_unavailable', 503],
            ] as const) {
                boundary.failures.set(service, new EditorError(code))
                // oxlint-disable-next-line no-await-in-loop -- Each outcome changes the shared boundary fixture.
                expect(await boundary.invoke(handler, input)).toEqual({
                    success: false,
                    message: `admin.proxyHosts.config.errors.${code}`,
                })
                expect(boundary.status).toBe(status)
            }
        },
    )

    test.each([
        [
            handlers.saveProxyHostConfigEditorHandler,
            'saveProxyHostConfigEditorService',
            { proxyHostId: id, baseRevision: revision, settings: {} },
        ],
        [
            handlers.resetProxyHostConfigEditorHandler,
            'resetProxyHostConfigEditorService',
            { proxyHostId: id, baseRevision: revision },
        ],
    ])(
        'distinguishes disabled-host saves from pending %s activation',
        async (handler, service, input) => {
            for (const [enabled, runtimeStatus] of [
                [true, 'applied'],
                [false, 'applied'],
                [true, 'pending'],
            ] as const) {
                boundary.values.set(service, { enabled, runtimeStatus })
                // oxlint-disable-next-line no-await-in-loop -- Each outcome changes the shared boundary fixture.
                const result = await boundary.invoke(handler, input)
                expect(result).toMatchObject({ success: true, runtimeStatus })
                if (!enabled)
                    expect(result).toMatchObject({
                        message: 'admin.proxyHosts.config.hostSavedDisabled',
                    })
            }
            boundary.failures.set(service, new Error('private controller detail'))
            expect(await boundary.invoke(handler, input)).toEqual({
                success: false,
                message: 'admin.proxyHosts.config.errors.saveFailed',
            })
            expect(boundary.headers.get('Cache-Control')).toBe('private, no-store')
        },
    )

    test('checks apply permission and distinguishes controller refusal from an applied configuration', async () => {
        boundary.failures.set('requirePermissionService', new Error('denied'))
        expect(await boundary.invoke(handlers.applyProxyConfigurationHandler)).toMatchObject({
            success: false,
        })
        expect(boundary.argumentsFor('applyProxyConfigurationService')).toEqual([])
        boundary.failures.clear()
        for (const state of ['applied', 'pending']) {
            boundary.values.set('applyProxyConfigurationService', state)
            // oxlint-disable-next-line no-await-in-loop -- Each outcome changes the shared boundary fixture.
            expect(await boundary.invoke(handlers.applyProxyConfigurationHandler)).toMatchObject({
                success: state === 'applied',
            })
        }
    })
})
