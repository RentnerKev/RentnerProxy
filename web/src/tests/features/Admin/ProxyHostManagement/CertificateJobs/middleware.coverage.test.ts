import { beforeEach, expect, mock, test } from 'bun:test'
import { createMiddlewareHarness } from '@/tests/Helpers/middlewareCoverage.ts'
import { HostTagDomainError } from '@/lib/HostTags/hostTags.ts'
import { CertificateDomainError } from '@/server/Admin/CertificateManagement/certificates.errors.ts'
import { ProxyHostDomainError } from '@/server/Admin/ProxyHostManagement/proxy-hosts.errors.ts'
class JobError extends Error {
    constructor(readonly code: string) {
        super(code)
    }
}
const boundary = createMiddlewareHarness()
boundary.mockServices('@/server/Admin/ProxyHostManagement/certificate-jobs.service.ts', [
    'createProxyHostWithCertificateService',
    'updateProxyHostWithCertificateService',
    'requestProxyHostCertificateService',
    'getCertificateJobProgressService',
    'retryCertificateJobService',
])
mock.module('@/server/Admin/ProxyHostManagement/certificate-jobs.storage.server.ts', () => ({
    CertificateJobDomainError: JobError,
}))
const handlers = await import('@/features/Admin/ProxyHostManagement/CertificateJobs/middleware.ts')
const id = '0198d98a-0000-7000-8000-000000000881'
const host = {
    domains: ['Example.COM'],
    forwardScheme: 'http',
    forwardHost: '127.0.0.1',
    forwardPort: 8080,
    enabled: true,
}
const request = {
    name: ' Fixture certificate ',
    acceptTerms: true,
    environment: 'staging',
    challengeType: 'http-01',
}
const job = { id, stage: 'queued' }
beforeEach(() => boundary.reset())

test.each([
    [
        handlers.createProxyHostWithCertificateHandler,
        'createProxyHostWithCertificateService',
        { idempotencyKey: id.toUpperCase(), host, request },
    ],
    [
        handlers.updateProxyHostWithCertificateHandler,
        'updateProxyHostWithCertificateService',
        { idempotencyKey: id, host: { ...host, proxyHostId: id }, request },
    ],
    [
        handlers.requestProxyHostCertificateHandler,
        'requestProxyHostCertificateService',
        { idempotencyKey: id, proxyHostId: id, expectedUpdatedAt: '2026-01-01T00:00:00Z', request },
    ],
] as const)(
    'certificate-job actions validate and normalize their request before queue delegation',
    async (handler, service, data) => {
        await expect(boundary.invoke(handler, {})).rejects.toThrow()
        expect(boundary.calls).toHaveLength(0)
        boundary.values.set(service, job)
        const result = await boundary.invoke(handler, data)
        expect(result).toEqual({
            success: true,
            message: 'admin.proxyHosts.certificateJob.messages.queued',
            job,
        })
        const submitted = boundary.argumentsFor(service)[0]?.[0]
        expect(submitted).toMatchObject({
            idempotencyKey: id,
            request: {
                name: 'Fixture certificate',
                acceptTerms: true,
                environment: 'staging',
                challengeType: 'http-01',
            },
        })
        if ('host' in data)
            expect(submitted).toMatchObject({
                host: { domains: ['example.com'], forwardPort: 8080 },
            })
        else
            expect(submitted).toMatchObject({
                proxyHostId: id,
                expectedUpdatedAt: '2026-01-01T00:00:00Z',
            })
        expect(boundary.methods.get(handler)).toBe('POST')
        expect(boundary.headers.get('Cache-Control')).toBe('private, no-store')
    },
)

test('certificate-job progress and retry retain safe no-store transport and explicit job identifier', async () => {
    boundary.values.set('getCertificateJobProgressService', [job])
    expect(await boundary.invoke(handlers.getCertificateJobProgressHandler)).toEqual([job])
    expect(boundary.methods.get(handlers.getCertificateJobProgressHandler)).toBe('GET')
    boundary.values.set('retryCertificateJobService', job)
    expect(await boundary.invoke(handlers.retryCertificateJobHandler, { jobId: id })).toEqual({
        success: true,
        message: 'admin.proxyHosts.certificateJob.messages.retried',
        job,
    })
    expect(boundary.argumentsFor('retryCertificateJobService')).toEqual([[id]])
    boundary.failures.set(
        'getCertificateJobProgressService',
        new Error('private controller details'),
    )
    await expect(boundary.invoke(handlers.getCertificateJobProgressHandler)).rejects.toThrow(
        'admin.proxyHosts.certificateJob.errors.loadFailed',
    )
})

test.each([
    [new HostTagDomainError('missing'), 200, 'admin.hostTags.errors.missing'],
    [new JobError('job_not_found'), 404, 'admin.proxyHosts.certificateJob.errors.job_not_found'],
    [
        new JobError('idempotency_conflict'),
        409,
        'admin.proxyHosts.certificateJob.errors.idempotency_conflict',
    ],
    [new JobError('acme_failed'), 409, 'admin.certificates.errors.acme_failed'],
    [
        new CertificateDomainError('controller_unavailable'),
        503,
        'admin.certificates.errors.controller_unavailable',
    ],
    [new CertificateDomainError('acme_failed'), 422, 'admin.certificates.errors.acme_failed'],
    [
        new ProxyHostDomainError('proxy_host_not_found', 'private'),
        404,
        'admin.proxyHosts.errors.proxy_host_not_found',
    ],
    [
        new ProxyHostDomainError('invalid_input', 'private'),
        400,
        'admin.proxyHosts.errors.invalid_input',
    ],
    [
        new ProxyHostDomainError('domain_conflict', 'private'),
        409,
        'admin.proxyHosts.errors.domain_conflict',
    ],
    [new Error('private stack'), 200, 'admin.proxyHosts.certificateJob.errors.actionFailed'],
] as const)(
    'certificate-job errors distinguish domain status and return only public localization keys',
    async (failure, status, message) => {
        boundary.failures.set('retryCertificateJobService', failure)
        expect(await boundary.invoke(handlers.retryCertificateJobHandler, { jobId: id })).toEqual({
            success: false,
            message,
        })
        expect(boundary.status).toBe(status)
        expect(boundary.headers.get('Cache-Control')).toBe('private, no-store')
    },
)
