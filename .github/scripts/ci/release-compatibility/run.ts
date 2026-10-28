import { webSocketProbeScript } from './websocket-probe.ts'
import { prepareTargetSource, immutableImageId } from './source-identity.ts'
import {
    copyHistoricalZod,
    loadHistoricalToolClosure,
    readHistoricalToolSource,
} from './historical-dependencies.ts'
import { publishedSourceRevision } from './select-sources.ts'
import {
    discoverPublishedReleases,
    loadPublishedSource,
    parseCompatibilitySource,
    verifyCompatibilitySource,
} from '../../../../scripts/compatibility/source-selection.ts'
import { runSmokeProcess } from '../../../../scripts/smoke/process.ts'
import { waitForSmoke } from '../../../../scripts/smoke/wait.ts'
import { psql } from '../fixtures/appliance-storage.ts'
import { assertBackupState, seedBackupState } from '../fixtures/backup-state.ts'
import type { BackupStateFixture } from '../fixtures/Types/backup-state.types.ts'
// oxlint-disable no-await-in-loop -- Appliance phases and bounded readiness probes run in order.
import assert from 'node:assert/strict'
import { dockerBuildDiagnostic } from '../../../../scripts/smoke/docker-build-diagnostics.ts'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

import {
    CURRENT_MIGRATION_COUNT,
    assertUpgradeFixture,
    seedUpgradeFixture,
} from '../fixtures/upgrade-state.ts'
import type { UpgradeFixture } from '../fixtures/Types/upgrade-state.types.ts'
import {
    assertPersistenceFixture,
    assertPersistenceRequestDecrypts,
    readPersistenceSnapshot,
    seedPersistenceFixture,
    type PersistenceFixture,
    type PersistenceSnapshot,
} from '../fixtures/persistence/state.ts'
import {
    assertHttp3Response,
    buildHttp3Client,
    requestHttp3Client,
} from '../../../../scripts/smoke/http3/client.ts'
import {
    restoreSmokeDiagnostic,
    smokeCompose,
    smokeDockerArguments,
} from '../../../../scripts/smoke/resources.ts'
import { assertAuthFixture, seedAuthFixture } from './auth-state.ts'
import type { AuthFixture } from './Types/auth-state.types.ts'
import { assertAuditFixture, seedAuditFixture } from './audit-state.ts'
import type { AuditFixture } from './Types/audit-state.types.ts'
import { assertAcmeAccountFixture, seedAcmeAccountFixture } from './acme-account-state.ts'
import type { AcmeAccountFixture } from './Types/acme-account-state.types.ts'
import {
    assertBetaDefaults,
    assertFreshExternalDefaults,
    assertPolicyFixture,
    seedPolicyFixture,
} from './state.ts'
import type { PolicyFixture } from './Types/state.types.ts'

const root = fileURLToPath(new URL('../../../..', import.meta.url))
const binding = parseCompatibilitySource(process.env.COMPATIBILITY_SOURCE ?? '')
const source = binding.release
const discoveryToken = process.env.GH_TOKEN
delete process.env.GH_TOKEN
delete process.env.GITHUB_TOKEN
const runId = randomUUID().replaceAll('-', '').slice(0, 12)
const project = `rp-compat-${runId}`
const targetImage = `rentnerproxy:compat-${runId}`
const http3Image = `rentnerproxy:compat-http3-${runId}`
const marker = `release-compatibility-${runId}`
let stage = 'prepare'
let container = ''
let health = 'not-started'
let migrationStatus = 'not-started'
let sourceMigrationCount = 0
let reconciliation = 'not-started'
let trafficStatus = 'not-started'
let temporaryRoot = ''
let targetSourceRevision = 'unverified'
let targetImageId = 'unbuilt'
let historicalFiles: ReadonlyMap<string, string> = new Map()
let backend: ReturnType<typeof Bun.serve> | undefined

const environment: NodeJS.ProcessEnv = { ...process.env }
for (const key of [
    'APP_ENCRYPTION_KEY',
    'DATABASE_URL',
    'POSTGRES_PASSWORD',
    'RENTNERPROXY_APP_KEY_FILE',
    'RENTNERPROXY_CONTROLLER_TOKEN',
    'SMTP_PASSWORD',
]) {
    delete environment[key]
}

async function command(
    args: string[],
    timeoutMs = 120_000,
    extraEnvironment: NodeJS.ProcessEnv = {},
): Promise<string> {
    const { exitCode, stdout, stderr, timedOut } = await runSmokeProcess(
        smokeDockerArguments(args),
        {
            cwd: root,
            env: { ...environment, ...extraEnvironment },
            timeoutMs,
        },
    )
    if (exitCode !== 0 || timedOut) {
        if (args[0] === 'docker' && args[1] === 'build')
            console.error(dockerBuildDiagnostic(stdout, stderr))
        // Docker, SQL and application output can contain private fixture material.
        const diagnostic = restoreSmokeDiagnostic(stderr)
        if (diagnostic) console.error(diagnostic)
        throw new Error(`command failed: ${args[0]} ${args[1] ?? ''} (exit ${exitCode})`)
    }
    // docker logs keeps the container's stdout and stderr in separate streams.
    const output = args[0] === 'docker' && args[1] === 'logs' ? stdout + stderr : stdout || stderr
    return args[0] === 'git' && args[1] === 'show' ? output : output.trim()
}

function waitFor(check: () => Promise<boolean>, label: string, timeoutMs = 240_000): Promise<void> {
    return waitForSmoke(check, {
        timeoutMs,
        intervalMs: 750,
        timeoutError: () => new Error(`timed out: ${label}`),
    })
}

async function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = createServer()
        server.once('error', reject)
        server.listen(0, '127.0.0.1', () => {
            const address = server.address()
            server.close((error) => {
                if (error || !address || typeof address === 'string')
                    reject(error ?? new Error('port unavailable'))
                else resolve(address.port)
            })
        })
    })
}

function compose(file: string): string[] {
    return ['docker', 'compose', '--project-name', project, '--file', file]
}

function composeFile(image: string, upstreamPort: number): string {
    return smokeCompose(
        JSON.stringify({
            services: {
                rentnerproxy: {
                    image,
                    extra_hosts: ['host.docker.internal:host-gateway'],
                    environment: {
                        SMTP_FROM: 'RentnerProxy <noreply@compat.invalid>',
                        SMTP_HOST: 'smtp.compat.invalid',
                        SMTP_PASSWORD: `compat-${runId}`,
                        SMTP_PORT: '587',
                        SMTP_SECURE: 'false',
                        SMTP_USER: 'compat',
                        PUBLIC_ORIGIN: 'https://management.compat.invalid',
                        PROXY_TRUSTED_PROXY_CIDRS: '127.0.0.1/32,::1/128',
                        RENTNERPROXY_PUBLIC_ORIGIN: 'https://management.compat.invalid',
                        RENTNERPROXY_PROXY_TRUSTED_PROXY_CIDRS: '127.0.0.1/32,::1/128',
                    },
                    volumes: ['data:/var/lib/rentnerproxy', 'postgres-base:/var/lib/postgresql'],
                    labels: {
                        'io.rentnerproxy.compat-source': source?.version ?? 'fresh',
                        'io.rentnerproxy.compat-upstream-port': String(upstreamPort),
                    },
                },
            },
            volumes: { data: {}, 'postgres-base': {} },
        }),
    )
}

async function materializePinnedScript(
    revision: string,
    release: string,
    repositoryPath: string,
): Promise<{ readonly path: string; readonly sha256: string }> {
    if (revision !== source?.revision) throw new Error('historical tool revision mismatch')
    const contents = historicalFiles.get(repositoryPath)
    if (contents === undefined) throw new Error('historical tool outside validated closure')
    const path = join(temporaryRoot, 'historical-tools', release, repositoryPath)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, contents, { mode: 0o600 })
    return { path, sha256: createHash('sha256').update(contents).digest('hex') }
}

async function createPinnedSourceBackup(backupRoot: string): Promise<string> {
    if (!source) throw new Error('source release missing')
    const release = source.version
    historicalFiles = await loadHistoricalToolClosure((path) =>
        readHistoricalToolSource(command, source.revision, path),
    )
    for (const path of historicalFiles.keys())
        await materializePinnedScript(source.revision, release, path)
    // Historical tools import only Zod beyond Bun/Node builtins and the pinned local files.
    // Copy that package into this disposable tool tree; Windows needs no symlink privilege.
    await copyHistoricalZod(
        join(root, 'node_modules', 'zod'),
        join(temporaryRoot, 'historical-tools', release),
    )
    const backupScript = await materializePinnedScript(
        source.revision,
        release,
        'scripts/production-backup.ts',
    )

    await command(
        [
            process.execPath,
            '--no-env-file',
            backupScript.path,
            '--project',
            project,
            '--output',
            backupRoot,
        ],
        900_000,
        { RENTNERPROXY_COMPOSE_FILE: join(temporaryRoot, 'source.compose.json') },
    )
    const backups = await readdir(backupRoot)
    assert.equal(backups.length, 1)
    const backupPath = join(backupRoot, backups[0]!)
    const metadata = JSON.parse(await readFile(join(backupPath, 'metadata.json'), 'utf8')) as {
        readonly format?: string
        readonly version?: number
        readonly source?: { readonly version: string; readonly revision: string }
    }
    assert.equal(metadata.format, 'rentnerproxy-production-backup')
    assert.equal(metadata.version, 4)
    assert.equal(metadata.source?.version, source.version)
    assert.equal(metadata.source?.revision, source.revision)
    console.log(
        `source_backup_version=${metadata.version} source_backup_script_sha256=${backupScript.sha256} source_revision=${source.revision}`,
    )
    return backupPath
}

async function restorePinnedSourceBackup(inputPath: string, composePath: string): Promise<void> {
    if (!source) throw new Error('source release missing')
    const release = source.version
    const restoreScript = await materializePinnedScript(
        source.revision,
        release,
        'scripts/production-restore.ts',
    )

    await command(
        [
            process.execPath,
            '--no-env-file',
            restoreScript.path,
            '--input',
            inputPath,
            '--project',
            project,
            '--confirm-replace',
        ],
        1_200_000,
        { RENTNERPROXY_COMPOSE_FILE: composePath },
    )
    console.log(
        `source_restore_script_sha256=${restoreScript.sha256} source_revision=${source.revision}`,
    )
}

async function restoreCurrentTargetBackup(inputPath: string, composePath: string): Promise<void> {
    await command(
        [
            process.execPath,
            '--no-env-file',
            'scripts/production-restore.ts',
            '--input',
            inputPath,
            '--project',
            project,
            '--confirm-replace',
        ],
        1_200_000,
        { RENTNERPROXY_COMPOSE_FILE: composePath },
    )
}

async function start(file: string): Promise<void> {
    await command([...compose(file), 'up', '--detach'], 240_000)
    container = await command([...compose(file), 'ps', '--all', '--quiet', 'rentnerproxy'])
    assert.ok(container)
    await waitFor(async () => {
        health = await command([
            'docker',
            'inspect',
            '--format',
            '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}|{{.State.ExitCode}}',
            container,
        ])
        return health.includes('|healthy|')
    }, 'appliance health')
}

async function migrationCount(): Promise<number> {
    const count = await psql(
        command,
        container,
        'select count(*) from drizzle.__drizzle_migrations',
    )
    migrationStatus = count
    return Number(count)
}

async function activeRevision(): Promise<string> {
    const script =
        "const token=await Bun.file('/run/rentnerproxy/controller-token/value').text();const response=await fetch('http://127.0.0.1:8081/internal/v1/proxy/status',{headers:{authorization:'Bearer '+token}});if(!response.ok)process.exit(1);const status=await response.json();process.stdout.write(JSON.stringify({available:status.available===true,running:status.running===true,activeRevision:status.activeRevision??null}));"
    const value = await command([
        'docker',
        'exec',
        '--user',
        '10001:10001',
        container,
        'bun',
        '-e',
        script,
    ])
    const status = JSON.parse(value) as {
        readonly available: boolean
        readonly running: boolean
        readonly activeRevision: string | null
    }
    reconciliation = `available:${status.available} running:${status.running} active:${status.activeRevision !== null}`
    if (!status.activeRevision) throw new Error('runtime revision pending')
    return status.activeRevision
}

async function waitForCertificateCursor(): Promise<void> {
    await waitFor(
        async () => {
            const databaseCursor = await psql(
                command,
                container,
                "select coalesce(cursor, '') from rentnerproxy.certificate_event_cursor where id=1",
            )
            if (!databaseCursor) return false
            const script =
                "const token=await Bun.file('/run/rentnerproxy/controller-token/value').text();const response=await fetch('http://127.0.0.1:8081/internal/v1/certificates/events?limit=200',{headers:{authorization:'Bearer '+token}});if(!response.ok)process.exit(1);const page=await response.json();if(page.hasMore||!page.nextCursor)process.exit(1);process.stdout.write(page.nextCursor);"
            const controllerCursor = await command([
                'docker',
                'exec',
                '--user',
                '10001:10001',
                container,
                'bun',
                '-e',
                script,
            ])
            return databaseCursor === controllerCursor
        },
        'source certificate event cursor',
        90_000,
    )
}

async function appKeyDigest(): Promise<string> {
    const output = await command([
        'docker',
        'exec',
        container,
        'sha256sum',
        '/run/rentnerproxy/app-key/value',
    ])
    const digest = /^([0-9a-f]{64})\s/u.exec(output)?.[1]
    if (!digest) throw new Error('application key digest unavailable')
    return digest
}

async function verifyLogin(base: UpgradeFixture, expectedSessions: number): Promise<void> {
    const script = [
        "let status=0;let diagnostic='unknown';",
        'try {',
        "const {toJSONAsync}=await import('/opt/rentnerproxy/web/node_modules/seroval/dist/index.js');",
        "const manifest=await Bun.file('/opt/rentnerproxy/web/web/dist/server/server.js').text();",
        'const id=/"([0-9a-f]{64})":\\s*\\{\\s*functionName: "loginHandler_createServerFn_handler"/.exec(manifest)?.[1];',
        "if(!id){diagnostic='manifest-id-missing'}else{",
        `const body=JSON.stringify(await toJSONAsync({data:{email:${JSON.stringify(`owner-${base.runId}@beta1.invalid`)},password:${JSON.stringify('beta1-upgrade-fixture-password')}}}));`,
        "const response=await fetch('http://127.0.0.1:3000/_serverFn/'+id,{method:'POST',headers:{origin:'http://127.0.0.1:3000','content-type':'application/json',accept:'application/json','x-tsr-serverFn':'true'},body});",
        'status=response.status;',
        "diagnostic=response.status===200?'login-http-ok':`http:${status}`;}",
        "}catch(error){diagnostic=`exception:${status}:${error instanceof Error?error.name:'unknown'}`;}",
        'process.stdout.write(diagnostic);',
    ].join('')
    const diagnostic = await command(
        ['docker', 'exec', '--user', '10002:10002', container, 'bun', '-e', script],
        30_000,
    )
    if (diagnostic !== 'login-http-ok') console.error(`login_probe=${diagnostic}`)
    assert.equal(diagnostic, 'login-http-ok')
    const count = await psql(
        command,
        container,
        `select count(*) from rentnerproxy.sessions where user_id='${base.ownerUserId}'`,
    )
    assert.equal(Number(count), expectedSessions)
}

async function assertErasedJournalFailsClosed(
    file: string,
    fixture: UpgradeFixture,
): Promise<void> {
    stage = 'failure-injection'
    await psql(command, container, 'delete from drizzle.__drizzle_migrations')
    assert.equal(await migrationCount(), 0)
    const since = new Date(Date.now() - 1_000).toISOString()
    await command([...compose(file), 'restart', 'rentnerproxy'], 180_000).catch(() => undefined)
    stage = 'failure-validation'
    await waitFor(
        async () => {
            health = await command([
                'docker',
                'inspect',
                '--format',
                '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}|{{.State.ExitCode}}',
                container,
            ])
            return health.startsWith('exited|')
        },
        'erased migration journal must stop startup',
        90_000,
    )
    assert.equal(health.split('|')[2] === '0', false)
    const logs = await command(['docker', 'logs', '--since', since, container], 30_000)
    if (!logs.includes('Migration failed during schema migration.')) {
        console.error(
            `migration_log_probe=schema:${logs.includes('schema migration')} registry:${logs.includes('authorization registry')} connection:${logs.includes('database connection')}`,
        )
    }
    assert.ok(logs.includes('Migration failed during schema migration.'))
    assert.equal(logs.includes(fixture.passwordHash), false)
    assert.equal(logs.includes('beta1-upgrade-fixture-password'), false)
    assert.equal(logs.includes(fixture.caPem), false)
    console.log(
        'PASS corrupted migration journal fails startup before web readiness without logging fixture secrets',
    )
}

async function http(domain: string, credentials?: string): Promise<string> {
    const status = await command(
        [
            'docker',
            'exec',
            container,
            'curl',
            '--silent',
            '--show-error',
            '--max-time',
            '5',
            '--noproxy',
            '*',
            '--header',
            `Host: ${domain}`,
            ...(credentials ? ['--user', credentials] : []),
            '--output',
            '/dev/null',
            '--write-out',
            '%{http_code}',
            'http://127.0.0.1:8080/compat',
        ],
        15_000,
    )
    trafficStatus = `${domain}:${status}`
    return status
}

async function verifyTraffic(base: UpgradeFixture, policy: PolicyFixture): Promise<void> {
    for (const domain of [base.hostDomain, base.aliasDomain]) {
        await waitFor(async () => (await http(domain)) === '200', `HTTP ${domain}`, 90_000)
        await command([
            'docker',
            'exec',
            container,
            'bun',
            '-e',
            `await Bun.write('/tmp/compat-ca.pem',${JSON.stringify(base.caPem)})`,
        ])
        const body = await command(
            [
                'docker',
                'exec',
                container,
                'curl',
                '--fail',
                '--silent',
                '--show-error',
                '--max-time',
                '5',
                '--noproxy',
                '*',
                '--cacert',
                '/tmp/compat-ca.pem',
                '--resolve',
                `${domain}:8443:127.0.0.1`,
                `https://${domain}:8443/compat`,
            ],
            15_000,
        )
        assert.equal(body, marker)
    }
    const redirect = await command([
        'docker',
        'exec',
        container,
        'curl',
        '--silent',
        '--show-error',
        '--max-time',
        '5',
        '--noproxy',
        '*',
        '--output',
        '/dev/null',
        '--write-out',
        '%{http_code}|%{redirect_url}',
        '--header',
        `Host: ${base.redirectDomain}`,
        'http://127.0.0.1:8080/compat',
    ])
    assert.equal(redirect, `${base.redirectStatus}|${base.redirectDestination}/compat`)
    await waitFor(
        async () => (await http(policy.basicDomain)) === '401',
        'Basic Auth guard',
        90_000,
    )
    assert.equal(await http(policy.basicDomain, `${policy.username}:wrong`), '401')
    assert.equal(await http(policy.basicDomain, `${policy.username}:${policy.password}`), '200')
    assert.equal(await http(policy.ipDomain), '200')
    const script = webSocketProbeScript({
        url: 'ws://127.0.0.1:8080/compat',
        headers: { Host: base.hostDomain },
        expectedMessage: marker,
    })
    assert.equal(
        await command(['docker', 'exec', container, 'bun', '-e', script], 20_000),
        'websocket-ok',
    )
}

async function verifyHttp3(base: UpgradeFixture): Promise<void> {
    const caFile = join(temporaryRoot, 'compat-ca.pem')
    await writeFile(caFile, base.caPem, { mode: 0o644 })
    const response = await requestHttp3Client(
        (args, options) => command(args, options?.timeoutMs),
        {
            image: http3Image,
            caFile,
            hostname: base.hostDomain,
            port: 8443,
            path: '/compat',
            network: `container:${container}`,
            address: '127.0.0.1',
        },
    )
    assertHttp3Response(response, 200, 443)
    assert.ok(response.output.includes(marker))
}

function changedSnapshotPaths(
    expected: unknown,
    actual: unknown,
    path = 'root',
    changed: string[] = [],
): string[] {
    if (changed.length >= 20 || isDeepStrictEqual(expected, actual)) return changed
    if (Array.isArray(expected) && Array.isArray(actual)) {
        for (let index = 0; index < Math.max(expected.length, actual.length); index += 1)
            changedSnapshotPaths(expected[index], actual[index], `${path}[${index}]`, changed)
    } else if (
        expected !== null &&
        actual !== null &&
        typeof expected === 'object' &&
        typeof actual === 'object'
    ) {
        const keys = new Set([...Object.keys(expected), ...Object.keys(actual)])
        for (const key of keys)
            changedSnapshotPaths(
                (expected as Record<string, unknown>)[key],
                (actual as Record<string, unknown>)[key],
                `${path}.${key}`,
                changed,
            )
    } else {
        changed.push(path)
    }
    return changed
}

async function verifyState(input: {
    readonly base: UpgradeFixture
    readonly auth: AuthFixture
    readonly backupState: BackupStateFixture
    readonly audit: AuditFixture
    readonly policy: PolicyFixture
    readonly durable: PersistenceFixture
    readonly durableSnapshot: PersistenceSnapshot
    readonly acmeAccount: AcmeAccountFixture
    readonly target: boolean
}): Promise<string> {
    const phase = input.target ? 'target' : 'source'
    stage = `${phase}-base-state`
    await assertUpgradeFixture({
        containerId: container,
        command,
        fixture: input.base,
        expectedMigrationCount: input.target ? CURRENT_MIGRATION_COUNT : sourceMigrationCount,
    })
    stage = `${phase}-auth-state`
    await assertAuthFixture({
        command,
        containerId: container,
        base: input.base,
        fixture: input.auth,
    })
    stage = `${phase}-audit-state`
    await assertAuditFixture({
        command,
        containerId: container,
        base: input.base,
        fixture: input.audit,
    })
    stage = `${phase}-policy-state`
    await assertPolicyFixture({
        command,
        containerId: container,
        fixture: input.policy,
    })
    stage = `${phase}-durable-state`
    try {
        await assertPersistenceFixture({
            command,
            containerId: container,
            fixture: input.durable,
            expected: input.durableSnapshot,
        })
    } catch (error) {
        const actual = await readPersistenceSnapshot({
            command,
            containerId: container,
            fixture: input.durable,
        })
        const changed = changedSnapshotPaths(input.durableSnapshot, actual)
        console.error(`durable_changed_fields=${changed.join(',') || 'unknown'}`)
        throw error
    }
    await assertPersistenceRequestDecrypts({
        command,
        containerId: container,
        fixture: input.durable,
    })
    stage = `${phase}-acme-account-state`
    await assertAcmeAccountFixture({
        command,
        containerId: container,
        fixture: input.acmeAccount,
    })
    stage = `${phase}-backup-state`
    await assertBackupState({ command, containerId: container, fixture: input.backupState })
    await assertBetaDefaults(command, container, true)
    stage = `${phase}-traffic`
    const backendStatus = await command(
        [
            'docker',
            'exec',
            container,
            'curl',
            '--silent',
            '--show-error',
            '--max-time',
            '5',
            '--noproxy',
            '*',
            '--output',
            '/dev/null',
            '--write-out',
            '%{http_code}',
            `http://host.docker.internal:${input.base.upstreamPort}/compat`,
        ],
        15_000,
    )
    trafficStatus = `direct-upstream:${backendStatus}`
    assert.equal(backendStatus, '200')
    await verifyTraffic(input.base, input.policy)
    stage = `${phase}-reconciliation`
    reconciliation = 'pending'
    let revision = ''
    await waitFor(
        async () => {
            revision = await activeRevision().catch(() => '')
            return revision !== ''
        },
        `${phase} runtime revision`,
        120_000,
    )
    return revision
}

async function run(): Promise<void> {
    temporaryRoot = await mkdtemp(join(tmpdir(), 'rp-compat-'))
    const targetFile = join(temporaryRoot, 'target.compose.json')
    const sourceFile = join(temporaryRoot, 'source.compose.json')
    stage = 'target-source'
    const targetSource = await prepareTargetSource(command, temporaryRoot)
    targetSourceRevision = targetSource.revision
    if (source) {
        const manifest = JSON.parse(
            await readFile(join(targetSource.context, 'package.json'), 'utf8'),
        ) as { version: string }
        const discovery = { token: discoveryToken, signal: AbortSignal.timeout(120_000) }
        await verifyCompatibilitySource(source, {
            releases: await discoverPublishedReleases(fetch, discovery),
            targetVersion: manifest.version,
            sourceRevision: (tag) => publishedSourceRevision(tag, targetSourceRevision),
            loadSource: (release) => loadPublishedSource(release, fetch, discovery),
            signal: discovery.signal,
        })
    }
    const upstreamPort = await freePort()
    backend = Bun.serve({
        hostname: '0.0.0.0',
        port: upstreamPort,
        fetch: (request, server) => {
            if (request.headers.get('upgrade')?.toLowerCase() === 'websocket') {
                if (server.upgrade(request, { data: {} })) return
                return new Response('WebSocket unavailable', { status: 503 })
            }
            return new Response(marker)
        },
        websocket: {
            open: (socket) => {
                socket.send(marker)
            },
            message: () => undefined,
        },
    })
    if (source) await writeFile(sourceFile, composeFile(source.image, upstreamPort))
    console.log(
        `source_version=${source?.version ?? 'fresh'} source_revision=${source?.revision ?? 'none'} source_image=${source?.image ?? 'none'} source_digest=${source?.digest ?? 'none'} target_sha=${targetSourceRevision} target_source=git-archive target_image_tag=${targetImage}`,
    )
    stage = 'target-build'
    await command(
        [
            'docker',
            'build',
            '--file',
            join(targetSource.context, 'docker/production/Dockerfile'),
            '--tag',
            targetImage,
            '--label',
            `org.opencontainers.image.revision=${targetSourceRevision}`,
            targetSource.context,
        ],
        1_800_000,
    )
    targetImageId = immutableImageId(
        await command(['docker', 'image', 'inspect', '--format', '{{.Id}}', targetImage]),
    )
    await writeFile(targetFile, composeFile(targetImageId, upstreamPort))
    console.log(
        `target_sha=${targetSourceRevision} target_source=git-archive target_image_id=${targetImageId}`,
    )
    if (source) {
        stage = 'http3-client-build'
        await buildHttp3Client((args, options) => command(args, options?.timeoutMs), http3Image)
    }
    if (source) {
        stage = 'source-pull'
        await command(['docker', 'pull', '--platform', 'linux/amd64', source.image], 900_000)
        const labels = JSON.parse(
            await command([
                'docker',
                'image',
                'inspect',
                '--format',
                '{{json .Config.Labels}}',
                source.image,
            ]),
        ) as Record<string, string>
        assert.equal(labels['org.opencontainers.image.version'], source.version)
        assert.equal(labels['org.opencontainers.image.revision'], source.revision)
        stage = 'source-startup'
        await start(sourceFile)
        sourceMigrationCount = await migrationCount()
        assert.ok(Number.isSafeInteger(sourceMigrationCount) && sourceMigrationCount > 0)
        console.log(`source_migration_count=${sourceMigrationCount}`)
        await assertBetaDefaults(command, container)
        stage = 'source-seed'
        const base = await seedUpgradeFixture({
            containerId: container,
            command,
            upstreamPort,
            runId,
            managementOrigin: 'https://management.compat.invalid',
        })
        const auth = await seedAuthFixture({ containerId: container, command, base })
        const policy = await seedPolicyFixture({
            containerId: container,
            command,
            runId,
            upstreamPort,
        })
        const audit = await seedAuditFixture({ command, containerId: container, base, runId })
        const backupState = await seedBackupState({ command, containerId: container, runId })
        stage = 'source-certificate-cursor'
        await waitForCertificateCursor()
        const durable = await seedPersistenceFixture({
            containerId: container,
            command,
            runId,
            withDnsCredential: true,
            withCandidate: true,
        })
        const acmeAccount = await seedAcmeAccountFixture({ command, containerId: container })
        const durableSnapshot = await readPersistenceSnapshot({
            containerId: container,
            command,
            fixture: durable,
        })
        stage = 'source-validation'
        const sourceFixture = { base, auth, policy, audit, backupState, durable, acmeAccount }
        await verifyState({ ...sourceFixture, durableSnapshot, target: false })
        const backupRoot = join(temporaryRoot, 'release-backup')
        stage = 'pre-upgrade-backup'
        const backupPath = await createPinnedSourceBackup(backupRoot)
        await start(sourceFile)
        const preUpgradeDurableSnapshot = await readPersistenceSnapshot({
            containerId: container,
            command,
            fixture: durable,
        })
        assert.ok(preUpgradeDurableSnapshot.certificate)
        assert.ok(preUpgradeDurableSnapshot.job)
        assert.equal(
            Array.isArray(preUpgradeDurableSnapshot.eventReceipts)
                ? preUpgradeDurableSnapshot.eventReceipts.length
                : 0,
            2,
        )
        const fixture = { ...sourceFixture, durableSnapshot: preUpgradeDurableSnapshot }
        const sourceRevision = await verifyState({ ...fixture, target: false })
        const originalAppKeyDigest = await appKeyDigest()
        await command([...compose(sourceFile), 'down', '--remove-orphans'], 180_000)
        stage = 'target-upgrade'
        await start(targetFile)
        assert.equal(await migrationCount(), CURRENT_MIGRATION_COUNT)
        stage = 'target-validation'
        const targetRevision = await verifyState({ ...fixture, target: true })
        assert.equal(targetRevision, sourceRevision)
        assert.equal(await appKeyDigest(), originalAppKeyDigest)
        stage = 'target-login'
        await verifyLogin(base, 1)
        stage = 'target-http3'
        await verifyHttp3(base)
        console.log(`PASS ${source.version} direct upgrade preserves durable state and traffic`)
        stage = 'target-restart'
        await command([...compose(targetFile), 'restart', 'rentnerproxy'], 180_000)
        await start(targetFile)
        const restartedRevision = await verifyState({ ...fixture, target: true })
        assert.equal(await appKeyDigest(), originalAppKeyDigest)
        assert.equal(restartedRevision, targetRevision)
        const sessions = await psql(
            command,
            container,
            `select count(*) from rentnerproxy.sessions where user_id='${base.ownerUserId}'`,
        )
        assert.equal(Number(sessions), 1)
        stage = 'target-restart-http3'
        await verifyHttp3(base)
        await assertErasedJournalFailsClosed(targetFile, base)
        console.log(`PASS ${source.version} restart remains idempotent`)

        stage = 'target-fresh-volume-restore'
        await command([...compose(targetFile), 'down', '--volumes', '--remove-orphans'], 180_000)
        await restoreCurrentTargetBackup(backupPath, targetFile)
        await start(targetFile)
        assert.equal(await migrationCount(), CURRENT_MIGRATION_COUNT)
        const restoredRevision = await verifyState({ ...fixture, target: true })
        assert.equal(restoredRevision, sourceRevision)
        assert.equal(await appKeyDigest(), originalAppKeyDigest)
        await verifyLogin(base, 1)
        await verifyHttp3(base)
        console.log(`PASS ${source.version} release backup restores into fresh current volumes`)

        stage = 'source-fresh-volume-rollback'
        await command([...compose(targetFile), 'down', '--volumes', '--remove-orphans'], 180_000)
        await restorePinnedSourceBackup(backupPath, sourceFile)
        await start(sourceFile)
        assert.equal(await migrationCount(), sourceMigrationCount)
        const rollbackRevision = await verifyState({ ...fixture, target: false })
        assert.equal(rollbackRevision, sourceRevision)
        assert.equal(await appKeyDigest(), originalAppKeyDigest)
        await verifyLogin(base, 1)
        await verifyHttp3(base)
        console.log(
            `PASS ${source.version} release backup restores into fresh exact-source volumes`,
        )
    } else {
        stage = 'fresh-startup'
        await start(targetFile)
        assert.equal(await migrationCount(), CURRENT_MIGRATION_COUNT)
        await assertBetaDefaults(command, container)
        await assertFreshExternalDefaults(command, container)
        await waitFor(
            async () => Boolean(await activeRevision().catch(() => '')),
            'fresh runtime revision',
            120_000,
        )
        stage = 'fresh-restart'
        await command([...compose(targetFile), 'restart', 'rentnerproxy'], 180_000)
        await start(targetFile)
        assert.equal(await migrationCount(), CURRENT_MIGRATION_COUNT)
        await assertBetaDefaults(command, container)
        await assertFreshExternalDefaults(command, container)
        await waitFor(
            async () => Boolean(await activeRevision().catch(() => '')),
            'fresh runtime revision after restart',
            120_000,
        )
        console.log('PASS fresh target installation and restart')
    }
}

try {
    await run()
} catch (error) {
    // Diagnostics are intentionally structural; raw command output can contain credentials.
    const location =
        error instanceof Error
            ? (/(?:\.github\/scripts|scripts|tests)\/[^\s()]+:\d+:\d+/u.exec(
                  error.stack?.replaceAll('\\', '/') ?? '',
              )?.[0] ?? 'unknown')
            : 'unknown'
    const category =
        error instanceof Error &&
        /^command failed: (?:docker|git)|^timed out:|^compatibility test requires a clean committed checkout$/u.test(
            error.message,
        )
            ? error.message
            : error instanceof Error
              ? error.name
              : 'unknown'
    console.error(
        `FAIL source_version=${source?.version ?? 'fresh'} source_revision=${source?.revision ?? 'none'} source_digest=${source?.digest ?? 'none'} target_sha=${targetSourceRevision} target_image_id=${targetImageId} target_image_tag=${targetImage} stage=${stage} migration_status=${migrationStatus} health=${health} runtime_reconciliation=${reconciliation} traffic_status=${trafficStatus} category=${category} location=${location}`,
    )
    process.exitCode = 1
} finally {
    if (temporaryRoot) {
        const targetFile = join(temporaryRoot, 'target.compose.json')
        await command(
            [...compose(targetFile), 'down', '--volumes', '--remove-orphans'],
            180_000,
        ).catch(() => undefined)
        await rm(temporaryRoot, { recursive: true, force: true })
    }
    backend?.stop(true)
    await command(['docker', 'image', 'rm', targetImage], 180_000).catch(() => undefined)
    if (source) await command(['docker', 'image', 'rm', http3Image], 180_000).catch(() => undefined)
}
