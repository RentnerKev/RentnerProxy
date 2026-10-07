import { runSmokeProcess } from '../smoke/process.ts'
import { waitForSmoke } from '../smoke/wait.ts'
import type { CommandOptions, FixtureResult, ReliabilityContext } from './Types/harness.types.ts'
// oxlint-disable no-await-in-loop -- Fault injection, recovery probes and lifecycle changes depend on the preceding step.
import assert from 'node:assert/strict'
import { dockerBuildDiagnostic } from '../smoke/docker-build-diagnostics.ts'
import { pebbleFailureCategories } from './diagnostics.ts'
import { randomBytes } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { startCertificateDnsFixture } from '../smoke/certificates/dns-fixture.ts'
import { buildHttp3Client } from '../smoke/http3/client.ts'
import { publishedRelease } from '../compatibility/published-releases.ts'
import { smokeCompose, smokeDockerArguments, smokeRunScope } from '../smoke/resources.ts'
import type { ReliabilityCheck, ReliabilityOptions, ResourceSample } from './Types/control.types.ts'
import { fixtureTransport } from './fixture-transport.config.ts'
import {
    caddyTransportErrors,
    createTrafficObserver,
    hostFetchCode,
} from './transport-diagnostics.ts'
import type { FixtureControl, TrafficDiagnostic } from './Types/fixture-transport.types.ts'

export class ReliabilityError extends Error {
    constructor(
        readonly category: 'command' | 'timeout' | 'assertion' | 'telemetry',
        label: string,
    ) {
        super(label)
    }
}

const pebbleImage =
    'ghcr.io/letsencrypt/pebble:2.10.1@sha256:ddf230642b1a584f519f32e347de1b05a6e4c1f6c35c1863b33effeab5f78199'
const healthcheck = '/opt/rentnerproxy/web/docker/web/healthcheck.mjs'
const repositoryRoot = resolve(import.meta.dir, '../..')

async function command(args: string[], options: CommandOptions = {}): Promise<string> {
    const { exitCode, stdout, stderr, timedOut } = await runSmokeProcess(
        smokeDockerArguments(args),
        {
            cwd: repositoryRoot,
            env: { ...process.env, ...options.env },
            timeoutMs: options.timeoutMs ?? 45_000,
            ...(options.stdin === undefined ? {} : { stdin: options.stdin }),
        },
    )
    if (options.diagnostic === 'pebble-problems')
        console.error(
            'Pebble failure categories: ' +
                JSON.stringify(pebbleFailureCategories(stdout + '\n' + stderr)),
        )
    if (timedOut) throw new ReliabilityError('timeout', 'bounded command timed out')
    if (exitCode !== 0 && !options.acceptableExitCodes?.includes(exitCode)) {
        if (args[0] === 'docker' && args[1] === 'build')
            console.error(dockerBuildDiagnostic(stderr))
        throw new ReliabilityError('command', 'command failed: ' + args.slice(0, 2).join(' '))
    }
    return (options.includeStderr ? stdout + '\n' + stderr : stdout).trim()
}

function waitFor(
    predicate: () => Promise<boolean>,
    label: string,
    timeoutMs = 60_000,
): Promise<void> {
    return waitForSmoke(predicate, {
        timeoutMs,
        intervalMs: 500,
        probeFirst: true,
        retryOnError: (error) =>
            error instanceof ReliabilityError &&
            (error.category === 'command' || error.category === 'timeout'),
        timeoutError: () => new ReliabilityError('timeout', label),
    })
}

async function archive(revision: string, destination: string, paths: string[] = []) {
    await mkdir(destination, { recursive: true })
    const path = destination + '.tar'
    await command([
        'git',
        '-c',
        'safe.directory=' + repositoryRoot.replaceAll('\\', '/'),
        '-c',
        'core.autocrlf=false',
        'archive',
        '--format=tar',
        '--output=' + path,
        revision,
        ...paths,
    ])
    await command(['tar', '-xf', path, '-C', destination])
    await rm(path)
}

export async function createHarness(options: ReliabilityOptions, checks: ReliabilityCheck[]) {
    const runId = randomBytes(6).toString('hex')
    if (!process.env.RENTNERPROXY_SMOKE_RUN) process.env.RENTNERPROXY_SMOKE_RUN = 'local-' + runId
    smokeRunScope()
    const prefix = 'rentnerproxy-reliability-' + runId
    const container = prefix + '-app'
    const pebble = prefix + '-pebble'
    const upstream = prefix + '-upstream'
    const network = prefix + '-network'
    let volume = prefix + '-data'
    const composeFile = join(tmpdir(), prefix + '-compose.yml')
    const http3Image = prefix + '-http3'
    const builtImage = prefix + '-current'
    const temp = await mkdtemp(join(tmpdir(), 'rentnerproxy-reliability-'))
    await chmod(temp, 0o700)
    const ownedContainers = [container, pebble, upstream, prefix + '-certs']
    const ownedVolumes = [volume]
    const ownedImages = [http3Image]
    const docker = (args: string[], config?: CommandOptions) => command(['docker', ...args], config)
    const dns = await startCertificateDnsFixture(randomBytes(16).toString('hex'))
    const traffic = createTrafficObserver()
    let fixtureTlsStarted = false
    let imageIdentity = 'sha256:' + '0'.repeat(64)
    let targetSha = '0'.repeat(40)
    let image = options.image ?? builtImage
    let started = false
    const eventStart = Math.floor(Date.now() / 1000)
    const domain = 'reliability-' + runId + '.example.com'
    function check(name: ReliabilityCheck['name'], label: string) {
        checks.push({ name, passed: true })
        console.log('PASS ' + label)
    }
    async function cleanup() {
        dns.stop()
        const failures: unknown[] = []
        // Backup/restore may leave a one-off helper after its bounded command is interrupted.
        const composeContainers = (
            await docker([
                'ps',
                '--all',
                '--filter',
                'label=com.docker.compose.project=' + prefix,
                '--format',
                '{{.Names}}',
            ])
        )
            .split('\n')
            .filter(Boolean)
        assert.ok(composeContainers.every((name) => name.startsWith(prefix + '-')))
        for (const name of new Set([...ownedContainers, ...composeContainers])) {
            const exists = await docker([
                'container',
                'inspect',
                '--format',
                '{{.Id}}',
                name,
            ]).catch(() => '')
            if (exists)
                await docker(['rm', '--force', '--volumes', name]).catch((error: unknown) =>
                    failures.push(error),
                )
        }
        for (const name of ownedVolumes) {
            const exists = await docker(['volume', 'inspect', '--format', '{{.Name}}', name]).catch(
                () => '',
            )
            if (exists)
                await docker(['volume', 'rm', name]).catch((error: unknown) => failures.push(error))
        }
        await docker(['network', 'rm', network]).catch(async () => {
            const exists = await docker(['network', 'inspect', network]).catch(() => '')
            if (exists) failures.push(new Error('network cleanup failed'))
        })
        for (const name of ownedImages)
            await docker(['image', 'rm', '--force', name]).catch(() => undefined)
        assert.equal(dirname(resolve(temp)), resolve(tmpdir()))
        assert.ok(basename(temp).startsWith('rentnerproxy-reliability-'))
        await rm(composeFile, { force: true })
        await rm(temp, { recursive: true, force: true })
        if (failures.length) throw new ReliabilityError('command', 'fixture cleanup failed')
    }
    async function controller(path: string, body?: unknown) {
        const script = `const token = (await Bun.file('/run/rentnerproxy/controller-token/value').text()).trim();
const input = JSON.parse(await Bun.stdin.text());
const response = await fetch('http://127.0.0.1:8081' + input.path, {
method: input.body === undefined ? 'GET' : 'POST', headers: { authorization: 'Bearer ' + token, 'content-type':'application/json' },
body: input.body === undefined ? undefined : JSON.stringify(input.body), signal: AbortSignal.timeout(25000) });
process.stdout.write(JSON.stringify({status:response.status, body:await response.json()}));`
        return JSON.parse(
            await docker(['exec', '-i', container, 'bun', '--no-env-file', '-e', script], {
                stdin: JSON.stringify({ path, body }),
                timeoutMs: 30_000,
            }),
        ) as { status: number; body: FixtureResult }
    }
    async function fixture(phase: string, extra: Record<string, unknown> = {}) {
        // Fixture mutations also run in recovery finally blocks (for example CrowdSec disable).
        traffic.clearHealthyObservation()
        const output = await docker(
            [
                'exec',
                '-i',
                '--workdir',
                '/opt/rentnerproxy/web',
                '--env',
                'RENTNERPROXY_RELIABILITY_ISOLATED=' + runId,
                '--env',
                'APP_ENCRYPTION_KEY_FILE=/run/rentnerproxy/app-key/value',
                '--env',
                'DATABASE_URL_FILE=/run/rentnerproxy/database-url/value',
                '--env',
                (options.source === 'alpha.6' ? 'REDIS_URL' : 'VALKEY_URL') +
                    '=redis://127.0.0.1:6379',
                '--env',
                'RENTNERPROXY_CONTROLLER_URL=http://127.0.0.1:8081',
                '--env',
                'RENTNERPROXY_CONTROLLER_TOKEN_FILE=/run/rentnerproxy/controller-token/value',
                '--env',
                'NODE_ENV=production',
                container,
                'bun',
                '--no-env-file',
                '/opt/rentnerproxy/web/reliability-fixture.js',
            ],
            {
                stdin: JSON.stringify({
                    runId,
                    phase,
                    upstreamHost: fixtureTransport.hostname,
                    upstreamPort: fixtureTransport.primaryPort,
                    secondaryPort: fixtureTransport.secondaryPort,
                    concurrency: options.concurrency,
                    certificateDomain: domain,
                    authPort: fixtureTransport.authPort,
                    ...extra,
                }),
                timeoutMs: 90_000,
                acceptableExitCodes: [1],
            },
        )
        const line = output.split('\n').find((value) => value.startsWith('RELIABILITY_RESULT='))
        if (!line) throw new ReliabilityError('assertion', 'fixture returned no result')
        const result = JSON.parse(line.slice('RELIABILITY_RESULT='.length)) as FixtureResult
        if (result.ok !== true)
            throw new ReliabilityError(
                'assertion',
                'fixture phase failed: ' +
                    phase +
                    ' [' +
                    String(result.errorCode) +
                    '/' +
                    String(result.executionStage) +
                    ']' +
                    (result.contextStage
                        ? ' [' + result.contextStage + '/' + result.diagnosticCode + ']'
                        : ''),
            )
        return result
    }
    async function synced(result: FixtureResult) {
        assert.match(result.desiredRevision as string, /^sha256:[a-f0-9]{64}$/u)
        await waitFor(async () => {
            const status = await controller('/internal/v1/proxy/status')
            return (
                status.status === 200 &&
                status.body.running === true &&
                status.body.activeRevision === result.desiredRevision
            )
        }, 'desired revision did not become active')
    }
    async function refreshDns() {
        const address = await docker([
            'inspect',
            '--format',
            '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}',
            container,
        ])
        assert.match(address, /^\d+\.\d+\.\d+\.\d+$/u)
        dns.addresses.set(domain, address)
    }
    async function ready() {
        await waitFor(
            async () => {
                await docker(['exec', container, 'bun', healthcheck], { timeoutMs: 8_000 })
                return true
            },
            'appliance readiness',
            150_000,
        )
        await refreshDns()
    }
    async function restart() {
        await docker(['restart', '--time', '15', container], { timeoutMs: 45_000 })
        await ready()
    }
    async function expireCertificateRetry(id: string) {
        assert.match(id, /^[a-f0-9-]{36}$/u)
        await docker(['stop', '--time', '15', container], { timeoutMs: 45_000 })
        const indexPath = '/var/lib/rentnerproxy/proxy/certificates/certificate-metadata.json'
        const fixturePath = join(temp, 'retry-index.json')
        await docker(['cp', container + ':' + indexPath, fixturePath])
        const index = JSON.parse(await Bun.file(fixturePath).text()) as FixtureResult
        assert.ok(index.certificates[id])
        assert.equal(index.certificates[id].operation, 'idle')
        index.certificates[id].nextAttemptAt = '2000-01-01T00:00:00Z'
        delete index.certificates[id].retryAfter
        await writeFile(fixturePath, JSON.stringify(index), { mode: 0o600 })
        await docker(['cp', fixturePath, container + ':' + indexPath])
        await docker([
            'run',
            '--rm',
            '--entrypoint',
            'sh',
            '--volume',
            volume + ':/var/lib/rentnerproxy',
            image,
            '-c',
            'chown 10001:10001 "$1" && chmod 600 "$1"',
            'fixture',
            indexPath,
        ])
        await rm(fixturePath)
        await docker(['start', container])
        await ready()
        check('reload', 'Scoped test clock expires the fixture certificate backoff')
    }
    async function http(
        host = domain,
        path = '/',
        headers: Record<string, string> = {},
        route?: number,
    ) {
        const binding = await docker(['port', container, '8080/tcp'])
        assert.match(binding, /^127\.0\.0\.1:\d+$/u)
        let response: Response
        try {
            response = await fetch('http://' + binding + path, {
                headers: { host, ...headers },
                redirect: 'manual',
                signal: AbortSignal.timeout(8_000),
            })
        } catch (error) {
            traffic.recordFailure({
                route: route ?? null,
                status: null,
                hostFetchCode: hostFetchCode(error),
            })
            throw error
        }
        traffic.observe({ route: route ?? null, status: response.status, hostFetchCode: null })
        let value: string
        try {
            value = await response.text()
        } catch (error) {
            traffic.recordFailure({
                route: route ?? null,
                status: response.status,
                hostFetchCode: hostFetchCode(error),
            })
            throw error
        }
        let body: FixtureResult = {}
        try {
            body = JSON.parse(value) as FixtureResult
        } catch {
            /* Error pages need only their status. */
        }
        return { status: response.status, headers: response.headers, body }
    }
    async function fixtureControl(input: FixtureControl) {
        // A recovery finally must not erase evidence before the outer failure handler captures it.
        traffic.clearHealthyObservation()
        const script = `const response=await fetch('http://127.0.0.1:${fixtureTransport.controlPort}/',{method:'POST',body:await Bun.stdin.text(),signal:AbortSignal.timeout(3000)});if(response.status!==200)process.exit(1);`
        await docker(['exec', '-i', upstream, 'bun', '--no-env-file', '-e', script], {
            stdin: JSON.stringify(input),
            timeoutMs: 5_000,
        })
    }
    async function startFixtureTls() {
        for (const [source, target] of [
            ['/tmp/scale-leaf.key', '/tmp/fixture-leaf.key'],
            ['/tmp/scale-leaf.pem', '/tmp/fixture-leaf.pem'],
        ]) {
            const local = join(temp, basename(target!))
            await docker(['cp', container + ':' + source, local])
            await chmod(local, 0o600)
            try {
                // Docker's archive API rejects cp into a read-only rootfs, even for /tmp tmpfs.
                // Exec writes through the container mount namespace without relaxing read-only mode.
                await docker(
                    [
                        'exec',
                        '-i',
                        upstream,
                        'bun',
                        '--no-env-file',
                        '-e',
                        "import {writeFile} from 'node:fs/promises';await writeFile(process.argv[1],await Bun.stdin.text(),{mode:0o600});",
                        target!,
                    ],
                    { stdin: await readFile(local, 'utf8'), timeoutMs: 5_000 },
                )
            } finally {
                await rm(local)
            }
        }
        await fixtureControl({ startTls: true })
        fixtureTlsStarted = true
        return fixtureTransport.tlsPort
    }
    async function captureTrafficDiagnostic(
        stage: string,
        category: string,
    ): Promise<TrafficDiagnostic> {
        const allowedStages = [
            'setup',
            'warmup',
            'cycle',
            'resources',
            'small',
            'large',
            'concurrent',
            'features',
            'interruption',
            'restart',
            'delete',
            'final',
            'cleanup',
        ]
        const evidence: TrafficDiagnostic = {
            stage: allowedStages.includes(stage) ? stage : 'unexpected',
            failureCategory: [
                'assertion',
                'command',
                'timeout',
                'telemetry',
                'unexpected',
            ].includes(category)
                ? category
                : 'unexpected',
            observation: traffic.observation,
            caddy: [],
            fixtureReachability: null,
            fixtureRunning: null,
            capture: 'complete',
        }
        const probe = `const ports=${JSON.stringify({ primary: fixtureTransport.primaryPort, secondary: fixtureTransport.secondaryPort, auth: fixtureTransport.authPort })};const result={};await Promise.all(Object.entries(ports).map(async([name,port])=>{try{const response=await fetch('http://${fixtureTransport.hostname}:'+port+'/',{keepalive:false,signal:AbortSignal.timeout(3000)});result[name]=response.status;await response.body?.cancel();}catch{result[name]=null;}}));console.log(JSON.stringify(result));`
        const tlsHost = 'h0.scale-' + domain
        const [logs, reachability, running, tlsReachability] = await Promise.allSettled([
            docker(
                [
                    'logs',
                    '--since',
                    String(Math.max(eventStart, Math.floor(Date.now() / 1000) - 30)),
                    '--tail',
                    '200',
                    container,
                ],
                { includeStderr: true, timeoutMs: 5_000 },
            ),
            docker(['exec', container, 'bun', '--no-env-file', '-e', probe], { timeoutMs: 5_000 }),
            docker(['inspect', '--format', '{{.State.Running}}', upstream], { timeoutMs: 5_000 }),
            fixtureTlsStarted
                ? docker(
                      [
                          'exec',
                          container,
                          'curl',
                          '--silent',
                          '--output',
                          '/dev/null',
                          '--max-time',
                          '3',
                          '--write-out',
                          '%{http_code}',
                          '--cacert',
                          '/tmp/reliability-ca.pem',
                          '--connect-to',
                          tlsHost +
                              ':' +
                              fixtureTransport.tlsPort +
                              ':' +
                              fixtureTransport.hostname +
                              ':' +
                              fixtureTransport.tlsPort,
                          'https://' + tlsHost + ':' + fixtureTransport.tlsPort + '/',
                      ],
                      { timeoutMs: 5_000, acceptableExitCodes: [7, 28, 35, 60] },
                  )
                : Promise.resolve('000'),
        ])
        if (logs.status === 'fulfilled') evidence.caddy = caddyTransportErrors(logs.value)
        else evidence.capture = 'partial'
        if (running.status === 'fulfilled') evidence.fixtureRunning = running.value === 'true'
        else evidence.capture = 'partial'
        if (reachability.status === 'fulfilled') {
            try {
                const input: unknown = JSON.parse(reachability.value)
                if (!input || typeof input !== 'object' || Array.isArray(input))
                    throw new Error('invalid probe')
                const value = input as Record<string, unknown>
                const status = (name: string) =>
                    typeof value[name] === 'number' &&
                    Number.isInteger(value[name]) &&
                    value[name] >= 100 &&
                    value[name] <= 599
                        ? (value[name] as number)
                        : null
                const tlsStatus =
                    tlsReachability.status === 'fulfilled' &&
                    /^[1-5]\d\d$/u.test(tlsReachability.value)
                        ? Number(tlsReachability.value)
                        : null
                evidence.fixtureReachability = {
                    primary: status('primary'),
                    secondary: status('secondary'),
                    auth: status('auth'),
                    tls: tlsStatus,
                }
            } catch {
                evidence.capture = 'partial'
            }
        } else evidence.capture = 'partial'
        if (tlsReachability.status === 'rejected') evidence.capture = 'partial'
        console.error('Traffic failure evidence: ' + JSON.stringify(evidence))
        return evidence
    }
    async function writeCompose() {
        const config = {
            services: {
                rentnerproxy: {
                    image,
                    container_name: container,
                    mem_limit: '1g',
                    cpus: 2,
                    pids_limit: 512,
                    ports: [
                        '127.0.0.1::3000',
                        '127.0.0.1::8080',
                        '127.0.0.1::8443/tcp',
                        '127.0.0.1::8443/udp',
                    ],
                    environment: {
                        RENTNERPROXY_PUBLIC_ORIGIN: 'https://reliability.invalid',
                        RENTNERPROXY_PROXY_PUBLIC_HTTPS_PORT: '8443',
                        RENTNERPROXY_ACME_TEST_DIRECTORY_URL: 'https://pebble:14000/dir',
                        RENTNERPROXY_ACME_TEST_ROOT_CERT: '/test/pebble.minica.pem',
                        SMTP_HOST: '127.0.0.1',
                        SMTP_PORT: '2525',
                        SMTP_SECURE: 'false',
                        SMTP_FROM: 'reliability@example.invalid',
                        SMTP_USER: 'reliability',
                        SMTP_PASSWORD: 'fixture-only',
                    },
                    volumes: [
                        volume + ':/var/lib/rentnerproxy',
                        join(temp, 'pebble.minica.pem') + ':/test/pebble.minica.pem:ro',
                    ],
                    networks: ['fixture'],
                },
            },
            volumes: { [volume]: { name: volume, external: true } },
            networks: { fixture: { name: network, external: true } },
        }
        await writeFile(composeFile, smokeCompose(Bun.YAML.stringify(config)), { mode: 0o600 })
    }
    async function backupRestore() {
        assert.equal(options.source, 'current')
        const before = await fixture('durability-read')
        const statePath = join(temp, 'fixture-state.json')
        await docker(['cp', container + ':/tmp/rentnerproxy-reliability-fixture.json', statePath])
        await chmod(statePath, 0o600)
        const env = { RENTNERPROXY_COMPOSE_FILE: composeFile }
        const output = await command(
            [
                process.execPath,
                '--no-env-file',
                'scripts/production-backup.ts',
                '--project',
                prefix,
                '--output',
                join(temp, 'backups'),
            ],
            { env, timeoutMs: 180_000 },
        )
        const backup = output
            .split('\n')
            .find((line) => line.startsWith('Production backup created: '))
            ?.slice('Production backup created: '.length)
        if (!backup)
            throw new ReliabilityError('assertion', 'backup checkpoint returned no artifact')
        await docker(['rm', '--force', container])
        volume = prefix + '-restored-data'
        ownedVolumes.push(volume)
        await docker(['volume', 'create', volume])
        await writeCompose()
        await command(
            [
                process.execPath,
                '--no-env-file',
                'scripts/production-restore.ts',
                '--project',
                prefix,
                '--input',
                backup,
                '--confirm-replace',
            ],
            { env, timeoutMs: 300_000 },
        )
        await docker([
            'cp',
            join(temp, 'reliability-fixture.js'),
            container + ':/opt/rentnerproxy/web/reliability-fixture.js',
        ])
        await docker(['cp', statePath, container + ':/tmp/rentnerproxy-reliability-fixture.json'])
        const fixtureStatePath = '/tmp/rentnerproxy-reliability-fixture.json'
        const copiedOwner = await docker([
            'exec',
            container,
            'stat',
            '--format=%u:%g:%a',
            fixtureStatePath,
        ])
        assert.match(copiedOwner, /^\d+:\d+:[0-7]{3,4}$/u)
        console.log('Restored private fixture state owner/mode: ' + copiedOwner)
        // The maintenance fixture runs as root; match its original private file ownership.
        await docker(['exec', container, 'chown', '0:0', fixtureStatePath])
        await docker([
            'exec',
            container,
            'chmod',
            '600',
            '/tmp/rentnerproxy-reliability-fixture.json',
        ])
        assert.equal(
            await docker(['exec', container, 'stat', '--format=%u:%g:%a', fixtureStatePath]),
            '0:0:600',
        )
        await ready()
        const after = await fixture('durability-read')
        assert.deepEqual(after.durableCounts, before.durableCounts)
        assert.deepEqual(after.persistedJobCounts, before.persistedJobCounts)
        assert.equal(after.desiredRevision, before.desiredRevision)
        assert.equal(after.boundCertificateId, before.boundCertificateId)
        assert.deepEqual(after.importHistory, before.importHistory)
        await synced(after)
        check('rollback', 'Fresh-volume backup restore preserves durable domain state')
    }
    const knownLimitations: 'alpha6-binding-retry-needs-second-request'[] = []
    const context: ReliabilityContext = {
        source: options.source,
        noteKnownLimitation(name) {
            assert.equal(options.source, 'alpha.6')
            assert.equal(name, 'alpha6-binding-retry-needs-second-request')
            if (!knownLimitations.includes(name)) knownLimitations.push(name)
            console.log('BASELINE LIMITATION ' + name)
        },
        command,
        docker,
        fixture,
        controller,
        waitFor,
        check,
        synced,
        restart,
        expireCertificateRetry,
        http,
        captureTrafficDiagnostic,
        recordTrafficFailure(route, status) {
            traffic.recordFailure({ route, status, hostFetchCode: null })
        },
        startFixtureTls,
        runId,
        container,
        network,
        pebble,
        domain,
        temp,
        tlsPort: 8443,
        publicTlsPort: 8443,
        http3Image,
    }
    async function setup() {
        console.log('Preparing isolated ' + options.source + ' runtime')
        targetSha = await command([
            'git',
            '-c',
            'safe.directory=' + repositoryRoot.replaceAll('\\', '/'),
            'rev-parse',
            'HEAD',
        ])
        if (options.source === 'alpha.6') {
            const release = publishedRelease('alpha.6')
            if (options.image && options.image !== release.image)
                throw new ReliabilityError(
                    'assertion',
                    'Alpha 6 requires its published immutable image',
                )
            image = release.image
            await docker(['pull', image], { timeoutMs: 300_000 })
        } else if (!options.image) {
            const source = join(temp, 'current-source')
            await archive(targetSha, source)
            ownedImages.push(builtImage)
            await docker(
                [
                    'build',
                    '--file',
                    join(source, 'docker/production/Dockerfile'),
                    '--label',
                    'org.opencontainers.image.revision=' + targetSha,
                    '--tag',
                    image,
                    source,
                ],
                { timeoutMs: 1_800_000 },
            )
        }
        imageIdentity = await docker(['image', 'inspect', '--format', '{{.Id}}', image])
        if (options.source === 'current' && options.image) {
            const imageRevision = await docker([
                'image',
                'inspect',
                '--format',
                '{{index .Config.Labels "org.opencontainers.image.revision"}}',
                image,
            ])
            if (imageRevision !== targetSha)
                throw new ReliabilityError(
                    'assertion',
                    'Current prebuilt image must identify the exact target revision',
                )
        }
        await docker(['network', 'create', network])
        await docker(['volume', 'create', volume])
        const transportBundle = join(temp, 'fixture-transport.js')
        await command([
            process.execPath,
            '--no-env-file',
            'build',
            join(repositoryRoot, 'scripts/runtime-reliability/fixture-transport.ts'),
            '--target=bun',
            '--outfile=' + transportBundle,
        ])
        await docker([
            'run',
            '--detach',
            '--name',
            upstream,
            '--network',
            network,
            '--network-alias',
            fixtureTransport.hostname,
            '--read-only',
            '--no-healthcheck',
            '--cap-drop=ALL',
            '--security-opt=no-new-privileges',
            '--tmpfs',
            '/tmp:mode=1777',
            '--tmpfs',
            '/var/lib/postgresql',
            '--tmpfs',
            '/var/lib/rentnerproxy',
            '--mount',
            'type=bind,src=' + transportBundle + ',dst=/fixture-transport.js,readonly',
            '--entrypoint',
            'bun',
            image,
            '--no-env-file',
            '/fixture-transport.js',
        ])
        await waitFor(
            async () => {
                await docker(
                    [
                        'exec',
                        upstream,
                        'bun',
                        '--no-env-file',
                        '-e',
                        `const r=await fetch('http://127.0.0.1:${fixtureTransport.controlPort}/',{signal:AbortSignal.timeout(1000)});if(r.status!==200)process.exit(1)`,
                    ],
                    { timeoutMs: 3_000 },
                )
                return true
            },
            'network fixture readiness',
            15_000,
        )
        await buildHttp3Client(command, http3Image)
        await docker(['create', '--name', prefix + '-certs', pebbleImage])
        await docker([
            'cp',
            prefix + '-certs:/test/certs/pebble.minica.pem',
            join(temp, 'pebble.minica.pem'),
        ])
        await chmod(join(temp, 'pebble.minica.pem'), 0o644)
        await docker(['rm', prefix + '-certs'])
        await writeFile(
            join(temp, 'pebble-config.json'),
            JSON.stringify({
                pebble: {
                    listenAddress: '0.0.0.0:14000',
                    managementListenAddress: '0.0.0.0:15000',
                    certificate: 'test/certs/localhost/cert.pem',
                    privateKey: 'test/certs/localhost/key.pem',
                    httpPort: 8080,
                    tlsPort: 5001,
                    ocspResponderURL: '',
                    externalAccountBindingRequired: false,
                    domainBlocklist: [],
                    retryAfter: { authz: 1, order: 1 },
                    profiles: {
                        default: {
                            description: 'Local reliability certificate',
                            validityPeriod: 86400,
                        },
                    },
                },
            }),
        )
        await docker([
            'run',
            '--detach',
            '--name',
            pebble,
            '--network',
            network,
            '--network-alias',
            'pebble',
            '--add-host',
            'host.docker.internal:host-gateway',
            '--env',
            'PEBBLE_VA_NOSLEEP=1',
            '--env',
            'PEBBLE_AUTHZREUSE=0',
            '--volume',
            join(temp, 'pebble-config.json') + ':/tmp/pebble-config.json:ro',
            pebbleImage,
            '-config',
            '/tmp/pebble-config.json',
            '-strict',
            '-dnsserver',
            'host.docker.internal:' + dns.dnsPort,
        ])
        await writeCompose()
        await docker(
            ['compose', '--project-name', prefix, '--file', composeFile, 'up', '--detach'],
            { timeoutMs: 150_000 },
        )
        started = true
        const probeScript =
            "for (const endpoint of ['http://127.0.0.1:3000/health/ready','http://127.0.0.1:8081/ready']) { try {const r=await fetch(endpoint,{signal:AbortSignal.timeout(3000)}); console.log(new URL(endpoint).port+':'+r.status);}catch{console.log(new URL(endpoint).port+':unreachable')} }"
        console.log(
            'Initial readiness: ' +
                (await docker(['exec', container, 'bun', '--no-env-file', '-e', probeScript]).catch(
                    () => 'probe unavailable',
                )),
        )
        await ready()
        if (options.source === 'current') {
            assert.match(
                await docker([
                    'exec',
                    container,
                    '/opt/rentnerproxy/valkey/bin/valkey-server',
                    '--version',
                ]),
                /Valkey server v=9\.1\.2/u,
            )
            assert.equal(
                await docker([
                    'exec',
                    container,
                    'gosu',
                    'rentnerproxy',
                    '/opt/rentnerproxy/valkey/bin/valkey-cli',
                    'ping',
                ]),
                'PONG',
            )
            check('health', 'bundled Valkey is ready')
        }
        const fixtureRoot = join(temp, 'fixture-source')
        const fixtureTsconfig = options.source === 'alpha.6' ? 'web/tsconfig.json' : 'tsconfig.json'
        await archive(
            options.source === 'alpha.6' ? publishedRelease('alpha.6').revision : targetSha,
            fixtureRoot,
            ['web/src', fixtureTsconfig, 'package.json', 'bun.lock'],
        )
        await mkdir(join(fixtureRoot, 'scripts/runtime-reliability'), { recursive: true })
        for (const name of options.source === 'alpha.6'
            ? ['fixture.ts', 'fixture-context.ts', 'fixture.validation.ts']
            : ['fixture.ts', 'fixture-beta.ts', 'fixture-context.ts', 'fixture.validation.ts']) {
            let fixtureContents = await readFile(
                join(repositoryRoot, 'scripts/runtime-reliability', name),
                'utf8',
            )
            if (options.source === 'alpha.6' && name === 'fixture-context.ts') {
                assert.ok(fixtureContents.includes('../../web/src/server/Valkey/client.server.ts'))
                assert.ok(fixtureContents.includes('valkey.closeValkeyClient()'))
                fixtureContents = fixtureContents
                    .replace(
                        '../../web/src/server/Valkey/client.server.ts',
                        '../../web/src/server/redis/client.server.ts',
                    )
                    .replaceAll('valkey.closeValkeyClient()', 'valkey.closeRedisClient()')
            }
            if (options.source === 'alpha.6') {
                fixtureContents = fixtureContents.replaceAll(
                    '../../web/src/server/Controller/proxy.server.ts',
                    '../../web/src/server/Foundation/controller.server.ts',
                )
            }
            await writeFile(join(fixtureRoot, 'scripts/runtime-reliability', name), fixtureContents)
        }
        const fixtureSource = join(
            fixtureRoot,
            'scripts/runtime-reliability',
            options.source === 'alpha.6' ? 'fixture.ts' : 'fixture-beta.ts',
        )
        const bundle = join(temp, 'reliability-fixture.js')
        await command([
            process.execPath,
            '--no-env-file',
            'build',
            fixtureSource,
            '--tsconfig-override=' + join(fixtureRoot, fixtureTsconfig),
            '--target=bun',
            '--packages=external',
            '--outfile=' + bundle,
        ])
        await docker(['cp', bundle, container + ':/opt/rentnerproxy/web/reliability-fixture.js'])
        check('health', 'production appliance is ready')
    }
    let previousCpu: { usage: number; time: number } | undefined
    async function resources(elapsedSeconds: number): Promise<ResourceSample> {
        const script = `import { readdir, readFile } from 'node:fs/promises';
const text = p => readFile(p,'utf8');
let webFds=0, controllerFds=0, caddyFds=0;
for(const pid of await readdir('/proc')) { if(!/^\\d+$/.test(pid)||Number(pid)===process.pid) continue; try {
const name=(await text('/proc/'+pid+'/comm')).trim();
let kind=name==='caddy'?'caddy':name==='rentnerproxy-co'?'controller':undefined;
if(name==='bun' && (await text('/proc/'+pid+'/cmdline')).includes('/docker/web/serve.mjs')) kind='web';
if(kind) { const count=(await readdir('/proc/'+pid+'/fd')).length; if(kind==='web')webFds+=count; if(kind==='controller')controllerFds+=count; if(kind==='caddy')caddyFds+=count; }
} catch {} }
const memory=Number(await text('/sys/fs/cgroup/memory.current'));
const stat=await text('/sys/fs/cgroup/memory.stat');
const inactive=Number(stat.match(/^inactive_file (\\d+)/m)?.[1]??0);
const cpu=Number((await text('/sys/fs/cgroup/cpu.stat')).match(/^usage_usec (\\d+)/m)?.[1]);
console.log(JSON.stringify({memoryBytes:Math.max(0,memory-inactive),pids:Number(await text('/sys/fs/cgroup/pids.current')),usage:cpu,webFds,controllerFds,caddyFds}));`
        const metrics = JSON.parse(
            await docker(['exec', container, 'bun', '--no-env-file', '-e', script]),
        ) as Record<string, number>
        const state = JSON.parse(
            await docker(['inspect', '--format', '{{json .State}}', container]),
        ) as { OOMKilled: boolean; Running: boolean }
        assert.equal(state.Running, true)
        const restartCount = Number(
            await docker(['inspect', '--format', '{{.RestartCount}}', container]),
        )
        const postgresConnections = Number(
            await docker([
                'exec',
                container,
                'gosu',
                'postgres',
                'psql',
                '--host=/var/run/postgresql',
                '--username=postgres',
                '--dbname=rentnerproxy',
                '--tuples-only',
                '--no-align',
                '--command',
                "select count(*) from pg_stat_activity where datname = 'rentnerproxy'",
            ]),
        )
        const now = performance.now()
        const cpuPercent = previousCpu
            ? Math.max(0, (metrics.usage! - previousCpu.usage) / ((now - previousCpu.time) * 10))
            : 0
        previousCpu = { usage: metrics.usage!, time: now }
        if (!metrics.webFds || !metrics.controllerFds || !metrics.caddyFds)
            throw new ReliabilityError('telemetry', 'expected runtime process telemetry missing')
        const events = await docker([
            'events',
            '--since',
            String(eventStart),
            '--until',
            String(Math.floor(Date.now() / 1000)),
            '--filter',
            'type=container',
            '--filter',
            'event=oom',
            '--filter',
            'label=io.rentnerproxy.smoke-run=' + process.env.RENTNERPROXY_SMOKE_RUN,
            '--format',
            '{{json .}}',
        ])
        const oomObserved = events
            .split('\n')
            .filter(Boolean)
            .some((line) => {
                const event = JSON.parse(line) as FixtureResult
                return event.Actor?.Attributes?.name === container
            })
        return {
            elapsedSeconds,
            phase: 'quiescent',
            memoryBytes: metrics.memoryBytes!,
            cpuPercent,
            pids: metrics.pids!,
            postgresConnections,
            webFds: metrics.webFds!,
            controllerFds: metrics.controllerFds!,
            caddyFds: metrics.caddyFds!,
            restartCount,
            oomKilled: state.OOMKilled || oomObserved,
        }
    }
    return {
        context,
        knownLimitations,
        setup,
        cleanup,
        resources,
        ready,
        backupRestore,
        get imageIdentity() {
            return imageIdentity
        },
        get targetSha() {
            return targetSha
        },
        get runtimeRevision() {
            return options.source === 'alpha.6' ? publishedRelease('alpha.6').revision : targetSha
        },
        get started() {
            return started
        },
        primaryPort: fixtureTransport.primaryPort,
        secondaryPort: fixtureTransport.secondaryPort,
        setUpstreamFailed(value: boolean) {
            return fixtureControl({ upstreamFailed: value })
        },
        setAuthMode(value: 'allow' | 'deny' | 'unavailable') {
            return fixtureControl({ authMode: value })
        },
    }
}
