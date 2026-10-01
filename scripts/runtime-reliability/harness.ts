// oxlint-disable no-await-in-loop -- Fault injection, recovery probes and lifecycle changes depend on the preceding step.
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { chmod, copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { startCertificateDnsFixture } from '../certificate-dns-fixture'
import { buildHttp3Client } from '../http3-client'
import { publishedAlpha } from '../release-compatibility/published-alphas'
import { smokeCompose, smokeDockerArguments, smokeRunScope } from '../smoke-resources'
import type { ReliabilityCheck, ReliabilityOptions, ResourceSample } from './control'

export class ReliabilityError extends Error {
    constructor(
        readonly category: 'command' | 'timeout' | 'assertion' | 'telemetry',
        label: string,
    ) {
        super(label)
    }
}
export type CommandOptions = {
    timeoutMs?: number
    stdin?: string
    env?: Record<string, string>
    acceptableExitCodes?: number[]
}
export type FixtureResult = Record<string, any>
export type ReliabilityContext = {
    source: ReliabilityOptions['source']
    noteKnownLimitation: (name: 'alpha6-binding-retry-needs-second-request') => void
    command: (args: string[], options?: CommandOptions) => Promise<string>
    docker: (args: string[], options?: CommandOptions) => Promise<string>
    fixture: (phase: string, extra?: Record<string, unknown>) => Promise<FixtureResult>
    controller: (path: string, body?: unknown) => Promise<{ status: number; body: FixtureResult }>
    waitFor: (predicate: () => Promise<boolean>, label: string, timeoutMs?: number) => Promise<void>
    check: (name: ReliabilityCheck['name'], label: string) => void
    synced: (result: FixtureResult) => Promise<void>
    restart: () => Promise<void>
    expireCertificateRetry: (id: string) => Promise<void>
    http: (
        domain?: string,
        path?: string,
        headers?: Record<string, string>,
    ) => Promise<{ status: number; headers: Headers; body: FixtureResult }>
    runId: string
    container: string
    network: string
    pebble: string
    domain: string
    temp: string
    tlsPort: number
    publicTlsPort: number
    http3Image: string
}
const pebbleImage =
    'ghcr.io/letsencrypt/pebble:2.10.1@sha256:ddf230642b1a584f519f32e347de1b05a6e4c1f6c35c1863b33effeab5f78199'
const healthcheck = '/opt/rentnerproxy/web/docker/web/healthcheck.mjs'
const repositoryRoot = resolve(import.meta.dir, '../..')

export async function command(args: string[], options: CommandOptions = {}): Promise<string> {
    const child = Bun.spawn(smokeDockerArguments(args), {
        cwd: repositoryRoot,
        env: { ...process.env, ...options.env },
        stdin: options.stdin === undefined ? 'ignore' : new Response(options.stdin),
        stdout: 'pipe',
        stderr: 'pipe',
    })
    let timedOut = false
    const timer = setTimeout(() => {
        timedOut = true
        child.kill()
    }, options.timeoutMs ?? 45_000)
    try {
        const [code, stdout] = await Promise.all([
            child.exited,
            new Response(child.stdout).text(),
            new Response(child.stderr).text(),
        ])
        if (timedOut) throw new ReliabilityError('timeout', 'bounded command timed out')
        if (code !== 0 && !options.acceptableExitCodes?.includes(code))
            throw new ReliabilityError('command', 'command failed: ' + args.slice(0, 2).join(' '))
        return stdout.trim()
    } finally {
        clearTimeout(timer)
    }
}
export async function waitFor(
    predicate: () => Promise<boolean>,
    label: string,
    timeoutMs = 60_000,
) {
    const deadline = Date.now() + timeoutMs
    do {
        try {
            if (await predicate()) return
        } catch (error) {
            if (
                !(error instanceof ReliabilityError) ||
                (error.category !== 'command' && error.category !== 'timeout')
            )
                throw error
        }
        await Bun.sleep(500)
    } while (Date.now() < deadline)
    throw new ReliabilityError('timeout', label)
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
    const network = prefix + '-network'
    let volume = prefix + '-data'
    const composeFile = join(tmpdir(), prefix + '-compose.yml')
    const http3Image = prefix + '-http3'
    const builtImage = prefix + '-current'
    const temp = await mkdtemp(join(tmpdir(), 'rentnerproxy-reliability-'))
    await chmod(temp, 0o700)
    const ownedContainers = [container, pebble, prefix + '-certs']
    const ownedVolumes = [volume]
    const ownedImages = [http3Image]
    const docker = (args: string[], config?: CommandOptions) => command(['docker', ...args], config)
    const dns = await startCertificateDnsFixture(randomBytes(16).toString('hex'))
    let upstreamFailed = false
    let authMode: 'allow' | 'deny' | 'unavailable' = 'allow'
    const backend = (name: string) =>
        Bun.serve({
            hostname: '0.0.0.0',
            port: 0,
            fetch(request) {
                if (upstreamFailed)
                    return new Response('fixture upstream unavailable', { status: 503 })
                return Response.json({
                    backend: name,
                    user: request.headers.get('Remote-User'),
                    forwardedFor: request.headers.get('X-Forwarded-For'),
                })
            },
        })
    const primary = backend('a')
    const secondary = backend('b')
    const auth = Bun.serve({
        hostname: '0.0.0.0',
        port: 0,
        fetch() {
            if (authMode === 'unavailable') return new Response(null, { status: 503 })
            if (authMode === 'deny') return new Response(null, { status: 401 })
            return new Response(null, {
                status: 200,
                headers: { 'Remote-User': 'reliability-user' },
            })
        },
    })
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
        primary.stop(true)
        secondary.stop(true)
        auth.stop(true)
        dns.stop()
        const failures: unknown[] = []
        for (const name of ownedContainers) {
            const exists = await docker([
                'container',
                'inspect',
                '--format',
                '{{.Id}}',
                name,
            ]).catch(() => '')
            if (exists)
                await docker(['rm', '--force', name]).catch((error: unknown) =>
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
                'REDIS_URL=redis://127.0.0.1:6379',
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
                    upstreamPort: primary.port,
                    secondaryPort: secondary.port,
                    concurrency: options.concurrency,
                    certificateDomain: domain,
                    authPort: auth.port,
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
                    ']',
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
    async function http(host = domain, path = '/', headers: Record<string, string> = {}) {
        const binding = await docker(['port', container, '8080/tcp'])
        assert.match(binding, /^127\.0\.0\.1:\d+$/u)
        const response = await fetch('http://' + binding + path, {
            headers: { host, ...headers },
            redirect: 'manual',
            signal: AbortSignal.timeout(8_000),
        })
        const value = await response.text()
        let body: FixtureResult = {}
        try {
            body = JSON.parse(value) as FixtureResult
        } catch {
            /* Error pages need only their status. */
        }
        return { status: response.status, headers: response.headers, body }
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
                    extra_hosts: ['host.docker.internal:host-gateway'],
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
        await docker([
            'exec',
            container,
            'chmod',
            '600',
            '/tmp/rentnerproxy-reliability-fixture.json',
        ])
        await ready()
        const after = await fixture('durability-read')
        assert.deepEqual(after.durableCounts, before.durableCounts)
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
            const release = publishedAlpha('alpha.6')
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
        await buildHttp3Client(command, http3Image)
        await docker(['create', '--name', prefix + '-certs', pebbleImage])
        await docker([
            'cp',
            prefix + '-certs:/test/certs/pebble.minica.pem',
            join(temp, 'pebble.minica.pem'),
        ])
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
        const fixtureRoot = join(temp, 'fixture-source')
        await archive(
            options.source === 'alpha.6' ? publishedAlpha('alpha.6').revision : targetSha,
            fixtureRoot,
            ['web/src', 'package.json', 'bun.lock'],
        )
        await mkdir(join(fixtureRoot, 'scripts/runtime-reliability'), { recursive: true })
        for (const name of options.source === 'alpha.6'
            ? ['fixture.ts']
            : ['fixture.ts', 'fixture-beta.ts']) {
            await copyFile(
                join(repositoryRoot, 'scripts/runtime-reliability', name),
                join(fixtureRoot, 'scripts/runtime-reliability', name),
            )
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
            return options.source === 'alpha.6' ? publishedAlpha('alpha.6').revision : targetSha
        },
        get started() {
            return started
        },
        primaryPort: primary.port!,
        secondaryPort: secondary.port!,
        setUpstreamFailed(value: boolean) {
            upstreamFailed = value
        },
        setAuthMode(value: typeof authMode) {
            authMode = value
        },
    }
}
