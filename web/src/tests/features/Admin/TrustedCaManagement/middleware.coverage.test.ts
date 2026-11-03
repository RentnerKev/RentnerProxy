import { beforeEach, describe, expect, test } from 'bun:test'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { createMiddlewareHarness } from '@/tests/Helpers/middlewareCoverage.ts'
import { TrustedCaDomainError } from '@/server/Admin/TrustedCaManagement/trusted-cas.errors.ts'

const boundary = createMiddlewareHarness()
boundary.mockServices('@/server/Admin/TrustedCaManagement/trusted-cas.service.ts', [
    'createTrustedCaService',
    'deleteTrustedCaService',
    'getAssignableTrustedCasService',
    'getTrustedCasService',
    'replaceTrustedCaService',
])
const handlers = await import('@/features/Admin/TrustedCaManagement/middleware.ts')
const id = '0198d98a-0000-7000-8000-000000000881'
const certificate = {
    name: 'Fixture CA',
    pem: '-----BEGIN CERTIFICATE-----\nYQ==\n-----END CERTIFICATE-----',
}
beforeEach(() => boundary.reset())

describe('trusted CA server function boundary', () => {
    test.each([
        [
            handlers.createTrustedCaHandler,
            'createTrustedCaService',
            certificate,
            PERMISSIONS.TRUSTED_CAS_CREATE,
        ],
        [
            handlers.replaceTrustedCaHandler,
            'replaceTrustedCaService',
            { ...certificate, trustedCaId: id },
            PERMISSIONS.TRUSTED_CAS_UPDATE,
        ],
    ])(
        'authorizes %s before validating or forwarding CA material',
        async (handler, service, data, permission) => {
            boundary.failures.set('requirePermissionService', new Error('denied'))
            await expect(boundary.invoke(handler, data)).rejects.toThrow('denied')
            expect(boundary.argumentsFor(service)).toEqual([])
            expect(boundary.argumentsFor('requirePermissionService')).toEqual([[permission]])
            boundary.failures.clear()
            await expect(boundary.invoke(handler, { ...data, pem: 'invalid' })).rejects.toThrow()
            expect(boundary.argumentsFor(service)).toEqual([])
            for (const runtimeStatus of ['applied', 'pending']) {
                boundary.values.set(service, { runtimeStatus })
                // oxlint-disable-next-line no-await-in-loop -- Each outcome changes the shared boundary fixture.
                expect(await boundary.invoke(handler, data)).toMatchObject({
                    success: true,
                    runtimeStatus,
                })
            }
            boundary.failures.set(service, new Error('private CA detail'))
            expect(await boundary.invoke(handler, data)).toEqual({
                success: false,
                message: 'admin.trustedCas.errors.saveFailed',
            })
        },
    )

    test.each([
        ['trusted_ca_not_found', 404, 'notFound'],
        ['trusted_ca_duplicate', 409, 'duplicate'],
        ['trusted_ca_in_use', 409, 'inUse'],
        ['controller_unavailable', 503, 'controllerUnavailable'],
        ['invalid_input', 422, 'invalidInput'],
    ] as const)('maps CA error %s with HTTP %s', async (code, status, key) => {
        boundary.failures.set('deleteTrustedCaService', new TrustedCaDomainError(code))
        expect(await boundary.invoke(handlers.deleteTrustedCaHandler, { trustedCaId: id })).toEqual(
            { success: false, message: `admin.trustedCas.errors.${key}` },
        )
        expect(boundary.status).toBe(status)
    })

    test.each([
        [handlers.getTrustedCasHandler, 'getTrustedCasService'],
        [handlers.getAssignableTrustedCasHandler, 'getAssignableTrustedCasService'],
    ])('returns uncached %s reads and sanitizes errors', async (handler, service) => {
        boundary.values.set(service, [])
        expect(await boundary.invoke(handler)).toEqual([])
        expect(boundary.headers.get('Cache-Control')).toBe('private, no-store')
        boundary.failures.set(service, new Error('private CA detail'))
        await expect(boundary.invoke(handler)).rejects.toThrow('admin.trustedCas.errors.loadFailed')
    })
})
