// oxlint-disable no-await-in-loop -- Readiness, admission and scoped cleanup depend on prior attempts.
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { smokeDockerArguments } from '../../../scripts/smoke-resources.ts'
import { controllerCall, seedDrainFixture } from './appliance-drain-fixture.ts'
import { drainRequest } from './appliance-drain-request.ts'
import type {
    DrainCommand,
    DrainFixture,
    DrainLifecycleEvent,
} from './Types/appliance-drain-smoke.types.ts'

const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url))
const runId = randomBytes(6).toString('hex')
const prefix = 'rentnerproxy-drain-' + runId
const container = prefix + '-app'
const upstream = prefix + '-upstream'
const network = prefix + '-network'
const volume = prefix + '-data'
const labelKey = 'io.rentnerproxy.appliance-drain'
const root = await mkdtemp(join(tmpdir(), prefix + '-'))
const imageIndex = process.argv.indexOf('--image')
const suppliedImage = imageIndex === -1 ? undefined : process.argv[imageIndex + 1]
assert.ok(imageIndex === -1 || (suppliedImage && !suppliedImage.startsWith('-')))
const image = suppliedImage ?? prefix + '-current'
const owned: { kind: 'container' | 'volume' | 'network' | 'image'; name: string }[] = []
const measurements: unknown[] = []
let stage = 'build'
let assertions = 0
let ca = ''
let httpPort = 0
let tlsPort = 0

const command: DrainCommand = async (args, options = {}) => {
    const process = Bun.spawn(smokeDockerArguments(['docker', ...args]), {
        cwd: root,
        stdin: options.stdin === undefined ? 'ignore' : new Response(options.stdin),
        stdout: 'pipe',
        stderr: 'pipe',
    })
    let timedOut = false
    const timer = setTimeout(() => {
        timedOut = true
        process.kill()
    }, options.timeoutMs ?? 60_000)
    try {
        const [code, output] = await Promise.all([
            process.exited,
            new Response(process.stdout).text(),
            new Response(process.stderr).text(),
        ])
        if (timedOut || (code !== 0 && !options.allowFailure))
            throw new Error('docker-command-failed')
        return { code, output: output.trim() }
    } finally {
        clearTimeout(timer)
    }
}
const context: DrainFixture = {
    command,
    container,
    upstream,
    domain: 'drain-' + runId + '.example.test',
    root,
    step: (name) => {
        stage = name
    },
}
function pass(message: string) {
    assertions += 1
    console.log('PASS ' + message)
}
async function waitFor(probe: () => Promise<boolean>, name: string, milliseconds = 150_000) {
    const deadline = performance.now() + milliseconds
    do {
        try {
            if (await probe()) return
        } catch {
            /* Startup transitions are expected. */
        }
        await Bun.sleep(250)
    } while (performance.now() < deadline)
    throw new Error('timeout-' + name)
}
async function ready() {
    await waitFor(
        async () =>
            (
                await command(
                    ['exec', container, 'bun', '/opt/rentnerproxy/web/docker/web/healthcheck.mjs'],
                    { allowFailure: true, timeoutMs: 8_000 },
                )
            ).code === 0,
        'appliance-readiness',
    )
}
async function published(port: number): Promise<number> {
    const value = (await command(['port', container, port + '/tcp'])).output
    const matched = /^127\.0\.0\.1:(\d+)$/u.exec(value)
    assert.ok(matched)
    return Number(matched[1])
}
async function admitted(ids: string[]) {
    await waitFor(
        async () => {
            const result = await command([
                'exec',
                upstream,
                'bun',
                '--no-env-file',
                '-e',
                "const r=await fetch('http://127.0.0.1:8088/admitted');process.stdout.write(JSON.stringify(await r.json()))",
            ])
            const observed: unknown = JSON.parse(result.output)
            return Array.isArray(observed) && ids.every((id) => observed.includes(id))
        },
        'upstream-admission',
        5_000,
    )
}
async function events(since: number): Promise<DrainLifecycleEvent[]> {
    const result = await command([
        'events',
        '--since',
        String(since),
        '--until',
        String(Math.floor(Date.now() / 1000) + 1),
        '--filter',
        'container=' + container,
        '--format',
        '{{json .}}',
    ])
    return result.output
        .split('\n')
        .filter(Boolean)
        .map((line) => {
            const event = JSON.parse(line)
            const lifecycleEvent: DrainLifecycleEvent = { action: String(event.Action) }
            if (event.Actor?.Attributes?.signal)
                lifecycleEvent.signal = String(event.Actor.Attributes.signal)
            if (event.Actor?.Attributes?.exitCode)
                lifecycleEvent.exitCode = String(event.Actor.Attributes.exitCode)
            return lifecycleEvent
        })
        .filter((event) => ['kill', 'die', 'stop'].includes(event.action))
}
async function drain(seconds: 16 | 60) {
    stage = seconds === 16 ? 'admitted-requests-drain' : 'stuck-requests-deadline'
    const ids = [randomUUID(), randomUUID()]
    const since = Math.floor(Date.now() / 1000)
    const started = performance.now()
    const requests = [
        drainRequest(
            'http',
            httpPort,
            context.domain,
            '/hold/' + ids[0] + '?seconds=' + seconds,
            ca,
        ),
        drainRequest(
            'https',
            tlsPort,
            context.domain,
            '/hold/' + ids[1] + '?seconds=' + seconds,
            ca,
        ),
    ]
    await admitted(ids)
    const admittedAt = performance.now()
    const stopStarted = performance.now()
    await command(['stop', '--time', '30', container], { timeoutMs: 40_000 })
    const stopFinished = performance.now()
    const responses = await Promise.all(requests)
    const lifecycle = await events(since)
    const state = JSON.parse(
        (await command(['inspect', '--format', '{{json .State}}', container])).output,
    )
    const measurement = {
        seconds,
        admissionMs: Math.round(admittedAt - started),
        stopMs: Math.round(stopFinished - stopStarted),
        responses,
        exitCode: state.ExitCode,
        oomKilled: state.OOMKilled,
        lifecycle,
    }
    measurements.push(measurement)
    console.log('DRAIN_MEASUREMENT ' + JSON.stringify(measurement))
    assert.equal(state.ExitCode, 0)
    assert.equal(state.OOMKilled, false)
    assert.equal(
        lifecycle.some((event) => event.action === 'kill' && event.signal === '9'),
        false,
    )
    assert.ok(stopFinished - stopStarted < 28_000)
    if (seconds === 16) {
        assert.ok(responses.every((response) => response.ok))
        pass('admitted HTTP and CA-verified HTTPS requests complete before appliance stop')
    } else {
        assert.ok(responses.every((response) => !response.ok && response.elapsedMs < 26_000))
        assert.ok(stopFinished - stopStarted >= 19_000)
        pass('stuck HTTP and HTTPS requests terminate within the controller drain deadline')
    }
    pass('appliance exits normally without Docker SIGKILL or OOM')
}

async function cleanup() {
    const failures: string[] = []
    for (const resource of owned.toReversed()) {
        assert.ok(resource.name.startsWith(prefix + '-'))
        const format =
            resource.kind === 'container' || resource.kind === 'image'
                ? '{{index .Config.Labels "' + labelKey + '"}}'
                : '{{index .Labels "' + labelKey + '"}}'
        const inspected = await command(
            [resource.kind, 'inspect', '--format', format, resource.name],
            { allowFailure: true },
        )
        if (inspected.code !== 0) continue
        if (inspected.output !== runId) {
            failures.push('ownership-guard')
            continue
        }
        // --volumes removes only anonymous volumes owned by these fixture containers.
        const args =
            resource.kind === 'container'
                ? ['rm', '--force', '--volumes', resource.name]
                : [resource.kind, 'rm', resource.name]
        if ((await command(args, { allowFailure: true })).code !== 0)
            failures.push(resource.kind + '-cleanup')
    }
    if (failures.length) throw new Error('owned-resource-cleanup-failed')
    const outputIndex = process.argv.indexOf('--output')
    if (outputIndex !== -1 && process.argv[outputIndex + 1]) {
        await writeFile(
            resolve(process.argv[outputIndex + 1]!),
            JSON.stringify({ stage, image, measurements, cleanup: 'complete' }, null, 2),
        )
    }
    assert.equal(dirname(resolve(root)), resolve(tmpdir()))
    assert.ok(basename(root).startsWith(prefix + '-'))
    await rm(root, { recursive: true, force: true })
}

try {
    const composeSource = Bun.YAML.parse(
        await readFile(join(repositoryRoot, 'docker-compose.yml'), 'utf8'),
    ) as { services: { rentnerproxy: { stop_grace_period?: string } } }
    assert.equal(composeSource.services.rentnerproxy.stop_grace_period, '30s')
    if (!suppliedImage) {
        const git = Bun.spawn(
            [
                'git',
                '-c',
                'safe.directory=' + repositoryRoot.replaceAll('\\', '/'),
                'rev-parse',
                'HEAD',
            ],
            { cwd: repositoryRoot, stdout: 'pipe', stderr: 'pipe' },
        )
        const [revision, exit] = await Promise.all([
            new Response(git.stdout).text(),
            git.exited,
            new Response(git.stderr).text(),
        ])
        assert.equal(exit, 0)
        assert.match(revision.trim(), /^[a-f0-9]{40}$/u)
        owned.push({ kind: 'image', name: image })
        await command(
            [
                'build',
                '--file',
                join(repositoryRoot, 'docker/production/Dockerfile'),
                '--label',
                labelKey + '=' + runId,
                '--label',
                'org.opencontainers.image.revision=' + revision.trim(),
                '--tag',
                image,
                repositoryRoot,
            ],
            { timeoutMs: 1_800_000 },
        )
    }
    const imageIdentity = (await command(['image', 'inspect', '--format', '{{.Id}}', image])).output
    assert.match(imageIdentity, /^sha256:[a-f0-9]{64}$/u)
    console.log('Drain smoke image: ' + imageIdentity)
    for (const [kind, name] of [
        ['network', network],
        ['volume', volume],
    ] as const) {
        owned.push({ kind, name })
        await command([kind, 'create', '--label', labelKey + '=' + runId, name])
    }
    stage = 'upstream-startup'
    owned.push({ kind: 'container', name: upstream })
    await command([
        'run',
        '--detach',
        '--name',
        upstream,
        '--label',
        labelKey + '=' + runId,
        '--network',
        network,
        '--memory',
        '256m',
        '--pids-limit',
        '64',
        '--entrypoint',
        'bun',
        '--volume',
        join(repositoryRoot, '.github/scripts/ci/appliance-drain-upstream.ts') +
            ':/test/upstream.ts:ro',
        image,
        '--no-env-file',
        '/test/upstream.ts',
    ])
    await waitFor(
        async () =>
            (
                await command(
                    [
                        'exec',
                        upstream,
                        'bun',
                        '--no-env-file',
                        '-e',
                        "const r=await fetch('http://127.0.0.1:8088/ready');process.exit(r.status===200?0:1)",
                    ],
                    { allowFailure: true },
                )
            ).code === 0,
        'upstream-readiness',
        15_000,
    )
    stage = 'appliance-startup'
    owned.push({ kind: 'container', name: container })
    await command([
        'run',
        '--detach',
        '--name',
        container,
        '--label',
        labelKey + '=' + runId,
        '--network',
        network,
        '--memory',
        '1g',
        '--cpus',
        '2',
        '--pids-limit',
        '512',
        '--stop-timeout',
        '30',
        '--publish',
        '127.0.0.1::8080',
        '--publish',
        '127.0.0.1::8443',
        '--env',
        'RENTNERPROXY_PUBLIC_ORIGIN=https://drain-management.example.invalid',
        '--env',
        'SMTP_HOST=127.0.0.1',
        '--env',
        'SMTP_PORT=2525',
        '--env',
        'SMTP_SECURE=false',
        '--env',
        'SMTP_FROM=drain@example.invalid',
        '--env',
        'SMTP_USER=fixture',
        '--env',
        'SMTP_PASSWORD=fixture-only',
        '--volume',
        volume + ':/var/lib/rentnerproxy',
        image,
    ])
    await ready()
    pass('isolated production appliance and fresh database are ready')
    httpPort = await published(8080)
    tlsPort = await published(8443)
    stage = 'route-and-managed-crowdsec-fixture'
    ca = await readFile(await seedDrainFixture(context), 'utf8')
    await waitFor(
        async () => {
            const status = await controllerCall(context, '/internal/v1/crowdsec/status')
            return (
                status.status === 200 &&
                status.body.mode === 'managed' &&
                status.body.managedEngine === 'ready'
            )
        },
        'managed-crowdsec',
        60_000,
    )
    pass('DB-backed route, imported certificate and managed CrowdSec are active')
    await drain(16)
    stage = 'appliance-restart'
    await command(['start', container])
    await ready()
    // Docker may assign new dynamic host ports when the stopped container starts.
    httpPort = await published(8080)
    tlsPort = await published(8443)
    await drain(60)
    stage = 'complete'
    console.log('Appliance drain smoke passed: ' + assertions + ' assertions')
} catch {
    console.error('Appliance drain smoke failed at ' + stage)
    process.exitCode = 1
} finally {
    try {
        await cleanup()
    } catch {
        console.error('Appliance drain smoke owned-resource cleanup failed')
        process.exitCode = 1
    }
}
