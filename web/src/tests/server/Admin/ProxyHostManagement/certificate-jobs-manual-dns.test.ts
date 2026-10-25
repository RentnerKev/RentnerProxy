import { expect, test } from 'bun:test'
import { getCertificateJobManualDnsState } from '@/server/Admin/ProxyHostManagement/certificate-jobs.manual.ts'
import type { ControllerCertificateMetadata } from '@/server/Controller/Types/certificates.types.ts'
import { runBunScript } from '@/tests/Helpers/runBunScript.ts'

test('manual binding job releases its claim while paused, survives long wait/restart without reissuing, and binds only the completed certificate', async () => {
    const output = await runBunScript(
        `
        import { mock } from 'bun:test'
        const id = '0198d98a-0000-7000-8000-000000000001'
        const operationId = '0198d98a-0000-7000-8000-000000000002'
        let available = true; let issued = 0; let renewed = 0; let bound = 0; let activated = 0; let now = Date.now(); let metadata = null
        const originalNow = Date.now; Date.now = () => now
        let job = { id, certificateId: id, stage: 'preparing', domains: ['example.com'], requestCiphertext: 'sealed', requestIv: 'sealed', controllerOperationId: null, assignedRevision: null, retryRequested: false, attemptCount: 1 }
        const patches = []; const saved = []; const releases = []
        const transaction = { update: () => ({ set: (changes) => ({ where: async () => { Object.assign(job, changes); patches.push(changes) } }) }) }
        mock.module('./server/Admin/ProxyHostManagement/certificate-jobs.lease.server.ts', () => ({
            claimCertificateJob: async () => { if (!available) return null; available = false; job.leaseToken = 'claim'; return { ...job } },
            withCertificateJobClaim: async (claimed, callback) => callback(transaction, job),
            releaseCertificateJob: async (claimed, changes = {}) => { releases.push(changes); Object.assign(job, changes, { leaseToken: null, leaseExpiresAt: null }) },
        }))
        mock.module('./server/Admin/ProxyHostManagement/certificate-jobs.storage.server.ts', () => ({ CertificateJobDomainError: class extends Error {}, certificateJobDigest: (value) => JSON.stringify(value), validateCertificateJobContext: async () => ({}) }))
        mock.module('./server/Auth/Core/encryption.server.ts', () => ({ decryptSecret: async () => JSON.stringify({ name: 'Manual', domains: ['example.com'], challengeType: 'dns-01', dnsMode: 'manual', acceptTerms: true }) }))
        mock.module('./server/Admin/CertificateManagement/certificate-metadata.persistence.ts', () => ({ persistControllerCertificatesMetadataInTransaction: async (tx, values) => saved.push(...values) }))
        mock.module('./server/Admin/ProxyHostManagement/certificate-jobs.binding.server.ts', () => ({ certificateJobRuntime: {}, bindIssuedJobCertificate: async () => { bound++; job.stage = 'applying'; return true }, confirmJobRuntime: async () => { activated++; job.stage = 'applied'; job.requestCiphertext = null; job.requestIv = null; job.leaseToken = null; return true } }))
        const { CertificateDomainError } = await import('./server/Admin/CertificateManagement/certificates.errors.ts')
        const { runCertificateJobsOnce } = await import('./server/Admin/ProxyHostManagement/certificate-jobs.worker.server.ts')
        const controller = {
            get: async () => { if (!metadata) throw new CertificateDomainError('certificate_not_found'); return metadata },
            issue: async (certificateId, request) => {
                issued++; if (request.dnsMode !== 'manual' || request.dnsProvider) throw new Error('manual request lost')
                metadata = { id: certificateId, source: 'acme', status: 'pending', operation: 'issuing', candidate: null, lastErrorCode: null, currentOperation: { id: operationId, kind: 'issue', dnsMode: 'manual', stage: 'awaiting_dns', manualDns: { status: 'awaiting_input', lastErrorCode: null } } }
                return metadata
            },
            renew: async () => { renewed++; return metadata },
        }
        try {
            await runCertificateJobsOnce(controller, {})
            const first = { ...job }
            // Simulate a process restart and 45 minutes of operator DNS propagation time, without sleeping.
            job = JSON.parse(JSON.stringify(job)); now += 45 * 60_000; available = true
            metadata = { ...metadata, status: 'valid', operation: 'renewing', currentOperation: { ...metadata.currentOperation, kind: 'renew', manualDns: { status: 'awaiting_input', lastErrorCode: 'manual_dns_not_propagated' } } }
            job.retryRequested = true
            await runCertificateJobsOnce(controller, {})
            const paused = { ...job }; const beforeComplete = { issued, renewed, bound, activated }
            available = true; metadata = { ...metadata, operation: 'idle', currentOperation: { ...metadata.currentOperation, stage: 'applied', manualDns: { status: 'complete', lastErrorCode: null } } }
            await runCertificateJobsOnce(controller, {})
            console.log(JSON.stringify({ first, paused, beforeComplete, final: job, issued, renewed, bound, activated, releases, savedCount: saved.length }))
        } finally { Date.now = originalNow }
    `,
        { cwd: new URL('../../../..', import.meta.url) },
    )
    const result = JSON.parse(output)
    expect(result.first.stage).toBe('issuing')
    expect(result.first.controllerStage).toBe('awaiting_dns')
    expect(result.first.leaseToken).toBeNull()
    expect(result.paused.stage).toBe('issuing')
    expect(result.paused.lastErrorCode).toBeNull()
    expect(result.paused.retryRequested).toBeFalse()
    expect(result.paused.leaseToken).toBeNull()
    expect(result.beforeComplete).toEqual({ issued: 1, renewed: 0, bound: 0, activated: 0 })
    expect(result.releases).toHaveLength(2)
    expect(
        result.releases.every(
            (release: { nextAttemptAt: string }) => Date.parse(release.nextAttemptAt) > 0,
        ),
    ).toBeTrue()
    expect(result.final.stage).toBe('applied')
    expect(result.final.requestCiphertext).toBeNull()
    expect(result.issued).toBe(1)
    expect(result.bound).toBe(1)
    expect(result.activated).toBe(1)
})

test('a reused-authorization manual order with zero records and terminal needs_attention never binds the old valid certificate', async () => {
    const output = await runBunScript(
        `
        import { mock } from 'bun:test'
        const id = '0198d98a-0000-7000-8000-000000000001'
        let available = true; let bound = 0; let activated = 0
        const job = { id, certificateId: id, stage: 'issuing', domains: ['example.com'], controllerOperationId: id, assignedRevision: null, retryRequested: false }
        const transaction = { update: () => ({ set: (changes) => ({ where: async () => Object.assign(job, changes) }) }) }
        mock.module('./server/Admin/ProxyHostManagement/certificate-jobs.lease.server.ts', () => ({ claimCertificateJob: async () => { if (!available) return null; available = false; return { ...job } }, withCertificateJobClaim: async (claimed, callback) => callback(transaction, job), releaseCertificateJob: async (claimed, changes = {}) => Object.assign(job, changes, { leaseToken: null }) }))
        mock.module('./server/Admin/ProxyHostManagement/certificate-jobs.storage.server.ts', () => ({ CertificateJobDomainError: class extends Error {}, certificateJobDigest: JSON.stringify, validateCertificateJobContext: async () => ({}) }))
        mock.module('./server/Admin/CertificateManagement/certificate-metadata.persistence.ts', () => ({ persistControllerCertificatesMetadataInTransaction: async () => undefined }))
        mock.module('./server/Admin/ProxyHostManagement/certificate-jobs.binding.server.ts', () => ({ certificateJobRuntime: {}, bindIssuedJobCertificate: async () => { bound++; return true }, confirmJobRuntime: async () => { activated++; return true } }))
        const { runCertificateJobsOnce } = await import('./server/Admin/ProxyHostManagement/certificate-jobs.worker.server.ts')
        const metadata = { id, source: 'acme', status: 'valid', operation: 'idle', candidate: null, lastErrorCode: 'acme_failed', currentOperation: { id, kind: 'renew', dnsMode: 'manual', stage: 'needs_attention' } }
        await runCertificateJobsOnce({ get: async () => metadata, issue: async () => { throw new Error('must not reissue') }, renew: async () => { throw new Error('must not renew') } }, {})
        const blocked = { job: { ...job }, bound, activated }
        metadata.currentOperation.stage = 'applied'; metadata.lastErrorCode = null; available = true
        await runCertificateJobsOnce({ get: async () => metadata, issue: async () => { throw new Error('must not reissue') }, renew: async () => { throw new Error('must not renew') } }, {})
        console.log(JSON.stringify({ ...blocked, completed: { bound, activated } }))
    `,
        { cwd: new URL('../../../..', import.meta.url) },
    )
    const result = JSON.parse(output)
    expect(result.job.stage).toBe('failed')
    expect(result.job.controllerStage).toBe('needs_attention')
    expect(result.job.lastErrorCode).toBe('acme_failed')
    expect(result.job.leaseToken).toBeNull()
    expect(result.bound).toBe(0)
    expect(result.activated).toBe(0)
    expect(result.completed).toEqual({ bound: 1, activated: 1 })
})

const appliedManualMetadata: ControllerCertificateMetadata = {
    id: '0198d98a-0000-7000-8000-000000000001',
    source: 'acme',
    environment: 'production',
    domains: ['example.com'],
    status: 'valid',
    operation: 'idle',
    candidate: null,
    lastErrorCode: null,
    issuedAt: '2026-10-25T12:00:00Z',
    expiresAt: '2027-01-25T12:00:00Z',
    issuer: 'Fixture',
    fingerprint: 'sha256:' + 'a'.repeat(64),
    updatedAt: '2026-10-25T12:00:00Z',
    currentOperation: {
        id: '0198d98a-0000-7000-8000-000000000002',
        kind: 'renew',
        dnsMode: 'manual',
        stage: 'applied',
        startedAt: '2026-10-25T11:00:00Z',
        updatedAt: '2026-10-25T12:00:00Z',
    },
}

test('manual completion requires applied material and never accepts a still pending candidate', () => {
    expect(getCertificateJobManualDnsState(appliedManualMetadata)).toBe('complete')
    expect(
        getCertificateJobManualDnsState({
            ...appliedManualMetadata,
            currentOperation: {
                ...appliedManualMetadata.currentOperation!,
                stage: 'certificate_ready',
            },
            candidate: {
                fingerprint: 'sha256:' + 'b'.repeat(64),
                issuedAt: '2026-10-25T12:00:00Z',
                expiresAt: '2027-01-25T12:00:00Z',
                lastErrorCode: null,
                nextAttemptAt: null,
            },
        }),
    ).toBe('pending')
    expect(
        getCertificateJobManualDnsState({
            ...appliedManualMetadata,
            currentOperation: { ...appliedManualMetadata.currentOperation!, stage: 'applied' },
            candidate: {
                fingerprint: 'sha256:' + 'b'.repeat(64),
                issuedAt: '2026-10-25T12:00:00Z',
                expiresAt: '2027-01-25T12:00:00Z',
                lastErrorCode: null,
                nextAttemptAt: null,
            },
        }),
    ).toBe('pending')
    expect(
        getCertificateJobManualDnsState({
            ...appliedManualMetadata,
            currentOperation: {
                ...appliedManualMetadata.currentOperation!,
                dnsMode: 'provider',
                stage: 'needs_attention',
            },
        }),
    ).toBe('not_manual')
    expect(
        getCertificateJobManualDnsState({
            ...appliedManualMetadata,
            challengeType: 'http-01',
            currentOperation: null,
        }),
    ).toBe('not_manual')
})
