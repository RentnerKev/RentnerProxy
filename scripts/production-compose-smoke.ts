import assert from 'node:assert/strict'
// oxlint-disable no-await-in-loop -- Compose readiness and recovery checks require ordered polling.

import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const composeFile = join(repositoryRoot, 'compose.production.yml')
const runId = randomUUID().replaceAll('-', '').slice(0, 12)
const project = 'rentnerproxy-production-smoke-' + runId
const databasePassword = randomBytes(24).toString('hex')
const controllerToken = randomBytes(32).toString('hex')
const smtpPassword = randomBytes(24).toString('hex')
const environment: NodeJS.ProcessEnv = {
    ...process.env,
    APP_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    APP_URL: 'https://localhost',
    DATABASE_URL: 'postgresql://rentnerproxy:' + databasePassword + '@postgres:5432/rentnerproxy',
    POSTGRES_DB: 'rentnerproxy',
    POSTGRES_PASSWORD: databasePassword,
    POSTGRES_USER: 'rentnerproxy',
    RENTNERPROXY_CONTROLLER_TOKEN: controllerToken,
    RENTNERPROXY_MANAGEMENT_BIND_ADDRESS: '127.0.0.1',
    RENTNERPROXY_MANAGEMENT_PORT: '0',
    RENTNERPROXY_PROXY_HTTP_BIND_ADDRESS: '127.0.0.1',
    RENTNERPROXY_PROXY_HTTP_HOST_PORT: '0',
    RENTNERPROXY_PROXY_HTTPS_BIND_ADDRESS: '127.0.0.1',
    RENTNERPROXY_PROXY_HTTPS_HOST_PORT: '0',
    RENTNERPROXY_PROXY_PUBLIC_HTTPS_PORT: '443',
    RENTNERPROXY_TRUST_PROXY_HEADERS: 'false',
    RUST_LOG: 'warn',
    SMTP_FROM: 'production-smoke@localhost.invalid',
    SMTP_HOST: 'smtp.localhost.invalid',
    SMTP_PASSWORD: smtpPassword,
    SMTP_PORT: '587',
    SMTP_SECURE: 'false',
    SMTP_USER: 'production-smoke',
    WEBAUTHN_RP_ID: 'localhost',
}
const compose = ['docker', 'compose', '--project-name', project, '--file', composeFile]
let assertions = 0

async function availableLoopbackPort(): Promise<number> {
    return new Promise((resolvePort, reject) => {
        const server = createServer()
        server.unref()
        server.once('error', reject)
        server.listen(0, '127.0.0.1', () => {
            const address = server.address()
            if (!address || typeof address === 'string') {
                server.close()
                reject(new Error('failed to allocate a loopback port'))
                return
            }
            const port = address.port
            server.close((error) => {
                if (error) reject(error)
                else resolvePort(port)
            })
        })
    })
}

async function command(
    argumentsList: string[],
    options: {
        readonly env?: NodeJS.ProcessEnv
        readonly inherit?: boolean
        readonly timeoutMs?: number
    } = {},
): Promise<string> {
    const child = Bun.spawn({
        cmd: argumentsList,
        cwd: repositoryRoot,
        env: options.env ?? environment,
        stdin: 'ignore',
        stdout: options.inherit ? 'inherit' : 'pipe',
        stderr: options.inherit ? 'inherit' : 'pipe',
    })
    const timer = setTimeout(() => child.kill(), options.timeoutMs ?? 120_000)
    const stdout =
        child.stdout && typeof child.stdout !== 'number'
            ? new Response(child.stdout).text()
            : Promise.resolve('')
    const stderr =
        child.stderr && typeof child.stderr !== 'number'
            ? new Response(child.stderr).text()
            : Promise.resolve('')

    try {
        const [exitCode, output, errors] = await Promise.all([child.exited, stdout, stderr])
        if (exitCode !== 0) {
            const detail = errors.trim().split(/\r?\n/u).at(-1)
            throw new Error(detail ? 'smoke command failed: ' + detail : 'smoke command failed')
        }
        return (output || errors).trim()
    } finally {
        clearTimeout(timer)
    }
}

async function commandFails(
    argumentsList: string[],
    env: NodeJS.ProcessEnv = environment,
    timeoutMs = 120_000,
): Promise<boolean> {
    try {
        await command(argumentsList, { env, timeoutMs })
        return false
    } catch {
        return true
    }
}

async function portIsUnpublished(service: string, containerPort: number): Promise<boolean> {
    const id = await command([...compose, 'ps', '--all', '--quiet', service])
    assert.ok(id, service + ' container is missing')
    const value = await command([
        'docker',
        'inspect',
        '--format',
        '{{json .HostConfig.PortBindings}}',
        id,
    ])
    const bindings = JSON.parse(value) as Record<string, unknown> | null
    return !bindings || bindings[containerPort + '/tcp'] == null
}

async function attachedNetworks(service: string): Promise<string[]> {
    const id = await command([...compose, 'ps', '--all', '--quiet', service])
    assert.ok(id, service + ' container is missing')
    const value = await command([
        'docker',
        'inspect',
        '--format',
        '{{json .NetworkSettings.Networks}}',
        id,
    ])
    return Object.keys(JSON.parse(value) as Record<string, unknown>).toSorted()
}

async function waitFor(
    check: () => Promise<boolean>,
    label: string,
    timeoutMs = 120_000,
): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        try {
            if (await check()) return
        } catch {
            // Compose services can be between create, start, and health transitions.
        }
        await Bun.sleep(500)
    }
    throw new Error('timed out waiting for ' + label)
}

function passed(label: string): void {
    assertions += 1
    console.log('PASS ' + label)
}

async function containerHealth(service: string): Promise<string> {
    const id = await command([...compose, 'ps', '--all', '--quiet', service])
    if (!id) return 'missing'
    return command([
        'docker',
        'inspect',
        '--format',
        '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}|{{.State.ExitCode}}',
        id,
    ])
}

async function waitForHealthy(service: string): Promise<void> {
    await waitFor(
        async () => (await containerHealth(service)).includes('|healthy|'),
        service + ' healthy',
    )
}

async function waitForSuccessfulMigration(): Promise<void> {
    await waitFor(async () => {
        const state = await containerHealth('migrate')
        return state.startsWith('exited|') && state.endsWith('|0')
    }, 'successful migration')
}

async function publishedPort(service: string, containerPort: number): Promise<number> {
    const value = await command([...compose, 'port', service, String(containerPort)])
    const match = /:(\d+)$/u.exec(value)
    assert.ok(match, service + ' published port was not returned')
    const port = Number(match[1])
    assert.ok(port > 0 && port <= 65_535)
    return port
}

async function assertAdminHeaders(response: Response): Promise<void> {
    const csp = response.headers.get('content-security-policy') ?? ''
    assert.match(csp, /frame-ancestors 'none'/u)
    assert.doesNotMatch(csp, /unsafe-eval/u)
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
    assert.equal(response.headers.get('x-frame-options'), 'DENY')
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer')
    assert.ok(response.headers.get('permissions-policy'))
}

async function healthRequest(url: string): Promise<Response> {
    return fetch(url, { signal: AbortSignal.timeout(5_000) })
}

async function postgresQuery(sql: string): Promise<string> {
    return command([
        ...compose,
        'exec',
        '-T',
        'postgres',
        'psql',
        '--username=rentnerproxy',
        '--dbname=rentnerproxy',
        '--set=ON_ERROR_STOP=1',
        '--tuples-only',
        '--no-align',
        '--command',
        sql,
    ])
}

async function runSmoke(): Promise<void> {
    const [reservedManagementPort, reservedProxyHttpPort, reservedProxyHttpsPort] =
        await Promise.all([
            availableLoopbackPort(),
            availableLoopbackPort(),
            availableLoopbackPort(),
        ])
    environment.RENTNERPROXY_MANAGEMENT_PORT = String(reservedManagementPort)
    environment.RENTNERPROXY_PROXY_HTTP_HOST_PORT = String(reservedProxyHttpPort)
    environment.RENTNERPROXY_PROXY_HTTPS_HOST_PORT = String(reservedProxyHttpsPort)
    await command([...compose, 'config', '--quiet'])
    passed('production Compose config renders with required secrets')

    const missingTokenEnvironment = { ...environment }
    missingTokenEnvironment.RENTNERPROXY_CONTROLLER_TOKEN = ''
    assert.equal(
        await commandFails([...compose, 'config', '--quiet'], missingTokenEnvironment),
        true,
    )
    passed('missing production controller token fails Compose validation')

    await command([...compose, 'up', '--build', '--detach'], {
        inherit: true,
        timeoutMs: 900_000,
    })
    await Promise.all([
        waitForHealthy('postgres'),
        waitForHealthy('redis'),
        waitForHealthy('proxy-runtime'),
        waitForSuccessfulMigration(),
    ])
    await waitForHealthy('web')
    passed('production services started with healthy dependencies and migration')

    assert.notEqual(await command([...compose, 'exec', '-T', 'web', 'id', '-u']), '0')
    assert.notEqual(await command([...compose, 'exec', '-T', 'proxy-runtime', 'id', '-u']), '0')
    await command([...compose, 'exec', '-T', 'web', 'sh', '-c', 'test ! -e /app/.env'])
    await command([
        ...compose,
        'exec',
        '-T',
        'web',
        'bun',
        '-e',
        'import { existsSync } from "node:fs"; const manifest = await Bun.file("/app/package.json").json(); for (const name of Object.keys(manifest.devDependencies ?? {})) { if (existsSync("/app/node_modules/" + name)) process.exit(1); }',
    ])
    await command([
        ...compose,
        'exec',
        '-T',
        'web',
        'bun',
        '-e',
        'const secrets = [process.env.APP_ENCRYPTION_KEY, process.env.DATABASE_URL, process.env.RENTNERPROXY_CONTROLLER_TOKEN, process.env.SMTP_PASSWORD].filter(Boolean); for await (const path of new Bun.Glob("**/*").scan({ cwd: "/app", absolute: true, onlyFiles: true })) { const file = Bun.file(path); if (file.size > 25000000) continue; const contents = await file.text().catch(() => ""); if (secrets.some((secret) => contents.includes(secret)) || contents.includes("-----BEGIN PRIVATE KEY-----") || contents.includes("-----BEGIN RSA PRIVATE KEY-----")) process.exit(1); }',
    ])
    const webId = await command([...compose, 'ps', '--quiet', 'web'])
    const webImage = await command(['docker', 'inspect', '--format', '{{.Image}}', webId])
    const webImageHistory = await command([
        'docker',
        'history',
        '--no-trunc',
        '--format',
        '{{.CreatedBy}}',
        webImage,
    ])
    for (const secret of [
        databasePassword,
        controllerToken,
        smtpPassword,
        environment.APP_ENCRYPTION_KEY!,
    ]) {
        assert.equal(webImageHistory.includes(secret), false)
    }
    const proxyId = await command([...compose, 'ps', '--quiet', 'proxy-runtime'])
    const proxySecurity = await command([
        'docker',
        'inspect',
        '--format',
        '{{json .HostConfig.CapDrop}}|{{json .HostConfig.SecurityOpt}}',
        proxyId,
    ])
    assert.match(proxySecurity, /"ALL"/iu)
    assert.match(proxySecurity, /no-new-privileges:true/iu)
    passed('runtime images are non-root, hardened, secret-free, and production-only')

    const managementPort = await publishedPort('web', 3000)
    const proxyHttpPort = await publishedPort('proxy-runtime', 8080)
    const proxyHttpsPort = await publishedPort('proxy-runtime', 8443)
    const managementUrl = 'http://127.0.0.1:' + managementPort

    const live = await healthRequest(managementUrl + '/health/live')
    assert.equal(live.status, 200)
    assert.deepEqual(await live.json(), { status: 'ok' })
    await assertAdminHeaders(live)
    assert.equal(live.headers.get('strict-transport-security'), null)
    const forgedHttpsLive = await fetch(managementUrl + '/health/live', {
        headers: { 'x-forwarded-proto': 'https' },
        signal: AbortSignal.timeout(5_000),
    })
    assert.equal(forgedHttpsLive.headers.get('strict-transport-security'), null)
    await forgedHttpsLive.body?.cancel()
    passed('Web liveness is dependency-free and has safe HTTP headers')

    const trustedProxyPort = await availableLoopbackPort()
    const trustedProxyContainer = project + '-trusted-proxy-web'
    try {
        await command([
            ...compose,
            'run',
            '--detach',
            '--no-deps',
            '--name',
            trustedProxyContainer,
            '--publish',
            '127.0.0.1:' + trustedProxyPort + ':3000',
            '--env',
            'RENTNERPROXY_TRUST_PROXY_HEADERS=true',
            'web',
        ])
        await waitFor(async () => {
            const response = await fetch('http://127.0.0.1:' + trustedProxyPort + '/health/live', {
                headers: { 'x-forwarded-proto': 'https' },
                signal: AbortSignal.timeout(5_000),
            })
            const ready =
                response.status === 200 &&
                response.headers.get('strict-transport-security') === 'max-age=31536000'
            await response.body?.cancel()
            return ready
        }, 'trusted HTTPS proxy response')
        const trustedPlainHttp = await healthRequest(
            'http://127.0.0.1:' + trustedProxyPort + '/health/live',
        )
        assert.equal(trustedPlainHttp.headers.get('strict-transport-security'), null)
        await trustedPlainHttp.body?.cancel()
        passed('HSTS requires trusted external HTTPS semantics on an actual response')
    } finally {
        try {
            await command(['docker', 'rm', '--force', trustedProxyContainer])
        } catch {
            // The normal Compose cleanup remains a fallback if startup failed before naming.
        }
    }

    const ready = await healthRequest(managementUrl + '/health/ready')
    assert.equal(ready.status, 200)
    assert.deepEqual(await ready.json(), { status: 'ready' })
    await assertAdminHeaders(ready)
    passed('Web readiness reports PostgreSQL, Redis, and proxy runtime')

    const login = await fetch(managementUrl + '/login', {
        redirect: 'follow',
        signal: AbortSignal.timeout(5_000),
    })
    assert.equal(login.status, 200)
    await assertAdminHeaders(login)
    const loginHtml = await login.text()
    const inlineScripts = (loginHtml.match(/<script(?:\s|>)/gu) ?? []).length
    if (inlineScripts > 0) {
        assert.match(
            login.headers.get('content-security-policy') ?? '',
            /script-src 'self' 'unsafe-inline'/u,
        )
    }
    passed('admin UI response headers are present on a rendered page')

    const proxyBaseline = await fetch('http://127.0.0.1:' + proxyHttpPort + '/', {
        headers: { host: 'production-smoke.invalid' },
        signal: AbortSignal.timeout(5_000),
    })
    assert.equal(proxyBaseline.status, 404)
    await proxyBaseline.body?.cancel()
    assert.ok(proxyHttpsPort > 0)
    passed('public proxy HTTP and HTTPS ports are published while baseline stays safe')

    assert.equal(await portIsUnpublished('postgres', 5432), true)
    assert.equal(await portIsUnpublished('redis', 6379), true)
    assert.equal(await portIsUnpublished('proxy-runtime', 8081), true)
    passed('PostgreSQL, Redis, and controller remain unpublished')

    assert.deepEqual(await attachedNetworks('postgres'), [project + '_data'])
    assert.deepEqual(await attachedNetworks('redis'), [project + '_data'])
    assert.deepEqual(await attachedNetworks('migrate'), [project + '_data'])
    assert.deepEqual(await attachedNetworks('proxy-runtime'), [
        project + '_control',
        project + '_edge',
    ])
    assert.deepEqual(await attachedNetworks('web'), [
        project + '_control',
        project + '_data',
        project + '_management',
    ])
    passed('data, controller, proxy edge, and management networks stay segmented')

    const testStateDirectory = '/var/lib/rentnerproxy/proxy/backup-smoke'
    const testPrivateKey = testStateDirectory + '/certificate-private-key.pem'
    const testLog = testStateDirectory + '/logs/smoke.log'
    const databaseMarker = 'production-backup-' + runId
    await postgresQuery(
        "CREATE TABLE production_backup_smoke (marker text PRIMARY KEY); INSERT INTO production_backup_smoke (marker) VALUES ('" +
            databaseMarker +
            "');",
    )
    const migrationCountBeforeRestart = await postgresQuery(
        'SELECT count(*) FROM drizzle.__drizzle_migrations;',
    )
    await command([
        ...compose,
        'exec',
        '-T',
        'proxy-runtime',
        'sh',
        '-c',
        'set -eu; umask 077; mkdir -p /var/lib/rentnerproxy/proxy/backup-smoke/logs; printf %s production-smoke-private-key > /var/lib/rentnerproxy/proxy/backup-smoke/certificate-private-key.pem; chmod 700 /var/lib/rentnerproxy/proxy/backup-smoke; chmod 600 /var/lib/rentnerproxy/proxy/backup-smoke/certificate-private-key.pem; printf %s excluded-smoke-log > /var/lib/rentnerproxy/proxy/backup-smoke/logs/smoke.log',
    ])
    const testPrivateKeyDigest = await command([
        ...compose,
        'exec',
        '-T',
        'proxy-runtime',
        'sha256sum',
        testPrivateKey,
    ])
    assert.equal(
        await command([
            ...compose,
            'exec',
            '-T',
            'proxy-runtime',
            'stat',
            '-c',
            '%a',
            testPrivateKey,
        ]),
        '600',
    )

    const stateDigestBefore = await command([
        ...compose,
        'exec',
        '-T',
        'proxy-runtime',
        'sha256sum',
        '/var/lib/rentnerproxy/proxy/active.conf',
    ])
    await command([...compose, 'restart', 'postgres', 'proxy-runtime', 'web'])
    await waitForHealthy('postgres')
    await waitForHealthy('proxy-runtime')
    await waitForHealthy('web')
    const stateDigestAfter = await command([
        ...compose,
        'exec',
        '-T',
        'proxy-runtime',
        'sha256sum',
        '/var/lib/rentnerproxy/proxy/active.conf',
    ])
    assert.equal(stateDigestAfter, stateDigestBefore)
    assert.equal(
        await command([...compose, 'exec', '-T', 'proxy-runtime', 'sha256sum', testPrivateKey]),
        testPrivateKeyDigest,
    )
    assert.equal(await postgresQuery('SELECT marker FROM production_backup_smoke;'), databaseMarker)
    assert.equal(
        await postgresQuery('SELECT count(*) FROM drizzle.__drizzle_migrations;'),
        migrationCountBeforeRestart,
    )
    passed('database, proxy, and private certificate state survive service restarts')

    await command([...compose, 'stop', 'redis'])
    await waitFor(
        async () => (await healthRequest(managementUrl + '/health/ready')).status === 503,
        'Web readiness failure after Redis stop',
    )
    await command([...compose, 'start', 'redis'])
    await waitForHealthy('redis')
    await waitFor(
        async () => (await healthRequest(managementUrl + '/health/ready')).status === 200,
        'Web readiness recovery after Redis start',
    )
    passed('Web readiness fails closed on Redis loss and recovers')

    await command([
        ...compose,
        'exec',
        '-T',
        'proxy-runtime',
        '/usr/local/openresty/nginx/sbin/nginx',
        '-p',
        '/var/lib/rentnerproxy/proxy/',
        '-c',
        'active.conf',
        '-s',
        'quit',
    ])
    await waitFor(
        () =>
            commandFails([
                ...compose,
                'exec',
                '-T',
                'proxy-runtime',
                'rentnerproxy-controller',
                '--healthcheck',
                'ready',
            ]),
        'controller readiness failure after OpenResty stop',
    )
    await command([
        ...compose,
        'exec',
        '-T',
        'proxy-runtime',
        'rentnerproxy-controller',
        '--healthcheck',
        'health',
    ])
    assert.equal((await healthRequest(managementUrl + '/health/live')).status, 200)
    assert.equal((await healthRequest(managementUrl + '/health/ready')).status, 503)
    await command([...compose, 'restart', 'proxy-runtime'])
    await waitForHealthy('proxy-runtime')
    await waitFor(
        async () => (await healthRequest(managementUrl + '/health/ready')).status === 200,
        'Web readiness recovery after OpenResty restart',
    )
    passed('OpenResty loss preserves liveness, fails readiness, and recovers')

    await command([...compose, 'stop', 'postgres'])
    await waitFor(
        async () => (await healthRequest(managementUrl + '/health/ready')).status === 503,
        'Web readiness failure after PostgreSQL stop',
    )
    assert.equal((await healthRequest(managementUrl + '/health/live')).status, 200)
    await command([...compose, 'start', 'postgres'])
    await waitForHealthy('postgres')
    await waitFor(
        async () => (await healthRequest(managementUrl + '/health/ready')).status === 200,
        'Web readiness recovery after PostgreSQL start',
    )
    passed('Web readiness fails closed on PostgreSQL loss and recovers')

    await command([...compose, 'stop', 'proxy-runtime'])
    await waitFor(
        async () => (await healthRequest(managementUrl + '/health/ready')).status === 503,
        'Web readiness failure after controller stop',
    )
    assert.equal((await healthRequest(managementUrl + '/health/live')).status, 200)
    await command([...compose, 'start', 'proxy-runtime'])
    await waitForHealthy('proxy-runtime')
    await waitFor(
        async () => (await healthRequest(managementUrl + '/health/ready')).status === 200,
        'Web readiness recovery after controller start',
    )
    passed('Web readiness fails closed on controller loss and recovers')

    const backupRoot = await mkdtemp(join(repositoryRoot, '.production-backup-smoke-'))
    try {
        await command(
            [
                process.execPath,
                'scripts/production-backup.ts',
                '--project',
                project,
                '--output',
                backupRoot,
            ],
            { timeoutMs: 600_000 },
        )
        const backupEntries = await readdir(backupRoot)
        assert.equal(backupEntries.length, 1)
        const backupPath = join(backupRoot, backupEntries[0]!)
        const metadata = JSON.parse(await readFile(join(backupPath, 'metadata.json'), 'utf8')) as {
            controllerState?: { archive?: string }
            redis?: string
            version?: number
        }
        assert.equal(metadata.version, 1)
        assert.equal(metadata.redis, 'excluded')
        assert.equal(metadata.controllerState?.archive, 'controller-state.tar')
        await postgresQuery('DROP TABLE production_backup_smoke;')
        await command([...compose, 'exec', '-T', 'proxy-runtime', 'rm', '-f', testPrivateKey])
        await command(
            [
                process.execPath,
                'scripts/production-restore.ts',
                '--project',
                project,
                '--input',
                backupPath,
                '--confirm-replace',
            ],
            { timeoutMs: 900_000 },
        )
        await waitForHealthy('proxy-runtime')
        await waitForHealthy('web')
        assert.equal(
            await postgresQuery('SELECT marker FROM production_backup_smoke;'),
            databaseMarker,
        )
        assert.equal(
            await command([...compose, 'exec', '-T', 'proxy-runtime', 'sha256sum', testPrivateKey]),
            testPrivateKeyDigest,
        )
        assert.equal(
            await command([
                ...compose,
                'exec',
                '-T',
                'proxy-runtime',
                'stat',
                '-c',
                '%a',
                testPrivateKey,
            ]),
            '600',
        )
        await command([
            ...compose,
            'exec',
            '-T',
            'proxy-runtime',
            'sh',
            '-c',
            'test ! -e ' + testLog,
        ])
        passed('PostgreSQL/controller-state backup and explicit restore smoke completed')
    } finally {
        await rm(backupRoot, { force: true, recursive: true })
    }

    const migrationFailureRoot = await mkdtemp(
        join(tmpdir(), 'rentnerproxy-production-migration-failure-'),
    )
    const migrationFailureOverride = join(migrationFailureRoot, 'compose.override.yml')
    const failureCompose = [...compose, '--file', migrationFailureOverride]
    await writeFile(
        migrationFailureOverride,
        "services:\n  migrate:\n    entrypoint: ['bun']\n    command: ['-e', 'process.exit(42)']\n",
        'utf8',
    )
    await command([...compose, 'down', '--volumes', '--remove-orphans'], {
        timeoutMs: 180_000,
    })
    try {
        assert.equal(
            await commandFails([...failureCompose, 'up', '--detach', 'web'], environment, 300_000),
            true,
        )
        const failedMigrationId = await command([
            ...failureCompose,
            'ps',
            '--all',
            '--quiet',
            'migrate',
        ])
        assert.ok(failedMigrationId)
        assert.equal(
            await command([
                'docker',
                'inspect',
                '--format',
                '{{.State.Status}}|{{.State.ExitCode}}',
                failedMigrationId,
            ]),
            'exited|42',
        )
        const blockedWebId = await command([...failureCompose, 'ps', '--all', '--quiet', 'web'])
        if (blockedWebId) {
            assert.notEqual(
                await command(['docker', 'inspect', '--format', '{{.State.Status}}', blockedWebId]),
                'running',
            )
        }
        passed('migration failure blocks Web startup visibly')
    } finally {
        try {
            await command([...failureCompose, 'down', '--volumes', '--remove-orphans'], {
                timeoutMs: 180_000,
            })
        } finally {
            await rm(migrationFailureRoot, { force: true, recursive: true })
        }
    }

    console.log('Production Compose smoke passed: ' + assertions + ' assertions')
}

if (import.meta.main) {
    try {
        await runSmoke()
    } catch (error) {
        const message =
            error instanceof Error ? (error.stack ?? error.message) : 'unknown smoke error'
        console.error('Production Compose smoke failed: ' + message)
        process.exitCode = 1
    } finally {
        try {
            await command([...compose, 'down', '--volumes', '--remove-orphans'], {
                timeoutMs: 180_000,
            })
        } catch {
            console.error('Production Compose smoke cleanup failed.')
            process.exitCode = 1
        }
    }
}
