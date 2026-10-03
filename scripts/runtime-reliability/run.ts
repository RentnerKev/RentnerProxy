// oxlint-disable no-await-in-loop -- Fault injection, recovery probes and lifecycle changes depend on the preceding step.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import {
    prepareCertificateFixture,
    exerciseCertificates,
    verifyActiveCertificate,
} from './certificates.ts'
import { exerciseCrowdSec } from './crowdsec.ts'
import {
    analyzeResources,
    buildReliabilityReport,
    createSeededRandom,
    parseReliabilityOptions,
    shouldContinue,
} from './control.ts'
import type { ReliabilityCheck, ReliabilityFailure, ResourceSample } from './Types/control.types.ts'
import { createHarness, ReliabilityError } from './harness.ts'
import type { ReliabilityContext, FixtureResult } from './Types/harness.types.ts'
import type { TrafficDiagnostic } from './Types/fixture-transport.types.ts'

async function processIds(
    context: ReliabilityContext,
    kind: 'caddy' | 'controller' | 'web' | 'postgres',
    allowEmpty = false,
) {
    const script = `import {readdir,readFile} from 'node:fs/promises';const kind=process.argv[1];const ids=[];
for(const pid of await readdir('/proc')) {if(!/^\\d+$/.test(pid)||Number(pid)===process.pid)continue;try{
const name=(await readFile('/proc/'+pid+'/comm','utf8')).trim();
const matches=kind==='controller'?name==='rentnerproxy-co':kind==='web'?name==='bun'&&(await readFile('/proc/'+pid+'/cmdline','utf8')).includes('/docker/web/serve.mjs'):name===kind;
if(matches)ids.push(Number(pid));}catch{}}console.log(JSON.stringify(ids));`
    const ids = JSON.parse(
        await context.docker([
            'exec',
            context.container,
            'bun',
            '--no-env-file',
            '-e',
            script,
            kind,
        ]),
    ) as number[]
    assert.ok((allowEmpty || ids.length > 0) && ids.every((id) => Number.isInteger(id) && id > 1))
    return ids
}
async function signal(context: ReliabilityContext, ids: number[], name: 'TERM' | 'STOP' | 'CONT') {
    if (name === 'TERM')
        await context.docker([
            'exec',
            '--detach',
            context.container,
            'sh',
            '-c',
            'sleep 0.1; exec kill -TERM "$@"',
            'fixture',
            ...ids.map(String),
        ])
    else await context.docker(['exec', context.container, 'kill', '-' + name, ...ids.map(String)])
}
async function verifyProxy(context: ReliabilityContext, result: FixtureResult) {
    await context.synced(result)
    const response = await context.http()
    if (!result.expected.enabled) assert.equal(response.status, 404)
    else {
        assert.equal(response.status, 200)
        assert.equal(
            response.body.backend,
            result.expected.forwardPort === result.primaryPort ? 'a' : 'b',
        )
    }
}
async function preserveAcrossRestart(context: ReliabilityContext, component: 'web' | 'controller') {
    const before = await context.fixture('durability-read')
    await signal(context, await processIds(context, component), 'TERM')
    await context.waitFor(
        async () =>
            (await context.docker([
                'inspect',
                '--format',
                '{{.State.Running}}',
                context.container,
            ])) === 'false',
        'supervised component exit',
        45_000,
    )
    await context.docker(['start', context.container])
    await context.waitFor(
        async () => {
            await context.docker(
                [
                    'exec',
                    context.container,
                    'bun',
                    '/opt/rentnerproxy/web/docker/web/healthcheck.mjs',
                ],
                { timeoutMs: 8_000 },
            )
            return true
        },
        'appliance recovers after component exit',
        150_000,
    )
    const after = await context.fixture('durability-read')
    assert.equal(after.desiredRevision, before.desiredRevision)
    assert.deepEqual(after.durableCounts, before.durableCounts)
    assert.deepEqual(after.importHistory, before.importHistory)
    await context.synced(after)
    context.check('restart', component + ' exit and appliance recovery preserve durable state')
}
async function exerciseFailures(
    context: ReliabilityContext,
    iteration: number,
    primaryPort: number,
    secondaryPort: number,
) {
    const modes =
        iteration === 0
            ? (['caddy', 'web', 'controller', 'postgres', 'admin'] as const)
            : [(['caddy', 'web', 'controller', 'postgres', 'admin'] as const)[iteration % 5]!]
    for (const mode of modes) {
        console.log('Fault recovery: ' + mode)
        if (mode === 'web' || mode === 'controller') {
            await preserveAcrossRestart(context, mode)
        } else if (mode === 'caddy') {
            const before = await context.fixture('snapshot')
            const previousIds = await processIds(context, 'caddy')
            await signal(context, previousIds, 'TERM')
            await context.waitFor(async () => {
                const ids = await processIds(context, 'caddy', true)
                return ids.length > 0 && !ids.some((id) => previousIds.includes(id))
            }, 'Caddy process replacement')
            await context.synced(before)
            await context.waitFor(
                async () => (await context.http()).status === 200,
                'Caddy restarts and restores live route',
            )
            context.check('restart', 'Caddy process recovery keeps the desired revision')
        } else if (mode === 'postgres') {
            const ids = await processIds(context, 'postgres')
            await signal(context, ids, 'STOP')
            let unavailable = false
            try {
                const binding = await context.docker(['port', context.container, '3000/tcp'])
                try {
                    const response = await fetch('http://' + binding + '/health/ready', {
                        signal: AbortSignal.timeout(4_000),
                    })
                    unavailable = !response.ok
                } catch {
                    unavailable = true
                }
                assert.equal(unavailable, true)
                assert.equal((await context.http()).status, 200)
            } finally {
                await signal(context, ids, 'CONT')
            }
            await context.synced(await context.fixture('snapshot'))
            context.check(
                'health',
                'Transient database failure is bounded and active proxy traffic survives',
            )
        } else {
            await context.synced(
                await context.fixture('proxy-update', { secondaryPort, resetTls: true }),
            )
            assert.equal((await context.http()).body.backend, 'b')
            const before = await context.controller('/internal/v1/proxy/status')
            await context.docker([
                'exec',
                context.container,
                'rm',
                '--',
                '/var/lib/rentnerproxy/proxy/caddy-admin.sock',
            ])
            let pending: FixtureResult
            try {
                pending = await context.fixture('proxy-update', { secondaryPort: primaryPort })
                const after = await context.controller('/internal/v1/proxy/status')
                assert.equal(after.body.activeRevision, before.body.activeRevision)
                assert.notEqual(pending.desiredRevision, before.body.activeRevision)
                assert.equal((await context.http()).body.backend, 'b')
            } finally {
                await context.restart()
            }
            await context.synced(pending)
            assert.equal((await context.http()).body.backend, 'a')
            context.check(
                'rollback',
                'Caddy Admin failure retains last active route and recovers persisted intent',
            )
        }
    }
}
async function exercisePolicies(context: ReliabilityContext, random: () => number) {
    const modes: ('public' | 'authenticated' | 'ip-restricted')[] =
        random() < 0.5
            ? ['authenticated', 'ip-restricted', 'public']
            : ['ip-restricted', 'authenticated', 'public']
    for (const policyMode of modes) {
        await context.synced(await context.fixture('policy-update', { policyMode }))
        const response = await context.http('policy-' + context.domain)
        assert.equal(
            response.status,
            policyMode === 'public' ? 200 : policyMode === 'authenticated' ? 401 : 403,
        )
        if (policyMode === 'authenticated') {
            const authorization =
                'Basic ' +
                Buffer.from('reliability:Reliability-fixture-' + context.runId + '-only').toString(
                    'base64',
                )
            assert.equal(
                (await context.http('policy-' + context.domain, '/', { authorization })).status,
                200,
            )
        }
    }
    context.check('proxy', 'Access policy changes enforce Basic Auth and IP restrictions')
}
async function main() {
    const options = parseReliabilityOptions(process.argv.slice(2))
    const checks: ReliabilityCheck[] = []
    const samples: ResourceSample[] = []
    const harness = await createHarness(options, checks)
    const context = harness.context
    const random = createSeededRandom(options.seed)
    let stage: ReliabilityFailure['stage'] = 'setup'
    let failure: ReliabilityFailure | undefined
    let trafficDiagnostic: TrafficDiagnostic | undefined
    let completedIterations = 0
    let startedAt: number | undefined
    let observedDurationSeconds = 0
    const elapsed = () => (startedAt === undefined ? 0 : (performance.now() - startedAt) / 1000)
    try {
        await harness.setup()
        stage = 'warmup'
        const initial = await context.fixture('prepare')
        await context.synced(initial)
        assert.equal((await context.http()).body.backend, 'a')
        await prepareCertificateFixture(context)
        await context.synced(await context.fixture('proxy-update', { resetTls: true }))
        startedAt = performance.now()
        stage = 'cycle'
        while (shouldContinue(options, completedIterations, elapsed())) {
            const iteration = completedIterations
            console.log('Cycle ' + (iteration + 1) + ' (' + Math.round(elapsed()) + 's)')
            const updated = await context.fixture('proxy-update', { iteration, resetTls: true })
            await verifyProxy(context, { ...updated, primaryPort: harness.primaryPort })
            await context.synced(await context.fixture('proxy-disable'))
            assert.equal((await context.http()).status, 404)
            await context.synced(await context.fixture('proxy-enable'))
            const rapid = await context.fixture('rapid-update', { iteration })
            assert.equal(rapid.mutations, options.concurrency)
            await verifyProxy(context, { ...rapid, primaryPort: harness.primaryPort })
            await context.synced(await context.fixture('create-temporary'))
            assert.equal((await context.http('temporary-' + context.domain)).status, 200)
            await context.synced(await context.fixture('delete-temporary'))
            assert.equal((await context.http('temporary-' + context.domain)).status, 404)
            const redirected = await context.fixture('redirect-update', { iteration })
            await context.synced(redirected)
            const redirect = await context.http('redirect-' + context.domain, '/probe')
            assert.equal(redirect.status, 307)
            assert.ok(redirect.headers.get('location')?.includes('/iteration-' + iteration))
            await context.synced(await context.fixture('redirect-disable'))
            assert.equal((await context.http('redirect-' + context.domain)).status, 404)
            await context.synced(await context.fixture('redirect-enable'))
            await context.synced(await context.fixture('redirect-delete'))
            assert.equal((await context.http('redirect-' + context.domain)).status, 404)
            await context.synced(await context.fixture('prepare'))
            await exercisePolicies(context, random)
            await harness.setUpstreamFailed(true)
            try {
                assert.equal((await context.http()).status, 503)
            } finally {
                await harness.setUpstreamFailed(false)
            }
            assert.equal((await context.http()).status, 200)
            context.check('proxy', 'Host and redirect CRUD plus transient upstream recovery')
            if (options.source === 'current') {
                await context.synced(await context.fixture('forward-auth'))
                assert.equal(
                    (await context.http('policy-' + context.domain)).body.user,
                    'reliability-user',
                )
                await harness.setAuthMode('deny')
                assert.equal((await context.http('policy-' + context.domain)).status, 401)
                await harness.setAuthMode('unavailable')
                assert.notEqual((await context.http('policy-' + context.domain)).status, 200)
                await harness.setAuthMode('allow')
                assert.equal((await context.http('policy-' + context.domain)).status, 200)
                await context.synced(
                    await context.fixture('policy-update', { policyMode: 'public' }),
                )
                context.check('proxy', 'Forward Auth failure denies access and recovers')
                const imported = await context.fixture('npm-import', { iteration })
                assert.equal(imported.historyFound, true)
                assert.equal(imported.identicalSourceRetry.historyFound, true)
                assert.equal(imported.failed, 0)
                assert.equal(imported.imported, iteration < 4 ? 2 : 0)
                assert.equal(imported.skipped, iteration < 4 ? 0 : 2)
                assert.equal(imported.identicalSourceRetry.imported, 0)
                assert.equal(imported.identicalSourceRetry.failed, 0)
                assert.equal(imported.identicalSourceRetry.skipped, 2)
                await context.synced(imported)
                const importedProxy = await context.http(
                    'npm-' + (iteration % 4) + '-' + context.domain,
                )
                assert.equal(importedProxy.status, 200)
                assert.equal(importedProxy.body.backend, 'a')
                const importedRedirect = await context.http(
                    'npm-redirect-' + (iteration % 4) + '-' + context.domain,
                )
                assert.equal(importedRedirect.status, 302)
                assert.equal(
                    importedRedirect.headers.get('location'),
                    'http://' + context.domain + '/',
                )
                context.check(
                    'revision',
                    'NPM importer retry retains history without duplicate domains',
                )
                if (iteration % 3 === 0) await exerciseCrowdSec(context)
            }
            await exerciseFailures(context, iteration, harness.primaryPort, harness.secondaryPort)
            await exerciseCertificates(context, iteration)
            if (iteration % 3 === 0) {
                await verifyActiveCertificate(context)
                if (options.source === 'current' && iteration === 0) {
                    await harness.backupRestore()
                    await verifyActiveCertificate(context)
                }
            }
            await context.synced(await context.fixture('proxy-update', { resetTls: true }))
            const final = await context.fixture('durability-read')
            await context.synced(final)
            assert.equal(final.currentJob?.stage, 'applied')
            assert.equal(final.persistedJobCounts.nonApplied, 0)
            assert.equal(final.persistedJobCounts.total, Math.floor(iteration / 3) + 1)
            if (options.source === 'current') {
                assert.ok(Array.isArray(final.importHistory) && final.importHistory.length === 2)
                assert.ok(final.importHistory.every((run: FixtureResult) => run.found === true))
            }
            context.check('revision', 'Final persisted desired revision matches the running proxy')
            // Capture after all recovery probes, with idle traffic and no outstanding fixture commands.
            await Bun.sleep(1000)
            if (options.captureResources) {
                const sample = await harness.resources(elapsed())
                analyzeResources([sample], options.concurrency)
                samples.push(sample)
            }
            completedIterations += 1
            if (shouldContinue(options, completedIterations, elapsed())) await Bun.sleep(1000)
        }
        stage = 'resources'
        observedDurationSeconds = elapsed()
    } catch (error) {
        const category =
            error instanceof ReliabilityError
                ? error.category
                : error instanceof assert.AssertionError
                  ? 'assertion'
                  : 'unexpected'
        failure = { stage, category }
        trafficDiagnostic = await context.captureTrafficDiagnostic(stage, category).catch(() => {
            console.error('Traffic failure evidence: capture unavailable')
            return undefined
        })
        const location =
            error instanceof Error
                ? error.stack?.match(
                      /runtime-reliability[/\\](harness|certificates|crowdsec|run|control)\.ts:(\d+):(\d+)/,
                  )
                : undefined
        console.error(
            'Reliability failed at ' +
                stage +
                ' (' +
                category +
                ')' +
                (error instanceof ReliabilityError ? ': ' + error.message : '') +
                (location ? ' at ' + location[1] + '.ts:' + location[2] + ':' + location[3] : ''),
        )
        observedDurationSeconds = elapsed()
    } finally {
        try {
            await harness.cleanup()
        } catch {
            failure ??= { stage: 'cleanup', category: 'command' }
        }
    }
    const report = buildReliabilityReport({
        targetSha: harness.targetSha,
        runtimeRevision: harness.runtimeRevision,
        imageIdentity: harness.imageIdentity,
        options,
        completedIterations,
        observedDurationSeconds,
        checks,
        samples,
        knownLimitations: harness.knownLimitations,
        ...(failure ? { failure } : {}),
    })
    const reportPath = resolve(
        options.reportPath ??
            join(import.meta.dir, '../../tmp/runtime-reliability', options.source + '.json'),
    )
    await mkdir(dirname(reportPath), { recursive: true })
    await writeFile(
        reportPath,
        JSON.stringify(
            { ...report, ...(trafficDiagnostic ? { trafficDiagnostic } : {}) },
            null,
            2,
        ) + '\n',
        { mode: 0o600 },
    )
    console.log(
        'Runtime reliability: ' +
            (report.summary.passed ? 'passed' : 'failed') +
            '; cycles=' +
            completedIterations +
            '; observed=' +
            Math.round(observedDurationSeconds) +
            's; trend=' +
            String(report.resources?.trendEvidence ?? 'disabled'),
    )
    if (!report.summary.passed) process.exitCode = 1
}
if (import.meta.main) await main()
