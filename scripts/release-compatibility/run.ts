// oxlint-disable no-await-in-loop -- Appliance phases and bounded readiness probes run in order.
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

import {
    CURRENT_MIGRATION_COUNT,
    assertAlpha1UpgradeFixture,
    seedAlpha1UpgradeFixture,
    type Alpha1UpgradeFixture,
} from '../alpha1-upgrade-fixture'
import {
    assertAlpha4PersistenceFixture,
    assertAlpha4PersistenceRequestDecrypts,
    readAlpha4PersistenceSnapshot,
    seedAlpha4PersistenceFixture,
    type Alpha4PersistenceFixture,
    type Alpha4PersistenceSnapshot,
} from '../alpha4-persistence-fixture'
import { psql } from '../alpha4-persistence/storage'
import { assertHttp3Response, buildHttp3Client, requestHttp3Client } from '../http3-client'
import { smokeCompose, smokeDockerArguments } from '../smoke-resources'
import { PUBLISHED_ALPHAS, publishedAlpha, type PublishedAlphaKey } from './published-alphas'
import { assertAuthFixture, seedAuthFixture, type AuthFixture } from './auth-state'
import { assertAuditFixture, seedAuditFixture, type AuditFixture } from './audit-state'
import {
    assertAcmeAccountFixture,
    seedAcmeAccountFixture,
    type AcmeAccountFixture,
} from './acme-account-state'
import {
    assertBetaDefaults,
    assertPolicyFixture,
    seedPolicyFixture,
    type PolicyFixture,
} from './state'

const root = fileURLToPath(new URL('../..', import.meta.url))
const sourceKey = process.argv[2]
if (!sourceKey || (sourceKey !== 'fresh' && !(sourceKey in PUBLISHED_ALPHAS))) {
    throw new Error('Choose fresh or alpha.1 through alpha.6.')
}
const source = sourceKey === 'fresh' ? null : publishedAlpha(sourceKey as PublishedAlphaKey)
const runId = randomUUID().replaceAll('-', '').slice(0, 12)
const project = `rp-compat-${runId}`
const targetImage = `rentnerproxy:compat-${runId}`
const http3Image = `rentnerproxy:compat-http3-${runId}`
const marker = `release-compatibility-${runId}`
let stage = 'prepare'
let container = ''
let health = 'not-started'
let migrationStatus = 'not-started'
let reconciliation = 'not-started'
let trafficStatus = 'not-started'
let temporaryRoot = ''
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
    const child = Bun.spawn({
        cmd: smokeDockerArguments(args),
        cwd: root,
        env: { ...environment, ...extraEnvironment },
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
    })
    const timer = setTimeout(() => child.kill(), timeoutMs)
    try {
        const [code, out, err] = await Promise.all([
            child.exited,
            new Response(child.stdout).text(),
            new Response(child.stderr).text(),
        ])
        if (code !== 0) {
            // Docker, SQL and application output can contain private fixture material.
            void err
            throw new Error(`command failed: ${args[0]} ${args[1] ?? ''} (exit ${code})`)
        }
        // docker logs keeps the container's stdout and stderr in separate streams.
        return (args[0] === 'docker' && args[1] === 'logs' ? out + err : out || err).trim()
    } finally {
        clearTimeout(timer)
    }
}

async function waitFor(
    check: () => Promise<boolean>,
    label: string,
    timeoutMs = 240_000,
): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        if (await check().catch(() => false)) return
        await Bun.sleep(750)
    }
    throw new Error(`timed out: ${label}`)
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

async function assertSourceSchema(): Promise<void> {
    if (!source) throw new Error('source image missing')
    const output = await psql(
        command,
        container,
        `select row_to_json(t) from (select
        (select count(distinct table_name) from information_schema.columns where table_schema='rentnerproxy') as tables,
        (select coalesce(json_agg(table_name || ':' || column_name || ':' || data_type order by table_name,column_name),'[]'::json) from information_schema.columns where table_schema='rentnerproxy') as columns,
        (to_regclass('rentnerproxy.access_policies') is not null) as access_policies,
        (to_regclass('rentnerproxy.access_policy_basic_auth_accounts') is not null) as basic_auth,
        (exists(select 1 from information_schema.columns where table_schema='rentnerproxy' and table_name='access_policies' and column_name='ip_rules')) as ip_rules,
        (exists(select 1 from information_schema.columns where table_schema='rentnerproxy' and table_name='certificates' and column_name='candidate')) as certificate_candidates,
        (exists(select 1 from information_schema.columns where table_schema='rentnerproxy' and table_name='certificates' and column_name='current_operation')) as durable_certificate_operations,
        (to_regclass('rentnerproxy.certificate_binding_jobs') is not null) as certificate_binding_jobs,
        (to_regclass('rentnerproxy.audit_events') is not null) as audit_events
    ) t`,
    )
    const schema = JSON.parse(output) as Record<string, unknown>
    assert.equal(schema.access_policies, source.capabilities.accessPolicies)
    assert.equal(schema.basic_auth, source.capabilities.basicAuth)
    assert.equal(schema.ip_rules, source.capabilities.ipRules)
    assert.equal(schema.certificate_candidates, source.capabilities.certificateCandidates)
    assert.equal(
        schema.durable_certificate_operations,
        source.capabilities.durableCertificateOperations,
    )
    assert.equal(schema.certificate_binding_jobs, source.capabilities.certificateBindingJobs)
    assert.equal(schema.audit_events, source.capabilities.auditEvents)
    const hash = createHash('sha256').update(JSON.stringify(schema.columns)).digest('hex')
    console.log(`source_schema_tables=${schema.tables} source_schema_sha256=${hash}`)
    assert.equal(Number(schema.tables), source.schemaTables)
    assert.equal(hash, source.schemaSha256)
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

async function verifyLogin(base: Alpha1UpgradeFixture, expectedSessions: number): Promise<void> {
    const script = [
        "let status=0;let diagnostic='unknown';",
        'try {',
        "const {toJSONAsync}=await import('/opt/rentnerproxy/web/node_modules/seroval/dist/index.js');",
        "const manifest=await Bun.file('/opt/rentnerproxy/web/web/dist/server/server.js').text();",
        'const id=/"([0-9a-f]{64})":\\s*\\{\\s*functionName: "loginHandler_createServerFn_handler"/.exec(manifest)?.[1];',
        "if(!id){diagnostic='manifest-id-missing'}else{",
        `const body=JSON.stringify(await toJSONAsync({data:{email:${JSON.stringify(`owner-${base.runId}@alpha1.invalid`)},password:${JSON.stringify('alpha1-upgrade-fixture-password')}}}));`,
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

async function assertCorruptJournalFailsClosed(
    file: string,
    fixture: Alpha1UpgradeFixture,
): Promise<void> {
    stage = 'failure-injection'
    await psql(
        command,
        container,
        'delete from drizzle.__drizzle_migrations where id=(select max(id) from drizzle.__drizzle_migrations)',
    )
    assert.equal(await migrationCount(), CURRENT_MIGRATION_COUNT - 1)
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
        'damaged migration journal must stop startup',
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
    assert.equal(logs.includes('alpha1-upgrade-fixture-password'), false)
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

async function verifyTraffic(
    base: Alpha1UpgradeFixture,
    policy: PolicyFixture | undefined,
    websocket: boolean,
): Promise<void> {
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
    if (policy) {
        await waitFor(
            async () => (await http(policy.basicDomain)) === '401',
            'Basic Auth guard',
            90_000,
        )
        assert.equal(await http(policy.basicDomain, `${policy.username}:wrong`), '401')
        assert.equal(await http(policy.basicDomain, `${policy.username}:${policy.password}`), '200')
        assert.equal(await http(policy.ipDomain), '200')
    }
    if (websocket) {
        const script = [
            `const socket=new WebSocket('ws://127.0.0.1:8080/compat',{headers:{Host:${JSON.stringify(base.hostDomain)}}});`,
            'const timer=setTimeout(()=>process.exit(1),10000);',
            `socket.onmessage=(event)=>{if(event.data!==${JSON.stringify(marker)})process.exit(1);socket.close();};`,
            "socket.onclose=()=>{clearTimeout(timer);process.stdout.write('websocket-ok');};",
            'socket.onerror=()=>process.exit(1);',
        ].join('')
        assert.equal(
            await command(['docker', 'exec', container, 'bun', '-e', script], 20_000),
            'websocket-ok',
        )
    }
}

async function verifyHttp3(base: Alpha1UpgradeFixture): Promise<void> {
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
    readonly base: Alpha1UpgradeFixture
    readonly auth: AuthFixture
    readonly audit?: AuditFixture
    readonly policy?: PolicyFixture
    readonly durable?: Alpha4PersistenceFixture
    readonly durableSnapshot?: Alpha4PersistenceSnapshot
    readonly acmeAccount?: AcmeAccountFixture
    readonly target: boolean
}): Promise<string> {
    const phase = input.target ? 'target' : 'source'
    stage = `${phase}-base-state`
    await assertAlpha1UpgradeFixture({
        containerId: container,
        command,
        fixture: input.base,
        expectAlpha2: input.target,
        expectedMigrationCount: input.target ? CURRENT_MIGRATION_COUNT : source!.migrationCount,
    })
    stage = `${phase}-auth-state`
    await assertAuthFixture({
        command,
        containerId: container,
        base: input.base,
        fixture: input.auth,
    })
    stage = `${phase}-audit-state`
    if (input.audit)
        await assertAuditFixture({
            command,
            containerId: container,
            base: input.base,
            fixture: input.audit,
        })
    stage = `${phase}-policy-state`
    if (input.policy)
        await assertPolicyFixture({
            command,
            containerId: container,
            fixture: input.policy,
            target: input.target,
        })
    stage = `${phase}-durable-state`
    if (input.durable && input.durableSnapshot) {
        try {
            await assertAlpha4PersistenceFixture({
                command,
                containerId: container,
                fixture: input.durable,
                expected: input.durableSnapshot,
            })
        } catch (error) {
            const actual = await readAlpha4PersistenceSnapshot({
                command,
                containerId: container,
                fixture: input.durable,
            })
            const changed = changedSnapshotPaths(input.durableSnapshot, actual)
            console.error(`durable_changed_fields=${changed.join(',') || 'unknown'}`)
            throw error
        }
        await assertAlpha4PersistenceRequestDecrypts({
            command,
            containerId: container,
            fixture: input.durable,
        })
    }
    stage = `${phase}-acme-account-state`
    if (input.acmeAccount)
        await assertAcmeAccountFixture({
            command,
            containerId: container,
            fixture: input.acmeAccount,
        })
    stage = `${phase}-beta-defaults`
    if (input.target) await assertBetaDefaults(command, container)
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
    await verifyTraffic(input.base, input.policy, input.target)
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
    await writeFile(targetFile, composeFile(targetImage, upstreamPort))
    if (source) await writeFile(sourceFile, composeFile(source.image, upstreamPort))
    const targetSha = await command(['git', 'rev-parse', 'HEAD'])
    console.log(
        `source_version=${source?.version ?? 'fresh'} source_image=${source?.image ?? 'none'} source_digest=${source?.digest ?? 'none'} target_sha=${targetSha} target_image=${targetImage}`,
    )
    stage = 'target-build'
    await command(
        ['docker', 'build', '--file', 'docker/production/Dockerfile', '--tag', targetImage, '.'],
        1_800_000,
    )
    if (source?.version === 'v1.0.0-alpha.6') {
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
        assert.equal(await migrationCount(), source.migrationCount)
        await assertSourceSchema()
        stage = 'source-seed'
        const base = await seedAlpha1UpgradeFixture({
            containerId: container,
            command,
            upstreamPort,
            runId,
            managementOrigin: 'https://management.compat.invalid',
        })
        const auth = await seedAuthFixture({ containerId: container, command, base })
        const policy = source.capabilities.accessPolicies
            ? await seedPolicyFixture({ containerId: container, command, runId, upstreamPort })
            : undefined
        const audit = source.capabilities.auditEvents
            ? await seedAuditFixture({ command, containerId: container, base, runId })
            : undefined
        if (source.capabilities.certificateBindingJobs) {
            stage = 'source-certificate-cursor'
            await waitForCertificateCursor()
        }
        const durable = source.capabilities.certificateBindingJobs
            ? await seedAlpha4PersistenceFixture({
                  containerId: container,
                  command,
                  runId,
                  withDnsCredential: true,
                  withCandidate: true,
              })
            : undefined
        const acmeAccount = source.capabilities.durableCertificateOperations
            ? await seedAcmeAccountFixture({ command, containerId: container })
            : undefined
        const durableSnapshot = durable
            ? await readAlpha4PersistenceSnapshot({
                  containerId: container,
                  command,
                  fixture: durable,
              })
            : undefined
        stage = 'source-validation'
        let sourceRevision = await verifyState({
            base,
            auth,
            ...(audit ? { audit } : {}),
            ...(policy ? { policy } : {}),
            ...(durable && durableSnapshot ? { durable, durableSnapshot } : {}),
            ...(acmeAccount ? { acmeAccount } : {}),
            target: false,
        })
        let preUpgradeDurableSnapshot = durableSnapshot
        if (source.version === 'v1.0.0-alpha.6') {
            stage = 'pre-upgrade-backup'
            const backupRoot = join(temporaryRoot, 'backup')
            await command(
                [
                    process.execPath,
                    'scripts/production-backup.ts',
                    '--project',
                    project,
                    '--output',
                    backupRoot,
                ],
                900_000,
                { RENTNERPROXY_COMPOSE_FILE: sourceFile },
            )
            assert.equal((await readdir(backupRoot)).length, 1)
            await start(sourceFile)
            if (durable) {
                preUpgradeDurableSnapshot = await readAlpha4PersistenceSnapshot({
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
            }
            sourceRevision = await verifyState({
                base,
                auth,
                ...(audit ? { audit } : {}),
                ...(policy ? { policy } : {}),
                ...(durable && preUpgradeDurableSnapshot
                    ? { durable, durableSnapshot: preUpgradeDurableSnapshot }
                    : {}),
                ...(acmeAccount ? { acmeAccount } : {}),
                target: false,
            })
        }
        const originalAppKeyDigest = await appKeyDigest()
        await command([...compose(sourceFile), 'down', '--remove-orphans'], 180_000)
        stage = 'target-upgrade'
        await start(targetFile)
        assert.equal(await migrationCount(), CURRENT_MIGRATION_COUNT)
        stage = 'target-validation'
        const targetRevision = await verifyState({
            base,
            auth,
            ...(audit ? { audit } : {}),
            ...(policy ? { policy } : {}),
            ...(durable && preUpgradeDurableSnapshot
                ? { durable, durableSnapshot: preUpgradeDurableSnapshot }
                : {}),
            ...(acmeAccount ? { acmeAccount } : {}),
            target: true,
        })
        assert.equal(targetRevision, sourceRevision)
        assert.equal(await appKeyDigest(), originalAppKeyDigest)
        stage = 'target-login'
        await verifyLogin(base, 1)
        if (source.version === 'v1.0.0-alpha.6') {
            stage = 'target-http3'
            await verifyHttp3(base)
        }
        console.log(`PASS ${source.version} direct upgrade preserves durable state and traffic`)
        stage = 'target-restart'
        await command([...compose(targetFile), 'restart', 'rentnerproxy'], 180_000)
        await start(targetFile)
        const restartedRevision = await verifyState({
            base,
            auth,
            ...(audit ? { audit } : {}),
            ...(policy ? { policy } : {}),
            ...(durable && preUpgradeDurableSnapshot
                ? { durable, durableSnapshot: preUpgradeDurableSnapshot }
                : {}),
            ...(acmeAccount ? { acmeAccount } : {}),
            target: true,
        })
        assert.equal(await appKeyDigest(), originalAppKeyDigest)
        assert.equal(restartedRevision, targetRevision)
        const sessions = await psql(
            command,
            container,
            `select count(*) from rentnerproxy.sessions where user_id='${base.ownerUserId}'`,
        )
        assert.equal(Number(sessions), 1)
        if (source.version === 'v1.0.0-alpha.6') {
            stage = 'target-restart-http3'
            await verifyHttp3(base)
        }
        console.log(`PASS ${source.version} restart remains idempotent`)
        if (source.version === 'v1.0.0-alpha.6')
            await assertCorruptJournalFailsClosed(targetFile, base)
    } else {
        stage = 'fresh-startup'
        await start(targetFile)
        assert.equal(await migrationCount(), CURRENT_MIGRATION_COUNT)
        await assertBetaDefaults(command, container)
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
            ? (/(?:scripts|tests)\/[^\s()]+:\d+:\d+/u.exec(error.stack ?? '')?.[0] ?? 'unknown')
            : 'unknown'
    const category =
        error instanceof Error && /^command failed: (?:docker|git)|^timed out:/u.test(error.message)
            ? error.message
            : error instanceof Error
              ? error.name
              : 'unknown'
    console.error(
        `FAIL source_version=${source?.version ?? 'fresh'} source_digest=${source?.digest ?? 'none'} target_image=${targetImage} stage=${stage} migration_status=${migrationStatus} health=${health} runtime_reconciliation=${reconciliation} traffic_status=${trafficStatus} category=${category} location=${location}`,
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
    if (source?.version === 'v1.0.0-alpha.6')
        await command(['docker', 'image', 'rm', http3Image], 180_000).catch(() => undefined)
}
