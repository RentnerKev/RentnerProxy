// oxlint-disable no-await-in-loop -- Workload phases and recovery checks depend on the preceding state.
import assert from 'node:assert/strict'
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { assertHttp3Response, requestHttp3Client } from '../http3-client.ts'
import {
    exerciseCertificates,
    prepareCertificateFixture,
    verifyActiveCertificate,
} from '../runtime-reliability/certificates.ts'
import { exerciseCrowdSec } from '../runtime-reliability/crowdsec.ts'
import {
    createHarness,
    ReliabilityError,
    type ReliabilityContext,
} from '../runtime-reliability/harness.ts'
import {
    buildScaleReport,
    parseScaleOptions,
    runBoundedTasks,
    scaleResultSchema,
    type ScaleMeasurement,
    type ScaleResourceSample,
    type ScaleResult,
    type ScaleStage,
} from './control.ts'

async function installFixture(context: ReliabilityContext, targetSha: string) {
    const source = join(context.temp, 'fixture-source')
    const archive = join(context.temp, 'scale-fixture.tar')
    await context.command([
        'git',
        '-c',
        'safe.directory=' + resolve(import.meta.dir, '../..').replaceAll('\\', '/'),
        'archive',
        '--format=tar',
        '--output=' + archive,
        targetSha,
        'scripts/runtime-scale',
        'scripts/runtime-reliability',
    ])
    await context.command(['tar', '-xf', archive, '-C', source])
    await rm(archive)
    const bundle = join(context.temp, 'scale-fixture.js')
    await context.command([
        process.execPath,
        '--no-env-file',
        'build',
        join(source, 'scripts/runtime-scale/fixture.ts'),
        '--tsconfig-override=' + join(source, 'web/tsconfig.json'),
        '--target=bun',
        '--packages=external',
        '--outfile=' + bundle,
    ])
    await context.docker([
        'cp',
        bundle,
        context.container + ':/opt/rentnerproxy/web/reliability-fixture.js',
    ])
}

async function prepareTlsUpstream(context: ReliabilityContext) {
    const hostname = '*.scale-' + context.domain
    const openssl = (args: string[]) =>
        context.docker(['exec', context.container, 'openssl', ...args])
    await openssl([
        'req',
        '-new',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-sha256',
        '-subj',
        '/CN=' + hostname,
        '-keyout',
        '/tmp/scale-leaf.key',
        '-out',
        '/tmp/scale-leaf.csr',
        '-addext',
        'subjectAltName=DNS:' + hostname,
    ])
    await openssl([
        'x509',
        '-req',
        '-in',
        '/tmp/scale-leaf.csr',
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
        '/tmp/scale-leaf.pem',
    ])
    await context.docker(['exec', context.container, 'chmod', '600', '/tmp/scale-leaf.key'])
    const keyPath = join(context.temp, 'scale-leaf.key')
    const certPath = join(context.temp, 'scale-leaf.pem')
    await context.docker(['cp', context.container + ':/tmp/scale-leaf.key', keyPath])
    await context.docker(['cp', context.container + ':/tmp/scale-leaf.pem', certPath])
    await chmod(keyPath, 0o600)
    return Bun.serve({
        hostname: '0.0.0.0',
        port: 0,
        tls: { key: await readFile(keyPath), cert: await readFile(certPath) },
        fetch: () => Response.json({ backend: 'tls' }),
    })
}

async function verifyTraffic(
    context: ReliabilityContext,
    result: ScaleResult,
    concurrency: number,
) {
    await runBoundedTasks(result.traffic, concurrency, async (expected) => {
        const response = await context.http(expected.domain)
        assert.equal(response.status, expected.status, 'Scale route returns the expected status')
        if (expected.status === 200)
            assert.equal(
                response.body.backend,
                expected.backend,
                'Scale route reaches its final upstream',
            )
        if (expected.status === 302 || expected.status === 307)
            assert.equal(
                response.headers.get('location'),
                expected.location,
                'Scale redirect retains its final destination',
            )
    })
}

async function verifyConfiguration(context: ReliabilityContext, result: ScaleResult) {
    const configuration = JSON.parse(
        await context.docker([
            'exec',
            context.container,
            'curl',
            '--silent',
            '--fail',
            '--max-time',
            '5',
            '--unix-socket',
            '/var/lib/rentnerproxy/proxy/caddy-admin.sock',
            'http://localhost/config/',
        ]),
    ) as { apps?: { http?: { servers?: Record<string, unknown> } } }
    assert.ok(configuration.apps?.http?.servers, 'Active Caddy JSON has HTTP servers')
    const serialized = JSON.stringify(configuration)
    for (const expected of result.traffic.filter((entry) => entry.status !== 404))
        assert.ok(
            serialized.includes(JSON.stringify(expected.domain)),
            'Active Caddy configuration includes every enabled workload domain',
        )
}

async function verifyTls(context: ReliabilityContext, result: ScaleResult, caFile: string) {
    assert.ok(result.tlsHost && result.certificateFingerprint, 'Scale TLS binding is present')
    for (const protocol of ['--http1.1', '--http3-only'] as const) {
        const response = await requestHttp3Client(context.command, {
            image: context.http3Image,
            caFile,
            hostname: result.tlsHost,
            port: context.tlsPort,
            address: context.container,
            network: context.network,
            protocol,
        })
        assert.equal(response.status, 200)
        assert.equal(
            response.fingerprint,
            result.certificateFingerprint,
            'Scale TLS serves the persisted certificate',
        )
        if (protocol === '--http3-only') assertHttp3Response(response, 200, context.tlsPort)
        else assert.equal(response.protocol, '1.1')
    }
}

async function verifyPolicies(harness: Awaited<ReturnType<typeof createHarness>>) {
    const context = harness.context
    const host = 'policy-' + context.domain
    for (const policyMode of ['authenticated', 'ip-restricted', 'public'] as const) {
        await context.synced(await context.fixture('policy-update', { policyMode }))
        assert.equal(
            (await context.http(host)).status,
            policyMode === 'public' ? 200 : policyMode === 'authenticated' ? 401 : 403,
        )
        if (policyMode === 'authenticated') {
            const authorization =
                'Basic ' +
                Buffer.from('reliability:Reliability-fixture-' + context.runId + '-only').toString(
                    'base64',
                )
            assert.equal((await context.http(host, '/', { authorization })).status, 200)
        }
    }
    await context.synced(await context.fixture('forward-auth'))
    assert.equal((await context.http(host)).body.user, 'reliability-user')
    try {
        harness.setAuthMode('deny')
        assert.equal((await context.http(host)).status, 401)
        harness.setAuthMode('unavailable')
        assert.notEqual((await context.http(host)).status, 200)
    } finally {
        harness.setAuthMode('allow')
    }
    assert.equal((await context.http(host)).status, 200)
    await context.synced(await context.fixture('policy-update', { policyMode: 'public' }))
}

async function main() {
    const options = parseScaleOptions(process.argv.slice(2))
    const harness = await createHarness(
        {
            source: 'current',
            durationSeconds: 120,
            iterations: 1,
            concurrency: options.concurrency,
            captureResources: true,
            seed: options.seed,
            ...(options.image ? { image: options.image } : {}),
        },
        [],
    )
    const context = harness.context
    const measurements: ScaleMeasurement[] = []
    const resources: ScaleResourceSample[] = []
    const checks: Parameters<typeof buildScaleReport>[0]['checks'] = []
    let stage: ScaleStage = 'setup'
    let failure: Parameters<typeof buildScaleReport>[0]['failure']
    let startedAt: number | undefined
    let observedDurationSeconds = 0
    let finalState: Parameters<typeof buildScaleReport>[0]['finalState']
    let tlsUpstream: Awaited<ReturnType<typeof prepareTlsUpstream>> | undefined
    const elapsed = () => (startedAt === undefined ? 0 : (performance.now() - startedAt) / 1000)
    const guard = () => {
        if (elapsed() >= options.timeoutSeconds)
            throw new ReliabilityError('timeout', 'Scale workload time bound reached')
    }
    const measure = async (phase: string, extra: Record<string, unknown> = {}) => {
        guard()
        const start = performance.now()
        const result = scaleResultSchema.parse(
            await context.fixture(phase, {
                hostCount: options.hosts,
                seed: options.seed,
                ...extra,
            }),
        )
        measurements.push({
            stage,
            elapsedMilliseconds: performance.now() - start,
            counts: result.counts,
            desiredRevision: result.desiredRevision,
            inventoryFingerprint: result.inventoryFingerprint,
        })
        return result
    }
    const synchronized = async (result: ScaleResult) => {
        await context.synced(result)
        await verifyConfiguration(context, result)
        await verifyTraffic(context, result, options.concurrency)
        const status = await context.controller('/internal/v1/proxy/status')
        assert.equal(status.status, 200)
        assert.equal(status.body.activeRevision, result.desiredRevision)
        finalState = {
            desiredRevision: result.desiredRevision,
            activeRevision: status.body.activeRevision,
            inventoryFingerprint: result.inventoryFingerprint,
        }
    }
    const sample = async () => {
        guard()
        resources.push({ stage, sample: await harness.resources(elapsed()) })
    }
    try {
        await harness.setup()
        await installFixture(context, harness.targetSha)
        stage = 'warmup'
        startedAt = performance.now()
        await context.synced(await context.fixture('prepare'))
        const { caFile } = await prepareCertificateFixture(context)
        tlsUpstream = await prepareTlsUpstream(context)
        await sample()
        stage = 'small'
        console.log('Scale: ' + Math.min(25, options.hosts) + ' hosts')
        let result = await measure('scale-create', { hostCount: Math.min(25, options.hosts) })
        await synchronized(result)
        await sample()
        stage = 'large'
        console.log('Scale: ' + options.hosts + ' hosts')
        result = await measure('scale-create')
        assert.equal(result.counts.proxyHosts, options.hosts)
        await synchronized(result)
        await verifyTls(context, result, caFile)
        await sample()
        stage = 'concurrent'
        for (let iteration = 0; iteration < options.rounds; iteration += 1) {
            console.log('Scale: concurrent round ' + (iteration + 1))
            const previous = result
            let updated: ScaleResult | undefined
            await runBoundedTasks(
                [
                    async () => {
                        updated = await measure('scale-update', { iteration })
                    },
                    async () => {
                        await runBoundedTasks(
                            previous.traffic.filter((entry) => entry.backend).slice(0, 32),
                            options.concurrency,
                            async (expected) => {
                                const response = await context.http(expected.domain)
                                assert.ok(
                                    response.status === 200 || response.status === 404,
                                    'Concurrent traffic stays within old/new route states',
                                )
                                if (response.status === 200)
                                    assert.ok(
                                        ['a', 'b', 'tls'].includes(response.body.backend),
                                        'Concurrent traffic reaches an owned upstream',
                                    )
                            },
                        )
                        await harness.ready()
                    },
                ],
                2,
                (operation) => operation(),
            )
            assert.ok(updated)
            assert.ok(
                updated.counts.managementReads >= options.hosts * 4,
                'Management reads overlap host writes',
            )
            result = updated
            await synchronized(result)
            await sample()
        }
        checks.push(
            { name: 'traffic', passed: true },
            { name: 'revision', passed: true },
            { name: 'management', passed: true },
        )
        stage = 'features'
        console.log('Scale: Beta feature integration')
        await verifyPolicies(harness)
        await exerciseCrowdSec(context)
        await exerciseCertificates(context, 0)
        const jobs = await context.fixture('durability-read')
        assert.equal(jobs.currentJob?.stage, 'applied', 'At-scale binding job finishes')
        assert.equal(
            jobs.persistedJobCounts.nonApplied,
            0,
            'Binding work drains without a stuck queue',
        )
        assert.equal(jobs.persistedJobCounts.total, 1)
        result = await measure('scale-trusted-upstream', { trustedUpstreamPort: tlsUpstream.port })
        await synchronized(result)
        result = await measure('scale-npm-import')
        assert.equal(result.importRetryVerified, true)
        await synchronized(result)
        await verifyTls(context, result, caFile)
        await verifyActiveCertificate(context)
        await sample()
        checks.push({ name: 'tls', passed: true }, { name: 'features', passed: true })
        stage = 'interruption'
        console.log('Scale: interrupted reconcile and recovery')
        const before = await context.controller('/internal/v1/proxy/status')
        const previous = result
        await context.docker([
            'exec',
            context.container,
            'rm',
            '--',
            '/var/lib/rentnerproxy/proxy/caddy-admin.sock',
        ])
        const pending = await measure('scale-update', { iteration: options.rounds })
        const interrupted = await context.controller('/internal/v1/proxy/status')
        assert.equal(
            interrupted.body.activeRevision,
            before.body.activeRevision,
            'Unavailable Admin API retains the active revision',
        )
        assert.notEqual(
            pending.desiredRevision,
            before.body.activeRevision,
            'New desired intent is persisted during interruption',
        )
        await verifyTraffic(context, previous, options.concurrency)
        await context.restart()
        result = await measure('scale-read')
        assert.equal(
            result.inventoryFingerprint,
            pending.inventoryFingerprint,
            'Pending desired state survives restart',
        )
        assert.equal(
            result.desiredRevision,
            pending.desiredRevision,
            'Recovery applies the persisted revision',
        )
        await synchronized(result)
        checks.push({ name: 'interruption', passed: true })
        stage = 'restart'
        console.log('Scale: complete appliance restart')
        const persisted = result
        await context.restart()
        result = await measure('scale-read')
        assert.equal(
            result.inventoryFingerprint,
            persisted.inventoryFingerprint,
            'Restart retains every workload ID and expectation',
        )
        assert.equal(result.desiredRevision, persisted.desiredRevision)
        const recoveredJobs = await context.fixture('durability-read')
        assert.equal(recoveredJobs.currentJob?.id, jobs.currentJob?.id)
        assert.equal(recoveredJobs.currentJob?.stage, 'applied')
        assert.deepEqual(recoveredJobs.persistedJobCounts, jobs.persistedJobCounts)
        await synchronized(result)
        await verifyTls(context, result, caFile)
        await verifyActiveCertificate(context)
        await sample()
        checks.push({ name: 'restart', passed: true })
        stage = 'delete'
        result = await measure('scale-delete')
        assert.ok(result.counts.mutations > 0, 'Deletion workload removes existing objects')
        await synchronized(result)
        await sample()
        checks.push({ name: 'delete', passed: true })
        stage = 'final'
        console.log('Scale: eight resource samples with unchanged final configuration')
        const final = result
        for (let index = 0; index < 8; index += 1) {
            result = await measure('scale-read')
            assert.equal(result.inventoryFingerprint, final.inventoryFingerprint)
            assert.equal(result.desiredRevision, final.desiredRevision)
            await synchronized(result)
            await sample()
        }
        guard()
    } catch (error) {
        const category =
            error instanceof ReliabilityError
                ? error.category
                : error instanceof assert.AssertionError
                  ? 'assertion'
                  : 'unexpected'
        failure = { stage, category }
        const location =
            error instanceof Error
                ? error.stack?.match(
                      /runtime-(?:scale|reliability)[/\\](harness|certificates|crowdsec|run|control)\.ts:(\d+):(\d+)/u,
                  )
                : undefined
        console.error(
            'Scale failed at ' +
                stage +
                ' (' +
                category +
                ')' +
                (error instanceof ReliabilityError ? ': ' + error.message : '') +
                (location ? ' at ' + location[1] + '.ts:' + location[2] + ':' + location[3] : ''),
        )
    } finally {
        observedDurationSeconds = elapsed()
        tlsUpstream?.stop(true)
        try {
            await harness.cleanup()
        } catch {
            failure ??= { stage: 'cleanup', category: 'command' }
        }
    }
    const report = buildScaleReport({
        targetSha: harness.targetSha,
        imageIdentity: harness.imageIdentity,
        options,
        elapsedSeconds: observedDurationSeconds,
        measurements,
        resources,
        checks,
        ...(finalState ? { finalState } : {}),
        ...(failure ? { failure } : {}),
    })
    const reportPath = resolve(
        options.reportPath ?? join(import.meta.dir, '../../tmp/runtime-scale/report.json'),
    )
    await mkdir(dirname(reportPath), { recursive: true })
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 })
    await chmod(reportPath, 0o600)
    console.log(
        'Runtime scale: ' +
            (report.summary.passed ? 'passed' : 'failed') +
            '; hosts=' +
            options.hosts +
            '; rounds=' +
            options.rounds +
            '; observed=' +
            Math.round(report.elapsedSeconds) +
            's',
    )
    if (!report.summary.passed) process.exitCode = 1
}
if (import.meta.main) await main()
