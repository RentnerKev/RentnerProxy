import assert from 'node:assert/strict'
import { X509Certificate } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { assertHttp3Response, requestHttp3Client } from '../http3-client'
import { ReliabilityError, type ReliabilityContext } from './harness'

const metadataSchema = z.object({
    status: z.string(),
    operation: z.string(),
    fingerprint: z
        .string()
        .regex(/^sha256:[a-f0-9]{64}$/u)
        .nullable(),
    lastErrorCode: z.string().nullable(),
    currentOperation: z.object({ id: z.string().uuid(), stage: z.string() }).nullable(),
    candidate: z.object({ fingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/u) }).nullable(),
})
type CertificateMetadata = z.output<typeof metadataSchema>
type CertificateState = { activeCaFile: string; issuanceCaFile: string; activeId: string }
const states = new WeakMap<ReliabilityContext, CertificateState>()
const socketPath = '/var/lib/rentnerproxy/proxy/caddy-admin.sock'

function certificateId(value: unknown): string {
    assert.equal(typeof value, 'string', 'Certificate fixture must return an identifier')
    assert.match(value as string, /^[a-f0-9-]{36}$/u, 'Certificate identifier must be a UUID')
    return value as string
}

async function metadata(context: ReliabilityContext, id: string): Promise<CertificateMetadata> {
    const response = await context.controller('/internal/v1/certificates/' + id)
    assert.equal(response.status, 200, 'Certificate metadata must remain readable')
    const parsed = metadataSchema.safeParse(response.body)
    assert.ok(parsed.success, 'Certificate metadata must have a valid public DTO')
    return parsed.data
}

async function idleCertificate(context: ReliabilityContext, id: string, label: string) {
    let result: CertificateMetadata | undefined
    await context.waitFor(
        async () => {
            result = await metadata(context, id)
            return result.operation === 'idle'
        },
        label,
        120_000,
    )
    assert.ok(result)
    return result
}

async function verifyCertificate(context: ReliabilityContext, caFile: string, fingerprint: string) {
    for (const protocol of ['--http1.1', '--http3-only'] as const) {
        // eslint-disable-next-line no-await-in-loop
        const response = await requestHttp3Client(context.command, {
            image: context.http3Image,
            caFile,
            hostname: context.domain,
            port: context.tlsPort,
            address: context.container,
            network: context.network,
            path: '/certificate-reliability',
            protocol,
        })
        assert.equal(response.status, 200, 'Verified TLS traffic must reach the fixture upstream')
        if (protocol === '--http3-only') assertHttp3Response(response, 200, context.tlsPort)
        else assert.equal(response.protocol, '1.1')
        assert.equal(
            response.fingerprint,
            fingerprint,
            'A fresh handshake must serve active material',
        )
    }
    context.check('proxy', 'Verified TLS and HTTP/3 certificate fingerprint')
}

async function readOperationEvents(context: ReliabilityContext, operationId: string) {
    const events: { id: string; operationId: string; kind: string }[] = []
    let after: string | undefined
    for (let page = 0; page < 100; page += 1) {
        const query = new URLSearchParams({ limit: '25' })
        if (after) query.set('after', after)
        // eslint-disable-next-line no-await-in-loop
        const response = await context.controller('/internal/v1/certificates/events?' + query)
        assert.equal(response.status, 200)
        assert.ok(Array.isArray(response.body.events) && response.body.events.length <= 25)
        for (const event of response.body.events) {
            assert.equal(typeof event.id, 'string')
            assert.equal(typeof event.operationId, 'string')
            assert.equal(typeof event.kind, 'string')
            events.push({ id: event.id, operationId: event.operationId, kind: event.kind })
        }
        if (!response.body.hasMore) {
            assert.equal(new Set(events.map((event) => event.id)).size, events.length)
            return events.filter((event) => event.operationId === operationId)
        }
        assert.equal(typeof response.body.nextCursor, 'string')
        assert.notEqual(response.body.nextCursor, after)
        after = response.body.nextCursor
    }
    throw new Error('Certificate event pagination exceeded its bound')
}

async function reconnectPebble(context: ReliabilityContext) {
    await context.docker([
        'network',
        'connect',
        '--alias',
        'pebble',
        context.network,
        context.pebble,
    ])
    await context.waitFor(
        async () => {
            await context.docker([
                'exec',
                context.container,
                'curl',
                '--silent',
                '--fail',
                '--max-time',
                '3',
                '--cacert',
                '/test/pebble.minica.pem',
                'https://pebble:14000/dir',
            ])
            return true
        },
        'Local ACME directory reconnected',
        30_000,
    )
}

export async function prepareCertificateFixture(
    context: ReliabilityContext,
): Promise<{ caFile: string }> {
    assert.match(context.domain, /^[a-z0-9.-]+$/u)
    const openssl = (args: string[]) =>
        context.docker(['exec', context.container, 'openssl', ...args])
    await openssl([
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-sha256',
        '-days',
        '2',
        '-subj',
        '/CN=RentnerProxy isolated reliability CA',
        '-keyout',
        '/tmp/reliability-ca.key',
        '-out',
        '/tmp/reliability-ca.pem',
        '-addext',
        'basicConstraints=critical,CA:TRUE',
        '-addext',
        'keyUsage=critical,keyCertSign,cRLSign',
    ])
    await openssl([
        'req',
        '-new',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-sha256',
        '-subj',
        '/CN=' + context.domain,
        '-keyout',
        '/tmp/reliability-certificate.key',
        '-out',
        '/tmp/reliability-certificate.csr',
        '-addext',
        'subjectAltName=DNS:' + context.domain,
    ])
    await openssl([
        'x509',
        '-req',
        '-in',
        '/tmp/reliability-certificate.csr',
        '-CA',
        '/tmp/reliability-ca.pem',
        '-CAkey',
        '/tmp/reliability-ca.key',
        '-CAcreateserial',
        '-days',
        '2',
        '-sha256',
        '-copy_extensions',
        'copy',
        '-out',
        '/tmp/reliability-certificate.pem',
    ])
    await context.docker([
        'exec',
        context.container,
        'chmod',
        '600',
        '/tmp/reliability-ca.key',
        '/tmp/reliability-certificate.key',
    ])
    const caFile = join(context.temp, 'reliability-ca.pem')
    await context.docker(['cp', context.container + ':/tmp/reliability-ca.pem', caFile])
    const imported = await context.fixture('certificate-import')
    const id = certificateId(imported.certificateId)
    await context.synced(await context.fixture('certificate-bind', { certificateId: id }))
    const active = await metadata(context, id)
    assert.equal(active.status, 'valid')
    assert.ok(active.fingerprint)
    await verifyCertificate(context, caFile, active.fingerprint)
    const minicaPath = join(context.temp, 'pebble.minica.pem')
    const rootPem = await context.docker([
        'run',
        '--rm',
        '--network',
        context.network,
        '--volume',
        minicaPath + ':/test-ca.pem:ro',
        context.http3Image,
        '--silent',
        '--show-error',
        '--fail',
        '--noproxy',
        '*',
        '--max-time',
        '10',
        '--cacert',
        '/test-ca.pem',
        '--connect-to',
        'localhost:15000:pebble:15000',
        'https://localhost:15000/roots/0',
    ])
    assert.ok(new X509Certificate(rootPem).ca, 'Local ACME issuance root must be a CA')
    const issuanceCaFile = join(context.temp, 'reliability-issuance-ca.pem')
    await writeFile(issuanceCaFile, rootPem, { mode: 0o600 })
    states.set(context, { activeCaFile: caFile, issuanceCaFile, activeId: id })
    context.check('reload', 'Local CA certificate imported and bound')
    return { caFile }
}

async function failedCandidateRecovery(context: ReliabilityContext, id: string, caFile: string) {
    const previous = await metadata(context, id)
    assert.ok(previous.fingerprint)
    await context.docker(['exec', context.container, 'test', '-S', socketPath])
    await context.docker(['exec', context.container, 'rm', '--', socketPath])
    let disconnected = false
    let runtimeRestored = false
    try {
        const accepted = await context.controller('/internal/v1/certificates/' + id + '/renew', {})
        assert.equal(accepted.status, 202)
        let failed: CertificateMetadata | undefined
        await context.waitFor(
            async () => {
                failed = await metadata(context, id)
                return (
                    failed.operation === 'idle' &&
                    failed.candidate !== null &&
                    failed.fingerprint === previous.fingerprint
                )
            },
            'Issued candidate retained after Caddy apply failure',
            120_000,
        )
        assert.ok(failed?.candidate && failed.currentOperation)
        assert.equal(failed.lastErrorCode, 'runtime_apply_failed')
        assert.notEqual(failed.candidate.fingerprint, previous.fingerprint)
        await verifyCertificate(context, caFile, previous.fingerprint)
        const operationId = failed.currentOperation.id
        const candidateFingerprint = failed.candidate.fingerprint
        await context.docker(['network', 'disconnect', context.network, context.pebble])
        disconnected = true
        await context.restart()
        runtimeRestored = true
        const persisted = await metadata(context, id)
        assert.equal(persisted.currentOperation?.id, operationId)
        assert.equal(persisted.candidate?.fingerprint, candidateFingerprint)
        assert.equal(persisted.fingerprint, previous.fingerprint)
        assert.equal(
            (await context.controller('/internal/v1/certificates/' + id + '/renew', {})).status,
            202,
        )
        let activated: CertificateMetadata | undefined
        await context.waitFor(
            async () => {
                activated = await metadata(context, id)
                return (
                    activated.operation === 'idle' &&
                    activated.candidate === null &&
                    activated.fingerprint === candidateFingerprint
                )
            },
            'Same issued candidate activated while ACME is offline',
            120_000,
        )
        assert.equal(activated?.currentOperation?.id, operationId)
        assert.equal(activated?.currentOperation?.stage, 'applied')
        assert.equal(activated?.lastErrorCode, null)
        const events = await readOperationEvents(context, operationId)
        assert.equal(events.filter((event) => event.kind === 'issued').length, 1)
        assert.equal(events.filter((event) => event.kind === 'activated').length, 1)
        assert.ok(events.some((event) => event.kind === 'retry_scheduled'))
        await verifyCertificate(context, caFile, candidateFingerprint)
        context.check(
            'rollback',
            'Durable candidate retry activated the same operation with ACME offline',
        )
    } finally {
        if (!runtimeRestored) await context.restart()
        if (disconnected) await reconnectPebble(context)
    }
}

export async function exerciseCertificates(
    context: ReliabilityContext,
    iteration: number,
): Promise<void> {
    if (iteration % 3 !== 0) return
    const state = states.get(context)
    assert.ok(state, 'Certificate fixture must be prepared before exercising it')
    const oldActiveId = state.activeId
    const requested = await context.fixture('certificate-request', { iteration })
    const id = certificateId(requested.certificateId)
    const issued = await idleCertificate(context, id, 'Local ACME certificate issuance')
    assert.equal(issued.status, 'valid')
    assert.equal(issued.lastErrorCode, null)
    assert.ok(issued.fingerprint)
    await context.synced(await context.fixture('certificate-bind', { certificateId: id }))
    state.activeId = id
    state.activeCaFile = state.issuanceCaFile
    await verifyCertificate(context, state.issuanceCaFile, issued.fingerprint)
    await context.fixture('certificate-delete', { certificateId: oldActiveId })
    await context.fixture('certificate-renew', { certificateId: id })
    const renewed = await idleCertificate(context, id, 'Local ACME renewal')
    assert.equal(renewed.status, 'valid')
    assert.equal(renewed.lastErrorCode, null)
    assert.ok(renewed.fingerprint)
    assert.notEqual(renewed.fingerprint, issued.fingerprint)
    await verifyCertificate(context, state.issuanceCaFile, renewed.fingerprint)
    await failedCandidateRecovery(context, id, state.issuanceCaFile)
    const active = await metadata(context, id)
    assert.ok(active.fingerprint)
    let disconnected = false
    try {
        await context.docker(['network', 'disconnect', context.network, context.pebble])
        disconnected = true
        const request = await context.fixture('binding-request', { iteration })
        const jobId = certificateId(request.jobId)
        await context.waitFor(
            async () => {
                const result = await context.fixture('jobs-read')
                assert.equal(result.currentJob?.id, jobId)
                if (result.currentJob?.stage !== 'failed') return false
                const failed = await metadata(
                    context,
                    certificateId(result.currentJob.certificateId),
                )
                if (failed.status !== 'failed' || failed.operation !== 'idle') return false
                assert.equal(result.currentJob.errorCode, 'acme_failed')
                assert.equal(failed.lastErrorCode, 'acme_failed')
                return true
            },
            'Binding job records offline ACME failure',
            120_000,
        )
        await verifyCertificate(context, state.issuanceCaFile, active.fingerprint)
        await context.restart()
        const persisted = await context.fixture('jobs-read')
        assert.equal(persisted.currentJob?.id, jobId)
        assert.equal(persisted.currentJob?.stage, 'failed')
        assert.equal(persisted.currentJob?.errorCode, 'acme_failed')
        const persistedFailure = await metadata(
            context,
            certificateId(persisted.currentJob?.certificateId),
        )
        assert.equal(persistedFailure.status, 'failed')
        assert.equal(persistedFailure.operation, 'idle')
        await reconnectPebble(context)
        disconnected = false
        await context.expireCertificateRetry(certificateId(persisted.currentJob?.certificateId))
        const retry = await context.fixture('binding-retry')
        assert.equal(retry.currentJob?.id, jobId)
        let boundId = ''
        let secondRequestMade = false
        let historicalMismatch: { fingerprint: string; operationId: string } | undefined
        await context.waitFor(
            async () => {
                const result = await context.fixture('jobs-read')
                assert.equal(result.currentJob?.id, jobId)
                if (result.currentJob?.stage !== 'applied') {
                    if (
                        result.currentJob?.stage !== 'failed' ||
                        result.currentJob.errorCode !== null
                    )
                        return false
                    const current = await metadata(
                        context,
                        certificateId(result.currentJob.certificateId),
                    )
                    const completedIssuance =
                        current.status === 'valid' &&
                        current.operation === 'idle' &&
                        current.currentOperation?.stage === 'applied' &&
                        current.lastErrorCode === null &&
                        current.fingerprint !== null
                    if (!completedIssuance) return false
                    if (context.source !== 'alpha.6' || secondRequestMade) {
                        throw new ReliabilityError(
                            'assertion',
                            'Completed certificate issuance left its binding job failed after a manual retry',
                        )
                    }
                    historicalMismatch = {
                        fingerprint: current.fingerprint!,
                        operationId: current.currentOperation!.id,
                    }
                    secondRequestMade = true
                    context.noteKnownLimitation('alpha6-binding-retry-needs-second-request')
                    const secondRetry = await context.fixture('binding-retry')
                    assert.equal(secondRetry.currentJob?.id, jobId)
                    assert.equal(
                        secondRetry.currentJob?.certificateId,
                        result.currentJob.certificateId,
                    )
                    return false
                }
                boundId = certificateId(result.currentJob.certificateId)
                return true
            },
            'Retried durable binding job applied',
            120_000,
        )
        await context.synced(await context.fixture('snapshot'))
        const bound = await metadata(context, boundId)
        assert.equal(bound.status, 'valid')
        if (historicalMismatch) {
            assert.equal(bound.fingerprint, historicalMismatch.fingerprint)
            assert.equal(bound.currentOperation?.id, historicalMismatch.operationId)
        }
        assert.ok(bound.fingerprint)
        await verifyCertificate(context, state.issuanceCaFile, bound.fingerprint)
        state.activeId = boundId
        await context.fixture('certificate-delete', { certificateId: id })
        context.check(
            'reload',
            'Durable certificate binding job survives failure and restart, then retries',
        )
    } finally {
        if (disconnected) await reconnectPebble(context)
    }
}

export async function verifyActiveCertificate(context: ReliabilityContext): Promise<void> {
    const state = states.get(context)
    assert.ok(state, 'Certificate fixture must be prepared before verifying it')
    const active = await metadata(context, state.activeId)
    assert.equal(active.status, 'valid')
    assert.ok(active.fingerprint)
    await verifyCertificate(context, state.activeCaFile, active.fingerprint)
}
