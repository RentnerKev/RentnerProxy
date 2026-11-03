import { beforeEach, describe, expect, test } from 'bun:test'
import { createMiddlewareHarness } from '@/tests/Helpers/middlewareCoverage.ts'
import { CertificateDomainError } from '@/server/Admin/CertificateManagement/certificates.errors.ts'

const boundary = createMiddlewareHarness()
boundary.mockServices('@/server/Admin/CertificateManagement/certificates.service.ts', [
    'actOnManualDnsService',
    'cancelDelegatedCertificateService',
    'deleteCertificateService',
    'getAssignableCertificatesService',
    'getCertificatesService',
    'importCertificateService',
    'renewCertificateService',
    'replaceCertificateService',
    'requestCertificateService',
    'searchCertificatesService',
])
boundary.mockServices('@/server/Admin/CertificateManagement/dns-setup.service.ts', [
    'inspectCertificateDnsSetupService',
    'checkManualDnsService',
])
boundary.mockServices('@/server/Admin/DnsConnections/dns-providers.service.ts', [
    'getDnsProvidersService',
    'getCertificateDnsConnectionsService',
])
const handlers = await import('@/features/Admin/CertificateManagement/middleware.ts')
const id = '0198d98a-0000-7000-8000-000000000881'
const operation = { certificateId: id, operationId: id, challengeSetId: id }
const pem = {
    name: 'Imported certificate',
    certificatePem: 'fixture-cert',
    privateKeyPem: 'fixture-key',
}
beforeEach(() => boundary.reset())

describe('certificate server function boundary', () => {
    test.each([
        [handlers.importCertificateHandler, 'importCertificateService', pem, 'imported'],
        [
            handlers.replaceCertificateHandler,
            'replaceCertificateService',
            { ...pem, certificateId: id },
            'replaced',
        ],
        [
            handlers.requestCertificateHandler,
            'requestCertificateService',
            { name: 'Issued', domains: ['example.com'], acceptTerms: true },
            'requested',
        ],
        [
            handlers.renewCertificateHandler,
            'renewCertificateService',
            { certificateId: id },
            'renewing',
        ],
        [
            handlers.continueManualDnsHandler,
            'actOnManualDnsService',
            operation,
            'manualDns.checking',
        ],
        [
            handlers.cancelManualDnsHandler,
            'actOnManualDnsService',
            operation,
            'manualDns.cancelled',
        ],
        [
            handlers.cancelDelegatedCertificateHandler,
            'cancelDelegatedCertificateService',
            { certificateId: id, operationId: id },
            'delegatedDns.cancelling',
        ],
    ])(
        'delegates validated certificate actions and sanitizes failures (%s)',
        async (handler, service, input, message) => {
            boundary.values.set(service, id)
            expect(await boundary.invoke(handler, input)).toEqual({
                success: true,
                certificateId: id,
                message: `admin.certificates.${message.includes('.') ? message : `messages.${message}`}`,
            })
            expect(boundary.argumentsFor(service)[0]?.[0]).toEqual(
                service === 'renewCertificateService' ? id : expect.objectContaining(input),
            )
            expect(boundary.headers.get('Cache-Control')).toBe('private, no-store')
            expect(boundary.methods.get(handler as object)).toBe('POST')
            boundary.failures.set(service, new Error('private fixture detail'))
            expect(await boundary.invoke(handler, input)).toEqual({
                success: false,
                message: 'admin.certificates.errors.actionFailed',
            })
        },
    )

    test.each([
        ['certificate_not_found', 404],
        ['certificate_in_use', 409],
        ['operation_in_progress', 409],
        ['controller_unavailable', 503],
        ['certificate_store_unavailable', 503],
        ['invalid_certificate', 422],
    ] as const)('maps domain code %s to HTTP %s without exposing details', async (code, status) => {
        boundary.failures.set('renewCertificateService', new CertificateDomainError(code))
        expect(
            await boundary.invoke(handlers.renewCertificateHandler, { certificateId: id }),
        ).toEqual({ success: false, message: `admin.certificates.errors.${code}` })
        expect(boundary.status).toBe(status)
    })

    test('distinguishes completed deletion from pending runtime deletion', async () => {
        for (const deleted of [true, false]) {
            boundary.values.set('deleteCertificateService', { deleted, runtimeStatus: 'pending' })
            expect(
                // oxlint-disable-next-line no-await-in-loop -- Each outcome changes the shared boundary fixture.
                await boundary.invoke(handlers.deleteCertificateHandler, { certificateId: id }),
            ).toEqual({
                success: true,
                runtimeStatus: 'pending',
                message: deleted
                    ? 'admin.certificates.messages.deleted'
                    : 'admin.certificates.messages.deletePending',
            })
        }
    })

    test.each([
        [handlers.getCertificatesHandler, 'getCertificatesService'],
        [handlers.getAssignableCertificatesHandler, 'getAssignableCertificatesService'],
        [handlers.getCertificateDnsProvidersHandler, 'getDnsProvidersService'],
        [handlers.getCertificateDnsConnectionsHandler, 'getCertificateDnsConnectionsService'],
    ])(
        'returns uncached query values and safe unavailable errors (%s)',
        async (handler, service) => {
            boundary.values.set(service, ['fixture'])
            expect(await boundary.invoke(handler)).toEqual(['fixture'])
            expect(boundary.headers.get('Cache-Control')).toBe('private, no-store')
            boundary.failures.set(service, new Error('private fixture detail'))
            await expect(boundary.invoke(handler)).rejects.toThrow()
        },
    )

    test('requires certificate view permission before search and validates operation identifiers', async () => {
        boundary.failures.set('requirePermissionService', new Error('denied'))
        await expect(
            boundary.invoke(handlers.searchCertificatesHandler, { query: 'example' }),
        ).rejects.toThrow()
        expect(boundary.argumentsFor('searchCertificatesService')).toEqual([])
        await expect(
            boundary.invoke(handlers.continueManualDnsHandler, {
                ...operation,
                operationId: 'invalid',
            }),
        ).rejects.toThrow()
        expect(boundary.argumentsFor('actOnManualDnsService')).toEqual([])
        boundary.failures.clear()
        boundary.values.set('requirePermissionService', { userId: id })
        boundary.values.set('searchCertificatesService', ['fixture'])
        expect(
            await boundary.invoke(handlers.searchCertificatesHandler, { query: 'example' }),
        ).toEqual(['fixture'])
        expect(boundary.argumentsFor('searchCertificatesService')).toEqual([
            [{ userId: id }, { query: 'example' }],
        ])
    })

    test.each([
        [
            handlers.inspectCertificateDnsSetupHandler,
            'inspectCertificateDnsSetupService',
            {
                domains: ['example.com'],
                environment: 'staging',
                dnsMode: 'provider',
                connectionId: id,
                expectedRevision: 1,
                zoneId: 'a'.repeat(32),
            },
            'setup',
        ],
        [handlers.checkManualDnsHandler, 'checkManualDnsService', operation, 'check'],
    ])(
        'returns validated DNS observations through %s and maps unavailable checks',
        async (handler, service, input, key) => {
            boundary.values.set(service, { ready: true })
            expect(await boundary.invoke(handler, input)).toEqual({
                success: true,
                [key]: { ready: true },
            })
            expect(boundary.argumentsFor(service)).toEqual([[input]])
            boundary.failures.set(service, new CertificateDomainError('controller_unavailable'))
            expect(await boundary.invoke(handler, input)).toEqual({
                success: false,
                message: 'admin.certificates.errors.controller_unavailable',
            })
            expect(boundary.status).toBe(503)
        },
    )
})
