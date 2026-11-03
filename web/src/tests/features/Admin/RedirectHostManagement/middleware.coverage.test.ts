import { beforeEach, describe, expect, test } from 'bun:test'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { createMiddlewareHarness } from '@/tests/Helpers/middlewareCoverage.ts'
import { RedirectHostDomainError } from '@/server/Admin/RedirectHostManagement/redirect-hosts.errors.ts'
import { CertificateDomainError } from '@/server/Admin/CertificateManagement/certificates.errors.ts'

const boundary = createMiddlewareHarness()
boundary.mockServices('@/server/Admin/RedirectHostManagement/redirect-hosts.service.ts', [
    'searchRedirectHostsService',
    'createRedirectHostService',
    'deleteRedirectHostService',
    'disableRedirectHostService',
    'enableRedirectHostService',
    'updateRedirectHostService',
])
boundary.mockServices('@/server/Admin/HostTags/host-list.service.ts', [
    'getRedirectHostPageService',
])
boundary.mockServices('@/server/Admin/CertificateManagement/certificates.service.ts', [
    'getAssignableCertificatesService',
])
boundary.mockServices('@/server/ProxyRuntime/proxy-runtime.service.ts', [
    'applyRedirectConfigurationService',
    'getRedirectRuntimeStatusService',
])
const handlers = await import('@/features/Admin/RedirectHostManagement/middleware.ts')
const id = '0198d98a-0000-7000-8000-000000000881'
const host = {
    domains: ['example.com'],
    destination: 'https://target.example/',
    statusCode: 301,
    preserveRequestUri: false,
    enabled: true,
}
beforeEach(() => boundary.reset())

describe('redirect host request boundary', () => {
    test.each([
        [
            handlers.createRedirectHostHandler,
            'createRedirectHostService',
            host,
            PERMISSIONS.REDIRECT_HOSTS_CREATE,
        ],
        [
            handlers.updateRedirectHostHandler,
            'updateRedirectHostService',
            { ...host, redirectHostId: id },
            PERMISSIONS.REDIRECT_HOSTS_UPDATE,
        ],
        [
            handlers.deleteRedirectHostHandler,
            'deleteRedirectHostService',
            { redirectHostId: id },
            PERMISSIONS.REDIRECT_HOSTS_DELETE,
        ],
        [
            handlers.enableRedirectHostHandler,
            'enableRedirectHostService',
            { redirectHostId: id },
            PERMISSIONS.REDIRECT_HOSTS_ENABLE,
        ],
        [
            handlers.disableRedirectHostHandler,
            'disableRedirectHostService',
            { redirectHostId: id },
            PERMISSIONS.REDIRECT_HOSTS_DISABLE,
        ],
    ])(
        'requires the specific mutation permission before %s',
        async (handler, service, input, permission) => {
            boundary.failures.set('requirePermissionService', new Error('denied'))
            expect(await boundary.invoke(handler, input)).toMatchObject({ success: false })
            expect(boundary.argumentsFor(service)).toEqual([])
            expect(boundary.argumentsFor('requirePermissionService')).toEqual([[permission]])
            boundary.failures.clear()
            for (const runtimeStatus of ['applied', 'pending']) {
                boundary.values.set(service, { runtimeStatus })
                // oxlint-disable-next-line no-await-in-loop -- Each outcome changes the shared boundary fixture.
                const result = await boundary.invoke(handler, input)
                expect(result).toMatchObject({ success: true, runtimeStatus })
                if (runtimeStatus === 'pending')
                    expect(result).toMatchObject({
                        message: 'admin.redirectHosts.runtime.savedPending',
                    })
            }
        },
    )

    test.each([
        ['host_not_found', 404],
        ['invalid_input', 400],
        ['domain_conflict', 409],
    ] as const)(
        'maps redirect error %s without disclosing private details',
        async (code, status) => {
            boundary.failures.set(
                'deleteRedirectHostService',
                new RedirectHostDomainError(code, 'private fixture detail'),
            )
            expect(
                await boundary.invoke(handlers.deleteRedirectHostHandler, { redirectHostId: id }),
            ).toEqual({ success: false, message: `admin.redirectHosts.errors.${code}` })
            expect(boundary.status).toBe(status)
        },
    )

    test('requires create or update permission in addition to view before listing assignable certificates', async () => {
        boundary.values.set('requirePermissionService', {
            permissions: [PERMISSIONS.REDIRECT_HOSTS_VIEW],
        })
        await expect(
            boundary.invoke(handlers.getAssignableRedirectCertificatesHandler),
        ).rejects.toThrow('admin.redirectHosts.errors.certificatesLoadFailed')
        expect(boundary.argumentsFor('getAssignableCertificatesService')).toEqual([])
        for (const permission of [
            PERMISSIONS.REDIRECT_HOSTS_CREATE,
            PERMISSIONS.REDIRECT_HOSTS_UPDATE,
        ]) {
            boundary.values.set('requirePermissionService', {
                permissions: [PERMISSIONS.REDIRECT_HOSTS_VIEW, permission],
            })
            boundary.values.set('getAssignableCertificatesService', [])
            expect(
                // oxlint-disable-next-line no-await-in-loop -- Each outcome changes the shared boundary fixture.
                await boundary.invoke(handlers.getAssignableRedirectCertificatesHandler),
            ).toEqual([])
        }
    })

    test.each([
        [handlers.getRedirectHostPageHandler, 'getRedirectHostPageService', {}],
        [handlers.getRedirectRuntimeStatusHandler, 'getRedirectRuntimeStatusService', undefined],
        [handlers.searchRedirectHostsHandler, 'searchRedirectHostsService', { query: 'fixture' }],
    ])(
        'localizes %s query failures and preserves safe service results',
        async (handler, service, input) => {
            boundary.values.set(service, [])
            expect(await boundary.invoke(handler, input)).toEqual([])
            boundary.failures.set(service, new Error('private fixture detail'))
            await expect(boundary.invoke(handler, input)).rejects.toThrow('admin.redirectHosts.')
        },
    )

    test('maps certificate failures and distinguishes controller apply outcomes', async () => {
        boundary.failures.set(
            'enableRedirectHostService',
            new CertificateDomainError('controller_unavailable'),
        )
        expect(
            await boundary.invoke(handlers.enableRedirectHostHandler, { redirectHostId: id }),
        ).toEqual({ success: false, message: 'admin.certificates.errors.controller_unavailable' })
        expect(boundary.status).toBe(503)
        for (const status of ['pending', 'applied']) {
            boundary.values.set('applyRedirectConfigurationService', status)
            // oxlint-disable-next-line no-await-in-loop -- Each outcome changes the shared boundary fixture.
            expect(await boundary.invoke(handlers.applyRedirectConfigurationHandler)).toMatchObject(
                { success: status === 'applied' },
            )
        }
        boundary.failures.set(
            'applyRedirectConfigurationService',
            new Error('private controller detail'),
        )
        expect(await boundary.invoke(handlers.applyRedirectConfigurationHandler)).toEqual({
            success: false,
            message: 'admin.redirectHosts.runtime.applyFailed',
        })
    })
})
