import type { CrowdSecMode, CrowdSecRuntimeStatus } from './Types/appliance-compose-smoke.types.ts'
// oxlint-disable no-await-in-loop -- Readiness probes deliberately poll in a bounded sequence.

import assert from 'node:assert/strict'
import { verifyApplianceStartup } from './appliance-startup-smoke.ts'
import { dockerBuildDiagnostic } from '../../../scripts/docker-build-diagnostics.ts'
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto'
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
    restoreSmokeDiagnostic,
    smokeCompose,
    smokeDockerArguments,
} from '../../../scripts/smoke-resources.ts'
import {
    buildHttp3Client,
    requestHttp3Client,
    assertHttp3Response,
} from '../../../scripts/http3-client.ts'
import { verifyAlpha1Upgrade, verifyAlpha3Upgrade } from '../../../scripts/alpha1-upgrade-smoke.ts'
import {
    seedBetaBackupState,
    assertBetaBackupState,
} from '../../../scripts/beta-backup-state-smoke.ts'
import {
    seedAlpha4PersistenceFixture,
    readAlpha4PersistenceSnapshot,
    assertAlpha4PersistenceFixture,
    assertAlpha4PersistenceRequestDecrypts,
} from '../../../scripts/alpha4-persistence-fixture.ts'

const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url))
const rootComposeFile = join(repositoryRoot, 'docker-compose.yml')
const productionDockerfile = join(repositoryRoot, 'docker', 'production', 'Dockerfile')
const accessLogPath = '/var/lib/rentnerproxy/proxy/logs/access.log'
const runId = randomUUID().replaceAll('-', '').slice(0, 12)
const project = 'rentnerproxy-appliance-smoke-' + runId
const publicOrigin = 'https://management.appliance-smoke.invalid'
const trustedProxyCidrs = '127.0.0.1/32,::1/128'
const smtpEnvironment = {
    SMTP_FROM: 'RentnerProxy <noreply@appliance-smoke.invalid>',
    SMTP_HOST: 'smtp.appliance-smoke.invalid',
    SMTP_PASSWORD: 'appliance-smoke-password-' + runId,
    SMTP_PORT: '587',
    SMTP_SECURE: 'false',
    SMTP_USER: 'appliance-smoke-user',
} as const
const smtpNames = Object.keys(smtpEnvironment).toSorted()
const commandEnvironment: NodeJS.ProcessEnv = { ...process.env }
for (const variable of smtpNames) delete commandEnvironment[variable]
for (const variable of [
    'APP_ENCRYPTION_KEY',
    'DATABASE_URL',
    'POSTGRES_PASSWORD',
    'RENTNERPROXY_APP_KEY_FILE',
    'RENTNERPROXY_CONTROLLER_TOKEN',
    'RENTNERPROXY_IMAGE',
    'RENTNERPROXY_PROXY_TRUSTED_PROXY_CIDRS',
    'RENTNERPROXY_PUBLIC_ORIGIN',
]) {
    delete commandEnvironment[variable]
}

let assertions = 0

function passed(label: string): void {
    assertions += 1
    console.log('PASS ' + label)
}

async function command(argumentsList: string[], timeoutMs = 120_000): Promise<string> {
    const child = Bun.spawn({
        cmd: smokeDockerArguments(argumentsList),
        cwd: repositoryRoot,
        env: commandEnvironment,
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
    })
    const timer = setTimeout(() => child.kill(), timeoutMs)
    const stdout =
        child.stdout && typeof child.stdout !== 'number'
            ? new Response(child.stdout).text()
            : Promise.resolve('')
    const stderr =
        child.stderr && typeof child.stderr !== 'number'
            ? new Response(child.stderr).text()
            : Promise.resolve('')

    try {
        const [exitCode, output, errorOutput] = await Promise.all([child.exited, stdout, stderr])
        if (exitCode !== 0) {
            if (argumentsList[0] === 'docker' && argumentsList[1] === 'build')
                console.error(dockerBuildDiagnostic(errorOutput))
            const diagnostic = restoreSmokeDiagnostic(errorOutput)
            if (diagnostic) console.error(diagnostic)
            throw new Error('smoke command failed: ' + argumentsList.slice(0, 2).join(' '))
        }
        return (output || errorOutput).trim()
    } finally {
        clearTimeout(timer)
    }
}

function http3Command(args: string[], options?: { readonly timeoutMs?: number }): Promise<string> {
    return command(args, options?.timeoutMs)
}

function valkeyCommand(container: string, args: string[]): Promise<string> {
    return command([
        'docker',
        'exec',
        container,
        'gosu',
        'rentnerproxy',
        '/opt/rentnerproxy/valkey/bin/valkey-cli',
        '--raw',
        ...args,
    ])
}

async function commandWithEnvironment(
    argumentsList: string[],
    environment: NodeJS.ProcessEnv,
    timeoutMs = 120_000,
): Promise<string> {
    const child = Bun.spawn({
        cmd: smokeDockerArguments(argumentsList),
        cwd: repositoryRoot,
        env: environment,
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
    })
    const timer = setTimeout(() => child.kill(), timeoutMs)
    const stdout =
        child.stdout && typeof child.stdout !== 'number'
            ? new Response(child.stdout).text()
            : Promise.resolve('')
    const stderr =
        child.stderr && typeof child.stderr !== 'number'
            ? new Response(child.stderr).text()
            : Promise.resolve('')

    try {
        const [exitCode, output, errorOutput] = await Promise.all([child.exited, stdout, stderr])
        if (exitCode !== 0) {
            const diagnostic = restoreSmokeDiagnostic(errorOutput)
            if (diagnostic) console.error(diagnostic)
            throw new Error(
                diagnostic ?? 'smoke command failed: ' + argumentsList.slice(0, 2).join(' '),
            )
        }
        return (output || errorOutput).trim()
    } finally {
        clearTimeout(timer)
    }
}

async function commandFails(argumentsList: string[], timeoutMs = 120_000): Promise<boolean> {
    try {
        await command(argumentsList, timeoutMs)
        return false
    } catch {
        return true
    }
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
        } catch {}
        await Bun.sleep(500)
    }
    throw new Error('timed out waiting for ' + label)
}

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

function composeCommand(envFile: string, composeFile: string, projectName = project): string[] {
    return [
        'docker',
        'compose',
        '--env-file',
        envFile,
        '--project-name',
        projectName,
        '--file',
        composeFile,
    ]
}

async function containerId(compose: string[]): Promise<string> {
    const id = await command([...compose, 'ps', '--all', '--quiet', 'rentnerproxy'])
    assert.ok(id, 'rentnerproxy container is missing')
    return id
}

async function inspect(id: string, format: string): Promise<string> {
    return command(['docker', 'inspect', '--format', format, id])
}

async function containerHealth(id: string): Promise<string> {
    return inspect(
        id,
        '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}|{{.State.ExitCode}}',
    )
}

async function waitForHealthy(id: string): Promise<void> {
    await waitFor(
        async () => (await containerHealth(id)).includes('|healthy|'),
        'rentnerproxy healthy',
        240_000,
    )
}

async function httpStatus(url: string): Promise<{ status: number; body: string }> {
    const response = await fetch(url, { signal: AbortSignal.timeout(5_000) })
    const body = await response.text()
    return { status: response.status, body }
}

async function controllerCall(
    id: string,
    path: string,
    method: string,
    body?: unknown,
): Promise<{ status: number; body: string }> {
    const encodedBody = body === undefined ? '' : JSON.stringify(body)
    const source = `const token=await Bun.file('/run/rentnerproxy/controller-token/value').text();const response=await fetch('http://127.0.0.1:8081${path}',{method:${JSON.stringify(method)},headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:${JSON.stringify(encodedBody)} });process.stdout.write(JSON.stringify({status:response.status,body:await response.text()}));`
    return JSON.parse(
        await command(['docker', 'exec', '--user', '10001:10001', id, 'bun', '-e', source]),
    ) as { status: number; body: string }
}

function parseCrowdSecStatus(response: { status: number; body: string }): CrowdSecRuntimeStatus {
    assert.equal(response.status, 200)
    return JSON.parse(response.body) as CrowdSecRuntimeStatus
}

async function waitForCrowdSec(
    id: string,
    predicate: (status: CrowdSecRuntimeStatus) => boolean,
    label: string,
): Promise<CrowdSecRuntimeStatus> {
    let observed: CrowdSecRuntimeStatus | undefined
    await waitFor(async () => {
        observed = parseCrowdSecStatus(
            await controllerCall(id, '/internal/v1/crowdsec/status', 'GET'),
        )
        return predicate(observed)
    }, label)
    assert.ok(observed)
    return observed
}

async function persistCrowdSecMode(
    id: string,
    mode: CrowdSecMode,
    communityEnabled = false,
): Promise<void> {
    const value = JSON.stringify({
        version: 1,
        mode,
        ...(communityEnabled ? { communityEnabled } : {}),
    })
    await command([
        'docker',
        'exec',
        id,
        'gosu',
        'postgres',
        'psql',
        '--no-psqlrc',
        '--no-password',
        '--host=/var/run/postgresql',
        '--username=postgres',
        '--dbname=rentnerproxy',
        '--command',
        `INSERT INTO rentnerproxy.system_settings (key, value) VALUES ('crowdsec_configuration_v1', '${value}'::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP;`,
    ])
}

async function applyCrowdSecMode(id: string, mode: CrowdSecMode): Promise<CrowdSecRuntimeStatus> {
    await persistCrowdSecMode(id, mode)
    const applied = await controllerCall(id, '/internal/v1/crowdsec/config', 'PUT', { mode })
    assert.equal(applied.status, 200)
    return waitForCrowdSec(
        id,
        (status) =>
            status.mode === mode &&
            (mode === 'managed'
                ? status.state === 'connected' && status.managedEngine === 'ready'
                : status.state === 'disabled' && status.managedEngine === 'stopped'),
        'CrowdSec ' + mode,
    )
}

async function crowdSecEngineUids(id: string): Promise<string[]> {
    const output = await command([
        'docker',
        'exec',
        id,
        'sh',
        '-c',
        'for status_file in /proc/[0-9]*/status; do if grep -q "^Name:[[:space:]]*crowdsec$" "$status_file"; then awk "/^Uid:/{print \\$2}" "$status_file"; fi; done',
    ])
    return output.split(/\r?\n/u).filter(Boolean)
}

function digest(value: string | Uint8Array): string {
    return createHash('sha256').update(value).digest('hex')
}

function encryptCrowdSecApiKey(
    apiKey: string,
    applicationKey: string,
): {
    ciphertext: string
    iv: string
} {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', Buffer.from(applicationKey, 'base64'), iv)
    cipher.setAAD(Buffer.from('crowdsec_configuration_v1:external_api_key'))
    const ciphertext = Buffer.concat([
        cipher.update(apiKey, 'utf8'),
        cipher.final(),
        cipher.getAuthTag(),
    ])
    return { ciphertext: ciphertext.toString('base64url'), iv: iv.toString('base64url') }
}

function decryptCrowdSecApiKey(
    encrypted: { readonly ciphertext: string; readonly iv: string },
    applicationKey: string,
): string {
    const ciphertext = Buffer.from(encrypted.ciphertext, 'base64url')
    const decipher = createDecipheriv(
        'aes-256-gcm',
        Buffer.from(applicationKey, 'base64'),
        Buffer.from(encrypted.iv, 'base64url'),
    )
    decipher.setAAD(Buffer.from('crowdsec_configuration_v1:external_api_key'))
    decipher.setAuthTag(ciphertext.subarray(-16))
    return Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]).toString(
        'utf8',
    )
}

function listenerAddresses(procNet: string, port: number): string[] {
    const portHex = port.toString(16).toUpperCase().padStart(4, '0')
    return procNet
        .split(/\r?\n/u)
        .map((line) => line.trim().split(/\s+/u))
        .filter((fields) => fields.length >= 4 && fields[3] === '0A')
        .map((fields) => fields[1]!.split(':'))
        .filter(([, localPort]) => localPort === portHex)
        .map(([address]) => address!)
}

function assertLoopbackListeners(procNet: string, port: number): void {
    const listeners = listenerAddresses(procNet, port)

    assert.ok(listeners.length > 0, 'expected a listener on loopback port ' + port)
    for (const address of listeners) {
        assert.ok(
            address === '0100007F' ||
                address === '0000000000000000FFFF00000100007F' ||
                address === '00000000000000000000000001000000',
            'non-loopback listener found on port ' + port,
        )
    }
}

async function runSmoke(): Promise<void> {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'rentnerproxy-appliance-smoke-'))
    const envFile = join(temporaryRoot, 'smtp.env')
    const temporaryComposeFile = join(temporaryRoot, 'docker-compose.yml')
    const imageTag = 'rentnerproxy-appliance-smoke:' + runId
    const http3Image = 'rentnerproxy-appliance-http3:' + runId
    const volumeName = project + '-data'

    const inheritedVolumeName = project + '-postgres-base'
    const [httpPort, managementPort, httpsPort] = await Promise.all([
        availableLoopbackPort(),
        availableLoopbackPort(),
        availableLoopbackPort(),
    ])
    await writeFile(
        envFile,
        smtpNames
            .map((name) => `${name}=${smtpEnvironment[name as keyof typeof smtpEnvironment]}`)
            .join('\n') +
            '\nRENTNERPROXY_PUBLIC_ORIGIN=' +
            publicOrigin +
            '\nRENTNERPROXY_PROXY_TRUSTED_PROXY_CIDRS=' +
            trustedProxyCidrs +
            '\nRENTNERPROXY_IMAGE=' +
            imageTag +
            '\n',
        'utf8',
    )
    const rootCompose = (await readFile(rootComposeFile, 'utf8')).replaceAll('\r\n', '\n')
    assert.match(
        rootCompose,
        /image: \$\{RENTNERPROXY_IMAGE:\?[^}]+\}/u,
        'root Compose must require an explicit RentnerProxy image',
    )
    const temporaryCompose = smokeCompose(
        rootCompose
            .replace(
                'services:\n    rentnerproxy:\n',
                'services:\n    rentnerproxy:\n        extra_hosts:\n            - host.docker.internal:host-gateway\n',
            )
            .replace(
                '        environment:\n',
                '        environment:\n            RENTNERPROXY_PROXY_PUBLIC_HTTPS_PORT: "' +
                    httpsPort +
                    '"\n',
            )
            .replace("- '80:8080'", `- '127.0.0.1:${httpPort}:8080'`)
            .replace("- '127.0.0.1:81:3000'", `- '127.0.0.1:${managementPort}:3000'`)
            .replace("- '443:8443/tcp'", `- '127.0.0.1:${httpsPort}:8443/tcp'`)
            .replace("- '443:8443/udp'", `- '127.0.0.1:${httpsPort}:8443/udp'`)
            .replace(
                '- rentnerproxy:/var/lib/rentnerproxy',
                `- ${volumeName}:/var/lib/rentnerproxy\n            - ${inheritedVolumeName}:/var/lib/postgresql`,
            )
            .replace(
                '\nvolumes:\n    rentnerproxy:\n',
                `\nvolumes:\n    ${volumeName}:\n    ${inheritedVolumeName}:\n`,
            ),
    )
    assert.notEqual(
        temporaryCompose,
        rootCompose,
        'temporary appliance Compose was not transformed',
    )
    await writeFile(temporaryComposeFile, temporaryCompose, 'utf8')
    const compose = composeCommand(envFile, temporaryComposeFile)
    const restoreProject = project + '-restore'
    const restoreCompose = composeCommand(envFile, temporaryComposeFile, restoreProject)
    const deploymentChangeProject = project + '-deployment-change'
    const deploymentChangeCompose = composeCommand(
        envFile,
        temporaryComposeFile,
        deploymentChangeProject,
    )
    let backend: ReturnType<typeof Bun.serve> | undefined
    const scriptEnvironment: NodeJS.ProcessEnv = {
        ...commandEnvironment,
        ...smtpEnvironment,
        RENTNERPROXY_IMAGE: imageTag,
        RENTNERPROXY_PUBLIC_ORIGIN: publicOrigin,
        RENTNERPROXY_PROXY_TRUSTED_PROXY_CIDRS: trustedProxyCidrs,
        RENTNERPROXY_COMPOSE_FILE: temporaryComposeFile,
    }

    try {
        await buildHttp3Client(http3Command, http3Image)
        await command(
            ['docker', 'build', '--tag', imageTag, '--file', productionDockerfile, '.'],
            900_000,
        )
        const rendered = JSON.parse(await command([...compose, 'config', '--format', 'json'])) as {
            services: Record<
                string,
                {
                    environment?: Record<string, string>
                    image?: string
                    ports?: Array<{ published: string; target: number; protocol: string }>
                    volumes?: Array<{ source?: string; target: string }>
                }
            >
            volumes?: Record<string, unknown>
        }
        assert.deepEqual(Object.keys(rendered.services), ['rentnerproxy'])
        const service = rendered.services.rentnerproxy
        assert.ok(service)
        assert.equal(service.image, imageTag)
        assert.deepEqual(
            Object.keys(service.environment ?? {}).toSorted(),
            [
                ...smtpNames,
                'RENTNERPROXY_PROXY_TRUSTED_PROXY_CIDRS',
                'RENTNERPROXY_PROXY_PUBLIC_HTTPS_PORT',
                'RENTNERPROXY_PUBLIC_ORIGIN',
            ].toSorted(),
        )
        assert.equal(service.environment?.RENTNERPROXY_PROXY_TRUSTED_PROXY_CIDRS, trustedProxyCidrs)
        assert.equal(service.environment?.RENTNERPROXY_PUBLIC_ORIGIN, publicOrigin)
        assert.deepEqual(
            (service.ports ?? []).map(({ published, target, protocol }) => ({
                published,
                target,
                protocol,
            })),
            [
                { published: String(httpPort), target: 8080, protocol: 'tcp' },
                { published: String(managementPort), target: 3000, protocol: 'tcp' },
                { published: String(httpsPort), target: 8443, protocol: 'tcp' },
                { published: String(httpsPort), target: 8443, protocol: 'udp' },
            ],
        )
        assert.deepEqual(
            Object.keys(rendered.volumes ?? {}).toSorted(),
            [volumeName, inheritedVolumeName].toSorted(),
        )
        assert.deepEqual(
            (service.volumes ?? [])
                .map(({ source, target }) => ({ source, target }))
                .toSorted((a, b) => a.target.localeCompare(b.target)),
            [
                { source: inheritedVolumeName, target: '/var/lib/postgresql' },
                { source: volumeName, target: '/var/lib/rentnerproxy' },
            ],
        )
        passed('appliance Compose keeps private management and persistent storage')

        await commandFails([...compose, 'down', '--volumes', '--remove-orphans'], 180_000)
        await command([...compose, 'up', '--detach'], 900_000)
        const id = await containerId(compose)
        await waitForHealthy(id)
        const mounts = JSON.parse(await inspect(id, '{{json .Mounts}}')) as Array<{
            Type: string
            Name: string
            Destination: string
        }>
        assert.deepEqual(
            mounts
                .map(({ Type, Name, Destination }) => ({ Type, Name, Destination }))
                .toSorted((a, b) => a.Destination.localeCompare(b.Destination)),
            [
                {
                    Type: 'volume',
                    Name: project + '_' + inheritedVolumeName,
                    Destination: '/var/lib/postgresql',
                },
                {
                    Type: 'volume',
                    Name: project + '_' + volumeName,
                    Destination: '/var/lib/rentnerproxy',
                },
            ],
            'every appliance volume must belong to this smoke; anonymous volumes cannot be recovered by run label',
        )
        passed('empty appliance volume builds and starts healthy')
        assert.match(
            await command([
                'docker',
                'exec',
                id,
                '/opt/rentnerproxy/valkey/bin/valkey-server',
                '--version',
            ]),
            /Valkey server v=9\.1\.2/u,
        )
        assert.equal(await valkeyCommand(id, ['PING']), 'PONG')
        assert.equal(await valkeyCommand(id, ['CONFIG', 'GET', 'bind']), 'bind\n127.0.0.1')
        assert.equal(await valkeyCommand(id, ['CONFIG', 'GET', 'appendonly']), 'appendonly\nno')
        assert.equal(await valkeyCommand(id, ['CONFIG', 'GET', 'save']), 'save')
        for (const [source, target] of [
            ['Valkey-LICENSE', 'LICENSE'],
            ['Valkey-NOTICE', 'NOTICE'],
        ] as const) {
            const targetPath = '/usr/share/licenses/valkey/' + target
            assert.equal(
                await command(['docker', 'exec', id, 'sha256sum', targetPath]),
                digest(await readFile(join(repositoryRoot, 'docker', 'licenses', source))) +
                    '  ' +
                    targetPath,
            )
        }
        passed('pinned Valkey runs on loopback without persistence and retains its licenses')
        const initialCrowdSecStatus = parseCrowdSecStatus(
            await controllerCall(id, '/internal/v1/crowdsec/status', 'GET'),
        )
        assert.deepEqual(initialCrowdSecStatus, {
            mode: 'disabled',
            state: 'disabled',
            credentialConfigured: false,
            enforcementActive: false,
            managedEngine: 'stopped',
            communityEnabled: false,
            communityState: 'disabled',
            consoleState: 'not_enrolled',
            failureBehavior: 'fail_open',
            clientIpSource: 'caddy',
        })
        const syntheticEnrollmentKey = 'a'.repeat(16)
        const disabledEnrollment = await controllerCall(
            id,
            '/internal/v1/crowdsec/console/enroll',
            'POST',
            { enrollmentKey: syntheticEnrollmentKey },
        )
        assert.equal(disabledEnrollment.status, 422)
        assert.ok(!disabledEnrollment.body.includes(syntheticEnrollmentKey))
        assert.equal(
            await command(['docker', 'exec', id, 'cat', '/run/rentnerproxy/crowdsec/desired-mode']),
            'stopped',
        )
        assert.deepEqual(await crowdSecEngineUids(id), [])
        const initialProcNet = await command([
            'docker',
            'exec',
            id,
            'sh',
            '-c',
            'cat /proc/net/tcp /proc/net/tcp6',
        ])
        assert.deepEqual(listenerAddresses(initialProcNet, 18080), [])
        assert.deepEqual(listenerAddresses(initialProcNet, 6060), [])
        passed('CrowdSec defaults to disabled without starting its managed engine or LAPI')

        const caddyModules = (
            await command(['docker', 'exec', id, '/usr/bin/caddy', 'list-modules'])
        )
            .split(/\r?\n/u)
            .filter(
                (module) =>
                    module === 'crowdsec' ||
                    module === 'admin.api.crowdsec' ||
                    module === 'http.handlers.crowdsec',
            )
            .toSorted()
        assert.deepEqual(caddyModules, ['admin.api.crowdsec', 'crowdsec', 'http.handlers.crowdsec'])
        assert.doesNotMatch(
            await command(['docker', 'exec', id, '/usr/bin/caddy', 'list-modules']),
            /(?:^|\.)appsec(?:$|\.)|(?:^|\.)layer4(?:$|\.)/mu,
        )
        assert.match(
            await command(['docker', 'exec', id, '/usr/local/bin/crowdsec', '-version']),
            /version: v1\.8\.1-909b5157/u,
        )
        assert.equal(
            await command(['docker', 'exec', id, 'sha256sum', '/usr/share/licenses/caddy/LICENSE']),

            digest(await readFile(join(repositoryRoot, 'docker', 'licenses', 'Caddy-LICENSE'))) +
                '  /usr/share/licenses/caddy/LICENSE',
        )
        assert.equal(
            await command([
                'docker',
                'exec',
                id,
                'sha256sum',
                '/usr/share/licenses/crowdsec/LICENSE',
            ]),
            digest(await readFile(join(repositoryRoot, 'docker', 'licenses', 'CrowdSec-LICENSE'))) +
                '  /usr/share/licenses/crowdsec/LICENSE',
        )
        passed('pinned CrowdSec runtime, minimal Caddy modules, and redistributed licenses match')
        const roleState = await command([
            'docker',
            'exec',
            id,
            'gosu',
            'postgres',
            'psql',
            '--no-psqlrc',
            '--no-password',
            '--host=/var/run/postgresql',
            '--username=postgres',
            '--dbname=postgres',
            '--tuples-only',
            '--no-align',
            '--command',
            "SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls FROM pg_roles WHERE rolname = 'rentnerproxy'; SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = 'rentnerproxy'; SELECT rolpassword IS NULL FROM pg_authid WHERE rolname = 'postgres';",
        ])
        assert.deepEqual(roleState.split(/\r?\n/u), ['f|f|f|f|f', 'rentnerproxy', 't'])
        assert.equal(
            await command(['docker', 'exec', id, 'stat', '-c', '%a:%U', '/var/run/postgresql']),
            '700:postgres',
        )
        assert.ok(
            await commandFails([
                'docker',
                'exec',
                '--user',
                '10001:10001',
                id,
                'psql',
                '--no-psqlrc',
                '--no-password',
                '--host=/var/run/postgresql',
                '--username=postgres',
                '--dbname=postgres',
                '--command=SELECT 1',
            ]),
        )
        passed(
            'application database role has no administrative privileges and cannot use bootstrap socket',
        )
        assert.equal(
            await command([
                'docker',
                'exec',
                id,
                'stat',
                '-c',
                '%a:%U:%G',
                '/run/rentnerproxy/app-key/value',
            ]),
            '400:rentnerproxy-web:rentnerproxy-web',
        )
        assert.equal(
            await command([
                'docker',
                'exec',
                id,
                'stat',
                '-c',
                '%a:%U:%G',
                '/run/rentnerproxy/database-url/value',
            ]),
            '400:rentnerproxy-web:rentnerproxy-web',
        )
        assert.equal(
            await command([
                'docker',
                'exec',
                id,
                'stat',
                '-c',
                '%a:%U:%G',
                '/run/rentnerproxy/controller-token/value',
            ]),
            '440:rentnerproxy:rentnerproxy-web',
        )
        const controllerAppKey = '/run/rentnerproxy/controller-app-key/value'
        assert.equal(
            await command(['docker', 'exec', id, 'stat', '-c', '%a:%U:%G', controllerAppKey]),
            '400:rentnerproxy:rentnerproxy',
        )
        await command([
            'docker',
            'exec',
            id,
            'cmp',
            '--silent',
            '/run/rentnerproxy/app-key/value',
            controllerAppKey,
        ])
        await command([
            'docker',
            'exec',
            id,
            'gosu',
            'rentnerproxy',
            'test',
            '-r',
            controllerAppKey,
        ])
        assert.ok(
            await commandFails([
                'docker',
                'exec',
                id,
                'gosu',
                'rentnerproxy-web',
                'test',
                '-r',
                controllerAppKey,
            ]),
        )
        assert.ok(
            await commandFails([
                'docker',
                'exec',
                id,
                'gosu',
                'rentnerproxy',
                'test',
                '-r',
                '/run/rentnerproxy/database-url/value',
            ]),
        )
        passed('DNS credential encryption key is provisioned privately to the controller')
        const boundarySecret = '/var/lib/rentnerproxy/proxy/appliance-boundary-secret'
        await command([
            'docker',
            'exec',
            '--user',
            '10001:10001',
            id,
            'sh',
            '-c',
            `umask 077; printf boundary-secret > ${boundarySecret}`,
        ])
        assert.ok(
            await commandFails([
                'docker',
                'exec',
                id,
                'gosu',
                'rentnerproxy-web',
                'cat',
                boundarySecret,
            ]),
        )
        assert.ok(
            await commandFails([
                'docker',
                'exec',
                id,
                'gosu',
                'rentnerproxy-web',
                'curl',
                '--silent',
                '--fail',
                '--unix-socket',
                '/var/lib/rentnerproxy/proxy/caddy-admin.sock',
                'http://localhost/config/',
            ]),
        )
        passed(
            'web can read only its input secrets and cannot read proxy state or open Caddy admin',
        )

        const setup = await httpStatus('http://127.0.0.1:' + managementPort + '/setup')
        assert.equal(setup.status, 200)
        assert.match(setup.body, /setup|RentnerProxy/iu)
        const entryAsset = setup.body.match(/<script[^>]+src="([^"]+\.js)"/iu)?.[1]
        assert.ok(entryAsset)
        const entryAssetResponse = await httpStatus(
            'http://127.0.0.1:' + managementPort + entryAsset,
        )
        assert.equal(entryAssetResponse.status, 200)
        passed('SSR setup entry module is served for client hydration')
        const stylesheetAssets = Array.from(
            setup.body.matchAll(/<link\b(?=[^>]*\brel="stylesheet")[^>]*\bhref="([^"]+)"/giu),
            (match) => match[1]!,
        )
        assert.ok(stylesheetAssets.length > 0)
        for (const stylesheetAsset of new Set(stylesheetAssets)) {
            assert.ok(stylesheetAsset.startsWith('/assets/'))
            const response = await fetch('http://127.0.0.1:' + managementPort + stylesheetAsset, {
                signal: AbortSignal.timeout(5_000),
            })
            assert.equal(response.status, 200)
            assert.match(response.headers.get('content-type') ?? '', /^text\/css\b/iu)
            assert.ok((await response.text()).length > 0)
        }
        passed('every SSR stylesheet resolves to packaged production CSS')
        const live = await httpStatus('http://127.0.0.1:' + managementPort + '/health/live')
        assert.equal(live.status, 200)
        assert.deepEqual(JSON.parse(live.body), { status: 'ok' })
        const ready = await httpStatus('http://127.0.0.1:' + managementPort + '/health/ready')
        assert.equal(ready.status, 200)
        assert.deepEqual(JSON.parse(ready.body), { status: 'ready' })
        const proxy = await httpStatus('http://127.0.0.1:' + httpPort + '/')
        assert.ok(proxy.status >= 200 && proxy.status < 500)
        passed('setup, liveness, readiness, and proxy HTTP endpoints respond')

        const oversizedStatus = await new Promise<number | undefined>((resolveStatus, reject) => {
            const request = httpRequest(
                'http://127.0.0.1:' + managementPort + '/health/live',
                {
                    method: 'POST',
                    headers: { 'Content-Length': String(12 * 1024 * 1024 + 1) },
                },
                (response) => {
                    response.resume()
                    resolveStatus(response.statusCode)
                },
            )
            request.on('error', reject)
            request.setTimeout(5_000, () =>
                request.destroy(new Error('body-limit probe timed out')),
            )
            request.end()
        })
        assert.equal(oversizedStatus, 413)
        passed('web listener rejects oversized request bodies before application processing')

        const portBindings = JSON.parse(
            await inspect(id, '{{json .HostConfig.PortBindings}}'),
        ) as Record<string, unknown> | null
        assert.deepEqual(Object.keys(portBindings ?? {}).toSorted(), [
            '3000/tcp',
            '8080/tcp',
            '8443/tcp',
            '8443/udp',
        ])
        const procNet = await command([
            'docker',
            'exec',
            id,
            'sh',
            '-c',
            'cat /proc/net/tcp /proc/net/tcp6',
        ])
        assertLoopbackListeners(procNet, 5432)
        assertLoopbackListeners(procNet, 6379)
        assertLoopbackListeners(procNet, 8081)
        passed('database, Valkey, and controller are unpublished and loopback-only')

        const environment = JSON.parse(await inspect(id, '{{json .Config.Env}}')) as string[]
        assert.ok(
            environment.includes('RENTNERPROXY_PROXY_TRUSTED_PROXY_CIDRS=' + trustedProxyCidrs),
        )
        for (const name of smtpNames) {
            assert.ok(
                environment.includes(
                    `${name}=${smtpEnvironment[name as keyof typeof smtpEnvironment]}`,
                ),
            )
        }
        passed('dummy SMTP configuration reaches the appliance container')

        const generatedSecrets = JSON.parse(
            await command([
                'docker',
                'exec',
                id,
                'bun',
                '-e',
                'const state = await Bun.file("/var/lib/rentnerproxy/bootstrap/secrets-v1.json").json(); process.stdout.write(JSON.stringify(state));',
            ]),
        ) as Record<string, string>
        const secretNames = [
            'appEncryptionKey',
            'controllerToken',
            'databaseUrl',
            'postgresPassword',
        ]
        for (const name of secretNames) assert.equal(typeof generatedSecrets[name], 'string')
        assert.match(generatedSecrets.postgresPassword!, /^[a-f0-9]{64}$/u)
        assert.match(generatedSecrets.controllerToken!, /^[a-f0-9]{64}$/u)
        assert.match(generatedSecrets.appEncryptionKey!, /^[A-Za-z0-9+/]{43}=$/u)
        const generatedSecretDigests = Object.fromEntries(
            secretNames.map((name) => [name, digest(generatedSecrets[name]!)]),
        )
        const image = await inspect(id, '{{.Image}}')
        const imageHistory = await command([
            'docker',
            'history',
            '--no-trunc',
            '--format',
            '{{.CreatedBy}}',
            image,
        ])
        const stackLogs = await command([...compose, 'logs', '--no-color'])
        for (const name of secretNames) {
            const secret = generatedSecrets[name]!
            assert.equal(imageHistory.includes(secret), false, name + ' leaked into image history')
            assert.equal(
                environment.some((entry) => entry.includes(secret)),
                false,
                name + ' leaked into container environment',
            )
            assert.equal(stackLogs.includes(secret), false, name + ' leaked into container logs')
        }
        passed('generated secrets stay out of image history, container env, and logs')

        const marker = 'appliance-smoke-' + runId
        await command([
            'docker',
            'exec',
            id,
            'sh',
            '-c',
            `printf %s ${marker} > /var/lib/rentnerproxy/appliance-smoke-marker; PGPASSWORD="$(cat /run/rentnerproxy/postgres/value)" gosu postgres psql --host=127.0.0.1 --username=rentnerproxy --dbname=rentnerproxy --command="CREATE TABLE IF NOT EXISTS appliance_compose_smoke (marker text PRIMARY KEY); INSERT INTO appliance_compose_smoke (marker) VALUES ('${marker}') ON CONFLICT DO NOTHING;" >/dev/null`,
        ])
        const markerDigest = await command([
            'docker',
            'exec',
            id,
            'sha256sum',
            '/var/lib/rentnerproxy/appliance-smoke-marker',
        ])
        await command(['docker', 'exec', id, 'chgrp', 'rentnerproxy', accessLogPath])
        assert.equal(
            await command(['docker', 'exec', id, 'stat', '-c', '%a:%u:%g', accessLogPath]),
            '640:10001:10001',
        )
        await command([...compose, 'up', '--force-recreate', '--detach'])
        let recreatedId = await containerId(compose)
        await waitForHealthy(recreatedId)
        const recreatedSecrets = JSON.parse(
            await command([
                'docker',
                'exec',
                recreatedId,
                'bun',
                '-e',
                'const state = await Bun.file("/var/lib/rentnerproxy/bootstrap/secrets-v1.json").json(); process.stdout.write(JSON.stringify(state));',
            ]),
        ) as Record<string, string>
        assert.deepEqual(
            Object.fromEntries(secretNames.map((name) => [name, digest(recreatedSecrets[name]!)])),
            generatedSecretDigests,
        )
        assert.equal(
            await command([
                'docker',
                'exec',
                recreatedId,
                'sha256sum',
                '/var/lib/rentnerproxy/appliance-smoke-marker',
            ]),
            markerDigest,
        )
        const restoredMarker = await command([
            'docker',
            'exec',
            recreatedId,
            'sh',
            '-c',
            `PGPASSWORD="$(cat /run/rentnerproxy/postgres/value)" gosu postgres psql --host=127.0.0.1 --username=rentnerproxy --dbname=rentnerproxy --tuples-only --no-align --command="SELECT marker FROM appliance_compose_smoke WHERE marker = '${marker}';"`,
        ])
        assert.equal(restoredMarker, marker)
        passed('container recreation preserves generated secrets, volume state, and database state')

        const backendPort = await availableLoopbackPort()
        const trafficMarker = 'appliance-real-traffic-' + runId
        backend = Bun.serve({
            hostname: '0.0.0.0',
            port: backendPort,
            fetch: () => new Response(trafficMarker),
        })
        assert.ok(backend.port)
        const hostDomain = 'appliance-' + runId + '.test'
        const certificateId = '0198d98a-0000-7000-8000-' + runId
        const hostId = '0198d98a-0000-7000-8000-' + runId.slice(0, 11) + 'a'
        const certificateDirectory = '/tmp/rentnerproxy-appliance-certificate'
        await command([
            'docker',
            'exec',
            recreatedId,
            'sh',
            '-c',
            `set -Eeuo pipefail; rm -rf ${certificateDirectory}; mkdir -p ${certificateDirectory}; openssl req -x509 -newkey rsa:2048 -nodes -keyout ${certificateDirectory}/ca.key -out ${certificateDirectory}/ca.pem -days 1 -subj /CN=RentnerProxy-Appliance-CA; openssl req -new -newkey rsa:2048 -nodes -keyout ${certificateDirectory}/leaf.key -out ${certificateDirectory}/leaf.csr -subj /CN=${hostDomain}; printf 'subjectAltName=DNS:${hostDomain}\\nextendedKeyUsage=serverAuth\\nbasicConstraints=critical,CA:FALSE\\nkeyUsage=critical,digitalSignature,keyEncipherment\\n' > ${certificateDirectory}/leaf.ext; openssl x509 -req -in ${certificateDirectory}/leaf.csr -CA ${certificateDirectory}/ca.pem -CAkey ${certificateDirectory}/ca.key -CAcreateserial -out ${certificateDirectory}/leaf.pem -days 1 -sha256 -extfile ${certificateDirectory}/leaf.ext; chown -R 10001:10001 ${certificateDirectory}`,
        ])
        await command([
            'docker',
            'exec',
            recreatedId,
            'sh',
            '-c',
            `PGPASSWORD="$(cat /run/rentnerproxy/postgres/value)" gosu postgres psql --host=127.0.0.1 --username=rentnerproxy --dbname=rentnerproxy --command="INSERT INTO rentnerproxy.certificates (id, name, source, status, operation) VALUES ('${certificateId}', 'Appliance smoke certificate', 'manual', 'pending', 'idle');" >/dev/null`,
        ])
        const importSource = `const token=await Bun.file('/run/rentnerproxy/controller-token/value').text();const certificatePem=await Bun.file('${certificateDirectory}/leaf.pem').text();const privateKeyPem=await Bun.file('${certificateDirectory}/leaf.key').text();const chainPem=await Bun.file('${certificateDirectory}/ca.pem').text();const response=await fetch('http://127.0.0.1:8081/internal/v1/certificates/${certificateId}/import',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({certificatePem,privateKeyPem,chainPem,requiredDomains:['${hostDomain}']})});process.stdout.write(String(response.status));if(response.status!==200)process.exit(1);`
        assert.equal(
            await command([
                'docker',
                'exec',
                '--user',
                '10001:10001',
                recreatedId,
                'bun',
                '-e',
                importSource,
            ]),
            '200',
        )
        const insertHostSql = `INSERT INTO rentnerproxy.proxy_hosts (id, forward_scheme, forward_host, forward_port, enabled, certificate_id, force_https, verify_upstream_tls) VALUES ('${hostId}', 'http', 'host.docker.internal', ${backendPort}, true, '${certificateId}', false, true); INSERT INTO rentnerproxy.host_domains (id, proxy_host_id, domain) VALUES ('0198d98a-0000-7000-8000-${runId.slice(0, 11)}b', '${hostId}', '${hostDomain}');`
        await command([
            'docker',
            'exec',
            recreatedId,
            'sh',
            '-c',
            `PGPASSWORD="$(cat /run/rentnerproxy/postgres/value)" gosu postgres psql --host=127.0.0.1 --username=rentnerproxy --dbname=rentnerproxy --command="${insertHostSql}" >/dev/null`,
        ])
        const realConfig = {
            version: 7,
            proxyHosts: [
                {
                    id: hostId,
                    domains: [hostDomain],
                    forwardScheme: 'http',
                    forwardHost: 'host.docker.internal',
                    forwardPort: backendPort,
                    certificateId,
                },
            ],
            redirectHosts: [],
            httpSettings: {},
            trustedCas: [],
        }
        const applyRealConfiguration = async (
            configuration: Record<string, unknown>,
            label: string,
        ): Promise<void> => {
            const request = {
                ...configuration,
                revision: 'sha256:' + digest(JSON.stringify(configuration)),
            }
            const response = await controllerCall(
                recreatedId,
                '/internal/v1/proxy/config',
                'PUT',
                request,
            )
            assert.equal(response.status, 200)
            await waitFor(async () => {
                const status = await controllerCall(recreatedId, '/internal/v1/proxy/status', 'GET')
                return status.status === 200 && status.body.includes(request.revision)
            }, label)
        }
        await applyRealConfiguration(realConfig, 'managed certificate configuration apply')
        const assertRealTraffic = async (container: string, label: string): Promise<void> => {
            const httpBody = await command([
                'docker',
                'exec',
                container,
                'curl',
                '--silent',
                '--show-error',
                '--noproxy',
                '*',
                '--header',
                'Host: ' + hostDomain,
                'http://127.0.0.1:8080/appliance-real-path',
            ])
            assert.equal(httpBody, trafficMarker)
            const httpsBody = await command([
                'docker',
                'exec',
                container,
                'curl',
                '--silent',
                '--show-error',
                '--noproxy',
                '*',
                '--insecure',
                '--resolve',
                hostDomain + ':8443:127.0.0.1',
                'https://' + hostDomain + ':8443/appliance-real-path',
            ])
            assert.equal(httpsBody, trafficMarker)
            passed(label)
        }
        await assertRealTraffic(
            recreatedId,
            'real HTTP and HTTPS managed-certificate traffic works',
        )
        const http3CaFile = join(temporaryRoot, 'http3-ca.pem')
        await command([
            'docker',
            'cp',
            recreatedId + ':' + certificateDirectory + '/ca.pem',
            http3CaFile,
        ])
        const assertPublishedQuic = async () => {
            const response = await requestHttp3Client(http3Command, {
                image: http3Image,
                caFile: http3CaFile,
                hostname: hostDomain,
                port: httpsPort,
                path: '/appliance-real-path',
            })
            assertHttp3Response(response, 200, httpsPort)
            assert.ok(response.output.includes(trafficMarker))
        }
        await assertPublishedQuic()
        passed(
            'production appliance serves verified HTTP/3 through published UDP with the public Alt-Svc port',
        )

        const internalHttpStatus = async (path = '/appliance-real-path'): Promise<number> =>
            Number(
                await command([
                    'docker',
                    'exec',
                    recreatedId,
                    'curl',
                    '--silent',
                    '--show-error',
                    '--noproxy',
                    '*',
                    '--output',
                    '/dev/null',
                    '--write-out',
                    '%{http_code}',
                    '--header',
                    'Host: ' + hostDomain,
                    'http://127.0.0.1:8080' + path,
                ]),
            )
        const requestPublishedProtocol = async (
            protocol: '--http1.1' | '--http2' | '--http3-only',
            expectedStatus: number,
        ) => {
            const response = await requestHttp3Client(http3Command, {
                image: http3Image,
                caFile: http3CaFile,
                hostname: hostDomain,
                port: httpsPort,
                path: '/appliance-real-path',
                protocol,
            })
            assert.equal(response.status, expectedStatus)
            assert.equal(
                response.protocol,
                protocol === '--http1.1' ? '1.1' : protocol === '--http2' ? '2' : '3',
            )
            return response
        }

        const managedStatus = await applyCrowdSecMode(recreatedId, 'managed')
        assert.deepEqual(managedStatus, {
            mode: 'managed',
            state: 'connected',
            credentialConfigured: false,
            enforcementActive: true,
            managedEngine: 'ready',
            communityEnabled: false,
            communityState: 'disabled',
            consoleState: 'not_enrolled',
            failureBehavior: 'fail_open',
            clientIpSource: 'caddy',
        })
        await persistCrowdSecMode(recreatedId, 'managed', true)
        const onlineOptIn = await controllerCall(
            recreatedId,
            '/internal/v1/crowdsec/config',
            'PUT',
            {
                mode: 'managed',
                communityEnabled: true,
            },
        )
        assert.equal(onlineOptIn.status, 200)
        await waitForCrowdSec(
            recreatedId,
            (status) =>
                status.mode === 'managed' &&
                status.communityEnabled &&
                status.state === 'connected' &&
                status.managedEngine === 'ready',
            'managed CrowdSec local enforcement during community opt-in',
        )
        assert.equal(
            await command([
                'docker',
                'exec',
                recreatedId,
                'cat',
                '/run/rentnerproxy/crowdsec/desired-mode',
            ]),
            'managed-online',
        )
        await applyCrowdSecMode(recreatedId, 'managed')
        await waitForCrowdSec(
            recreatedId,
            (status) => status.communityState === 'disabled' && status.managedEngine === 'ready',
            'managed CrowdSec offline after community opt-out',
        )
        passed('managed community opt-in and opt-out retain local enforcement')
        assert.deepEqual(await crowdSecEngineUids(recreatedId), ['10003'])
        const managedProcNet = await command([
            'docker',
            'exec',
            recreatedId,
            'sh',
            '-c',
            'cat /proc/net/tcp /proc/net/tcp6',
        ])
        assertLoopbackListeners(managedProcNet, 18080)
        assertLoopbackListeners(managedProcNet, 6060)
        assert.equal(
            await command([
                'docker',
                'exec',
                recreatedId,
                'stat',
                '-c',
                '%a:%u:%g',
                '/var/lib/rentnerproxy/proxy',
            ]),
            '710:10001:10003',
        )
        assert.equal(
            await command([
                'docker',
                'exec',
                recreatedId,
                'stat',
                '-c',
                '%a:%u:%g',
                '/var/lib/rentnerproxy/proxy/logs',
            ]),
            '2750:10001:10003',
        )
        assert.equal(
            await command([
                'docker',
                'exec',
                recreatedId,
                'stat',
                '-c',
                '%a:%u',
                '/var/lib/rentnerproxy/proxy/caddy',
            ]),
            '700:10001',
        )
        assert.equal(
            await command(['docker', 'exec', recreatedId, 'stat', '-c', '%a:%u:%g', accessLogPath]),
            '640:10001:10003',
        )
        await command([
            'docker',
            'exec',
            '--user',
            '10003:10003',
            recreatedId,
            'test',
            '-r',
            accessLogPath,
        ])
        assert.equal(
            await command([
                'docker',
                'exec',
                recreatedId,
                'stat',
                '-c',
                '%a:%U:%G',
                '/var/lib/rentnerproxy/crowdsec/bouncer/caddy-bouncer-key',
            ]),
            '440:root:rentnerproxy',
        )
        assert.equal(
            await command([
                'docker',
                'exec',
                recreatedId,
                'stat',
                '-c',
                '%U:%G',
                '/var/lib/rentnerproxy/crowdsec/data/crowdsec.db',
            ]),
            'crowdsec:crowdsec',
        )
        const acquisitionProbe = {
            httpStatus: -1,
            metricsReachable: false,
            accessLogHits: 0,
            allFileHits: 0,
            caddyParserHits: 0,
            allParserHits: 0,
        }
        try {
            await waitFor(
                async () => {
                    acquisitionProbe.httpStatus = await internalHttpStatus()
                    if (acquisitionProbe.httpStatus !== 200) return false
                    acquisitionProbe.metricsReachable = false
                    const metrics = await command([
                        'docker',
                        'exec',
                        recreatedId,
                        'curl',
                        '--fail',
                        '--silent',
                        '--show-error',
                        '--max-time',
                        '2',
                        'http://127.0.0.1:6060/metrics',
                    ])
                    acquisitionProbe.metricsReachable = true
                    const fileHits =
                        /^cs_filesource_hits_total\{[^}\n]*source="[^"]*\/var\/lib\/rentnerproxy\/proxy\/logs\/access\.log"[^}\n]*\}\s+(\d+(?:\.\d+)?)/mu.exec(
                            metrics,
                        )
                    const parserHits =
                        /^cs_node_hits_ok_total\{[^}\n]*name="crowdsecurity\/caddy-logs"[^}\n]*\}\s+(\d+(?:\.\d+)?)/mu.exec(
                            metrics,
                        )
                    acquisitionProbe.accessLogHits = Number(fileHits?.[1] ?? 0)
                    acquisitionProbe.caddyParserHits = Number(parserHits?.[1] ?? 0)
                    acquisitionProbe.allFileHits = [
                        ...metrics.matchAll(
                            /^cs_filesource_hits_total\{[^}\n]*\}\s+(\d+(?:\.\d+)?)/gmu,
                        ),
                    ].reduce((total, match) => total + Number(match[1]), 0)
                    acquisitionProbe.allParserHits = [
                        ...metrics.matchAll(
                            /^cs_node_hits_ok_total\{[^}\n]*\}\s+(\d+(?:\.\d+)?)/gmu,
                        ),
                    ].reduce((total, match) => total + Number(match[1]), 0)
                    return (
                        acquisitionProbe.accessLogHits > 0 && acquisitionProbe.caddyParserHits > 0
                    )
                },
                'managed CrowdSec acquisition and Caddy parsing',
                30_000,
            )
        } catch (error) {
            const accessLogBytes = await command([
                'docker',
                'exec',
                recreatedId,
                'stat',
                '-c',
                '%s',
                accessLogPath,
            ]).catch(() => '-1')
            const accessLogMode = await command([
                'docker',
                'exec',
                recreatedId,
                'stat',
                '-c',
                '%a:%u:%g',
                accessLogPath,
            ]).catch(() => 'unknown')
            const accessLogReadable = !(await commandFails([
                'docker',
                'exec',
                '--user',
                '10003:10003',
                recreatedId,
                'test',
                '-r',
                accessLogPath,
            ]))
            console.error(
                'Managed CrowdSec acquisition probe: ' +
                    JSON.stringify({
                        ...acquisitionProbe,
                        accessLogBytes: Number(accessLogBytes),
                        accessLogMode,
                        accessLogReadable,
                    }),
            )
            throw error
        }
        const bouncerKeyDigest = await command([
            'docker',
            'exec',
            recreatedId,
            'sha256sum',
            '/var/lib/rentnerproxy/crowdsec/bouncer/caddy-bouncer-key',
        ])
        for (const protocol of ['--http1.1', '--http2', '--http3-only'] as const) {
            const response = await requestPublishedProtocol(protocol, 200)
            assert.ok(response.output.includes(trafficMarker))
        }
        passed(
            'managed CrowdSec runs unprivileged, acquires Caddy logs, stays private, and allows HTTP/1.1, HTTP/2, and HTTP/3',
        )

        await command([
            'docker',
            'exec',
            recreatedId,
            'gosu',
            'crowdsec',
            'cscli',
            '-c',
            '/usr/share/rentnerproxy/crowdsec/config.yaml',
            'decisions',
            'add',
            '--range',
            '0.0.0.0/0',
            '--duration',
            '5m',
            '--reason',
            'rentnerproxy-appliance-smoke',
        ])
        await waitFor(
            async () => (await internalHttpStatus()) === 403,
            'managed CrowdSec decision propagation',
        )
        for (const protocol of ['--http1.1', '--http2', '--http3-only'] as const) {
            await requestPublishedProtocol(protocol, 403)
        }
        assert.notEqual(await internalHttpStatus('/.well-known/acme-challenge/not-present'), 403)

        const forceHttpsConfig = {
            ...realConfig,
            proxyHosts: realConfig.proxyHosts.map((host) => ({ ...host, forceHttps: true })),
        }
        await applyRealConfiguration(forceHttpsConfig, 'CrowdSec with Force HTTPS configuration')
        assert.equal(await internalHttpStatus(), 403)
        await command([
            'docker',
            'exec',
            recreatedId,
            'gosu',
            'crowdsec',
            'cscli',
            '-c',
            '/usr/share/rentnerproxy/crowdsec/config.yaml',
            'decisions',
            'delete',
            '--all',
        ])
        await waitFor(
            async () => (await internalHttpStatus()) === 308,
            'Force HTTPS after CrowdSec decision removal',
        )
        await applyRealConfiguration(realConfig, 'restore non-redirecting real traffic')
        await waitFor(async () => (await internalHttpStatus()) === 200, 'managed CrowdSec allow')
        passed(
            'real managed decisions deny every HTTP protocol before Force HTTPS while ACME remains reachable',
        )

        await command([
            'docker',
            'exec',
            recreatedId,
            'sh',
            '-c',
            'for status_file in /proc/[0-9]*/status; do if grep -q "^Name:[[:space:]]*crowdsec$" "$status_file"; then pid=${status_file#/proc/}; pid=${pid%/status}; kill -TERM "$pid"; fi; done',
        ])
        await waitFor(async () => {
            const status = JSON.parse(
                await command([
                    'docker',
                    'exec',
                    recreatedId,
                    'cat',
                    '/run/rentnerproxy/crowdsec/status.json',
                ]),
            ) as { state?: string; restarts?: number }
            return status.state !== 'ready' || (status.restarts ?? 0) > 0
        }, 'managed CrowdSec restart state')
        assert.equal(await internalHttpStatus(), 200)
        await waitForCrowdSec(
            recreatedId,
            (status) =>
                status.mode === 'managed' &&
                status.state === 'connected' &&
                status.managedEngine === 'ready',
            'managed CrowdSec recovery',
        )
        const recoveredSupervisor = JSON.parse(
            await command([
                'docker',
                'exec',
                recreatedId,
                'cat',
                '/run/rentnerproxy/crowdsec/status.json',
            ]),
        ) as { restarts?: number }
        assert.ok((recoveredSupervisor.restarts ?? 0) >= 1)
        assert.equal(
            await command([
                'docker',
                'exec',
                recreatedId,
                'sha256sum',
                '/var/lib/rentnerproxy/crowdsec/bouncer/caddy-bouncer-key',
            ]),
            bouncerKeyDigest,
        )
        passed('managed LAPI failure stays fail-open and the supervised engine recovers')

        await applyCrowdSecMode(recreatedId, 'disabled')
        assert.deepEqual(await crowdSecEngineUids(recreatedId), [])
        await command([
            'docker',
            'exec',
            recreatedId,
            'test',
            '-s',
            '/var/lib/rentnerproxy/crowdsec/data/crowdsec.db',
        ])
        assert.equal(
            await command([
                'docker',
                'exec',
                recreatedId,
                'sha256sum',
                '/var/lib/rentnerproxy/crowdsec/bouncer/caddy-bouncer-key',
            ]),
            bouncerKeyDigest,
        )
        await applyCrowdSecMode(recreatedId, 'managed')
        const reactivatedKeyDigest = await command([
            'docker',
            'exec',
            recreatedId,
            'sha256sum',
            '/var/lib/rentnerproxy/crowdsec/bouncer/caddy-bouncer-key',
        ])
        assert.notEqual(reactivatedKeyDigest, bouncerKeyDigest)
        passed('mode switches retain managed state and rotate the internal bouncer credential')

        const transientCacheKey = 'rentnerproxy:appliance-smoke:' + runId
        assert.equal(await valkeyCommand(recreatedId, ['SET', transientCacheKey, runId]), 'OK')
        await command([...compose, 'restart', 'rentnerproxy'])
        await waitForHealthy(recreatedId)
        assert.equal(await valkeyCommand(recreatedId, ['GET', transientCacheKey]), '')
        passed('appliance restart discards transient Valkey state')
        await waitForCrowdSec(
            recreatedId,
            (status) =>
                status.mode === 'managed' &&
                status.state === 'connected' &&
                status.managedEngine === 'ready',
            'managed CrowdSec after appliance restart',
        )
        assert.notEqual(
            await command([
                'docker',
                'exec',
                recreatedId,
                'sha256sum',
                '/var/lib/rentnerproxy/crowdsec/bouncer/caddy-bouncer-key',
            ]),
            reactivatedKeyDigest,
        )
        await assertRealTraffic(
            recreatedId,
            'real HTTP and HTTPS traffic survives appliance restart',
        )
        await assertPublishedQuic()
        passed('verified HTTP/3 survives production appliance restart')

        recreatedId = await verifyApplianceStartup({
            temporaryRoot,
            entrypointFile: join(repositoryRoot, 'docker/production/entrypoint.sh'),
            compose,
            httpPort,
            httpsPort,
            managementPort,
            hostDomain,
            trafficMarker,
            ca: await readFile(http3CaFile, 'utf8'),
            command,
            containerId,
            waitForHealthy,
            assertSecurityReady: async (startingId) => {
                const status = await waitForCrowdSec(
                    startingId,
                    (current) =>
                        current.mode === 'managed' &&
                        current.state === 'connected' &&
                        current.managedEngine === 'ready' &&
                        current.enforcementActive,
                    'managed CrowdSec before database/cache readiness',
                )
                assert.equal(status.credentialConfigured, false)
                assert.equal(status.failureBehavior, 'fail_open')
                await command([
                    'docker',
                    'exec',
                    startingId,
                    'test',
                    '-s',
                    '/var/lib/rentnerproxy/crowdsec/bouncer/caddy-bouncer-key',
                ])
            },
            passed,
        })

        const crowdSecBackupDecision = '192.0.2.71'
        await command([
            'docker',
            'exec',
            recreatedId,
            'gosu',
            'crowdsec',
            'cscli',
            '-c',
            '/usr/share/rentnerproxy/crowdsec/config.yaml',
            'decisions',
            'add',
            '--ip',
            crowdSecBackupDecision,
            '--duration',
            '24h',
            '--reason',
            'rentnerproxy-backup-restore-smoke',
        ])
        const crowdSecBackupDecisionList = await command([
            'docker',
            'exec',
            recreatedId,
            'gosu',
            'crowdsec',
            'cscli',
            '-c',
            '/usr/share/rentnerproxy/crowdsec/config.yaml',
            'decisions',
            'list',
            '--ip',
            crowdSecBackupDecision,
            '-o',
            'json',
        ])
        assert.match(crowdSecBackupDecisionList, new RegExp(crowdSecBackupDecision, 'u'))
        passed('managed CrowdSec has a durable reserved-IP decision before backup')

        const crowdSecStateDirectory = '/var/lib/rentnerproxy/crowdsec'
        const communityCredentialFixture =
            'url: https://fixture.crowdsec.invalid\nlogin: smoke-' +
            runId +
            '\npassword: fixture-only\n'
        const consoleCredentialFixture =
            'url: https://console.crowdsec.invalid\ntoken: fixture-only-' + runId + '\n'
        for (const [name, contents] of [
            ['online_api_credentials.yaml', communityCredentialFixture],
            ['console.yaml', consoleCredentialFixture],
        ] as const) {
            const encoded = Buffer.from(contents).toString('base64')
            await command([
                'docker',
                'exec',
                recreatedId,
                'sh',
                '-c',
                `printf '%s' '${encoded}' | base64 -d > '${crowdSecStateDirectory}/credentials/${name}' && chown crowdsec:crowdsec '${crowdSecStateDirectory}/credentials/${name}' && chmod 0600 '${crowdSecStateDirectory}/credentials/${name}'`,
            ])
        }
        const durableCrowdSecFileDigests = new Map<string, string>()
        for (const name of [
            'credentials/local_api_credentials.yaml',
            'credentials/online_api_credentials.yaml',
            'credentials/console.yaml',
            'bouncer/caddy-bouncer-key',
        ]) {
            const path = crowdSecStateDirectory + '/' + name
            durableCrowdSecFileDigests.set(
                name,
                await command(['docker', 'exec', recreatedId, 'sha256sum', path]),
            )
        }
        await assertRealTraffic(
            recreatedId,
            'managed CrowdSec remains active while the persistent decision is prepared for backup',
        )

        const proxyBackupMarker = '/var/lib/rentnerproxy/proxy/appliance-backup-marker'
        await command([
            'docker',
            'exec',
            recreatedId,
            'test',
            '-s',
            '/var/lib/rentnerproxy/proxy/logs/access.log',
        ])
        await command([
            'docker',
            'exec',
            '--user',
            '10001:10001',
            recreatedId,
            'sh',
            '-c',
            `printf %s ${marker} > ${proxyBackupMarker}`,
        ])
        const proxyBackupMarkerDigest = await command([
            'docker',
            'exec',
            recreatedId,
            'sha256sum',
            proxyBackupMarker,
        ])
        const persistenceFixture = await seedAlpha4PersistenceFixture({
            command,
            containerId: recreatedId,
            runId,
        })
        const persistenceSnapshot = await readAlpha4PersistenceSnapshot({
            command,
            containerId: recreatedId,
            fixture: persistenceFixture,
        })
        await assertAlpha4PersistenceRequestDecrypts({
            command,
            containerId: recreatedId,
            fixture: persistenceFixture,
        })
        passed(
            'durable binding jobs, renewal retry metadata and event receipts are present before backup',
        )
        const savedExternalApiKey = 'appliance-smoke-crowdsec-key-' + runId
        const encryptedSavedExternalApiKey = encryptCrowdSecApiKey(
            savedExternalApiKey,
            generatedSecrets.appEncryptionKey!,
        )
        const managedWithSavedExternalConfig = {
            version: 1,
            mode: 'managed',
            communityEnabled: false,
            external: {
                apiUrl: 'https://saved-external.crowdsec.invalid/',
                apiKey: encryptedSavedExternalApiKey,
            },
        }
        const savedExternalConfigSql = JSON.stringify(managedWithSavedExternalConfig)
        await command([
            'docker',
            'exec',
            recreatedId,
            'gosu',
            'postgres',
            'psql',
            '--no-psqlrc',
            '--no-password',
            '--host=/var/run/postgresql',
            '--username=postgres',
            '--dbname=rentnerproxy',
            '--command',
            `INSERT INTO rentnerproxy.system_settings (key, value) VALUES ('crowdsec_configuration_v1', '${savedExternalConfigSql}'::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP;`,
        ])
        const savedExternalConfig = JSON.parse(
            await command([
                'docker',
                'exec',
                recreatedId,
                'gosu',
                'postgres',
                'psql',
                '--no-psqlrc',
                '--no-password',
                '--tuples-only',
                '--no-align',
                '--host=/var/run/postgresql',
                '--username=postgres',
                '--dbname=rentnerproxy',
                '--command',
                "SELECT value::text FROM rentnerproxy.system_settings WHERE key='crowdsec_configuration_v1';",
            ]),
        ) as typeof managedWithSavedExternalConfig
        assert.equal(
            decryptCrowdSecApiKey(
                savedExternalConfig.external.apiKey,
                generatedSecrets.appEncryptionKey!,
            ),
            savedExternalApiKey,
        )
        const betaBackupState = await seedBetaBackupState({
            command,
            containerId: recreatedId,
            runId,
        })
        await assertBetaBackupState({ command, containerId: recreatedId, fixture: betaBackupState })
        const backupRoot = join(temporaryRoot, 'backups')
        await commandWithEnvironment(
            [
                process.execPath,
                'scripts/production-backup.ts',
                '--project',
                project,
                '--output',
                backupRoot,
            ],
            scriptEnvironment,
            900_000,
        )
        await waitForHealthy(await containerId(compose))
        const backupEntries = await readdir(backupRoot)
        assert.equal(backupEntries.length, 1)
        const backupPath = join(backupRoot, backupEntries[0]!)
        const archivedStateFiles = await command([
            'docker',
            'run',
            '--rm',
            '--entrypoint',
            'tar',
            '--volume',
            backupPath + ':/backup:ro',
            imageTag,
            '--list',
            '--file=/backup/controller-state.tar',
        ])
        assert.doesNotMatch(archivedStateFiles, /(?:^|\n)\.\/logs(?:\/|$)/u)
        passed('production backups exclude the request logs from real proxy traffic')
        const archivedCrowdSecFiles = await command([
            'docker',
            'run',
            '--rm',
            '--entrypoint',
            'tar',
            '--volume',
            backupPath + ':/backup:ro',
            imageTag,
            '--list',
            '--file=/backup/crowdsec-state.tar',
        ])
        for (const entry of [
            'data/crowdsec.db',
            'credentials/local_api_credentials.yaml',
            'credentials/online_api_credentials.yaml',
            'credentials/console.yaml',
            'bouncer/caddy-bouncer-key',
        ]) {
            assert.ok(archivedCrowdSecFiles.includes(entry), 'CrowdSec archive omitted ' + entry)
        }
        assert.doesNotMatch(archivedCrowdSecFiles, /(?:^|\n).*\.db-shm\s*$/u)
        passed(
            'production backups archive CrowdSec database, registrations and managed bouncer key',
        )
        if (process.platform !== 'win32') {
            assert.equal((await stat(backupPath)).mode & 0o777, 0o700)
            for (const name of [
                'app-encryption-key',
                'controller-state.tar',
                'crowdsec-state.tar',
                'metadata.json',
                'postgres.dump',
            ]) {
                const file = await stat(join(backupPath, name))
                assert.equal(file.uid, process.getuid?.())
                assert.equal(file.mode & 0o777, 0o600)
            }
        }
        const backupMetadata = JSON.parse(
            await readFile(join(backupPath, 'metadata.json'), 'utf8'),
        ) as {
            applicationEncryptionKey?: { file?: string }
            controllerState?: { archive?: string }
            crowdSecState?: { archive?: string; bytes?: number; sha256?: string }
            deployment?: { publicOrigin?: string; trustedProxyCidrs?: string }
            redis?: string
            version?: number
        }
        assert.equal(backupMetadata.version, 4)
        assert.equal(backupMetadata.redis, 'excluded')
        assert.equal(backupMetadata.applicationEncryptionKey?.file, 'app-encryption-key')
        assert.equal(backupMetadata.controllerState?.archive, 'controller-state.tar')
        assert.equal(backupMetadata.crowdSecState?.archive, 'crowdsec-state.tar')
        assert.equal(
            backupMetadata.crowdSecState?.bytes,
            (await stat(join(backupPath, 'crowdsec-state.tar'))).size,
        )
        assert.equal(
            backupMetadata.crowdSecState?.sha256,
            digest(await readFile(join(backupPath, 'crowdsec-state.tar'))),
        )
        assert.deepEqual(backupMetadata.deployment, {
            publicOrigin,
            trustedProxyCidrs,
        })
        assert.equal(
            (await readFile(join(backupPath, 'app-encryption-key'), 'utf8')).trim(),
            generatedSecrets.appEncryptionKey,
        )

        await command([...compose, 'down', '--remove-orphans'], 180_000)
        await commandWithEnvironment(
            [
                process.execPath,
                'scripts/production-restore.ts',
                '--project',
                restoreProject,
                '--input',
                backupPath,
                '--confirm-replace',
            ],
            scriptEnvironment,
            900_000,
        )
        const restoredId = await containerId(restoreCompose)
        await waitForHealthy(restoredId)
        const restoredCrowdSec = await waitForCrowdSec(
            restoredId,
            (status) =>
                status.mode === 'managed' &&
                status.state === 'connected' &&
                status.managedEngine === 'ready',
            'restored managed CrowdSec state',
        )
        assert.equal(restoredCrowdSec.enforcementActive, true)
        const restoredDecisionList = await command([
            'docker',
            'exec',
            restoredId,
            'gosu',
            'crowdsec',
            'cscli',
            '-c',
            '/usr/share/rentnerproxy/crowdsec/config.yaml',
            'decisions',
            'list',
            '--ip',
            crowdSecBackupDecision,
            '-o',
            'json',
        ])
        assert.match(restoredDecisionList, new RegExp(crowdSecBackupDecision, 'u'))
        const restoredBouncers = await command([
            'docker',
            'exec',
            restoredId,
            'gosu',
            'crowdsec',
            'cscli',
            '-c',
            '/usr/share/rentnerproxy/crowdsec/config.yaml',
            'bouncers',
            'list',
        ])
        assert.match(restoredBouncers, /rentnerproxy-caddy/u)
        await command([
            'docker',
            'exec',
            restoredId,
            'sh',
            '-c',
            'key=$(cat /var/lib/rentnerproxy/crowdsec/bouncer/caddy-bouncer-key); status=$(curl --silent --show-error --max-time 5 --output /dev/null --write-out "%{http_code}" --header "X-Api-Key: $key" "http://127.0.0.1:18080/v1/decisions/stream?startup=true"); test "$status" = 200',
        ])
        for (const [name, expected] of [
            ['data', '700:10003:10003'],
            ['credentials', '700:10003:10003'],
            ['data/crowdsec.db', '640:10003:10003'],
            ['credentials/local_api_credentials.yaml', '600:10003:10003'],
            ['credentials/online_api_credentials.yaml', '600:10003:10003'],
            ['credentials/console.yaml', '600:10003:10003'],
            ['bouncer', '710:0:10001'],
            ['bouncer/caddy-bouncer-key', '440:0:10001'],
        ] as const) {
            assert.equal(
                await command([
                    'docker',
                    'exec',
                    restoredId,
                    'stat',
                    '-c',
                    '%a:%u:%g',
                    crowdSecStateDirectory + '/' + name,
                ]),
                expected,
                'unexpected restored CrowdSec ownership/mode: ' + name,
            )
        }
        for (const name of [
            'credentials/local_api_credentials.yaml',
            'credentials/online_api_credentials.yaml',
            'credentials/console.yaml',
        ]) {
            assert.equal(
                await command([
                    'docker',
                    'exec',
                    restoredId,
                    'sha256sum',
                    crowdSecStateDirectory + '/' + name,
                ]),
                durableCrowdSecFileDigests.get(name),
                'restored CrowdSec credential changed: ' + name,
            )
        }
        const restoredBouncerKey = await command([
            'docker',
            'exec',
            restoredId,
            'cat',
            crowdSecStateDirectory + '/bouncer/caddy-bouncer-key',
        ])
        assert.match(restoredBouncerKey, /^[a-f0-9]{64}$/u)
        await assertRealTraffic(
            restoredId,
            'managed CrowdSec decision, bouncer authorization and proxy traffic survive restore',
        )
        passed(
            'backup restores CrowdSec decisions, credentials and a ready authorized Caddy bouncer',
        )
        await assertBetaBackupState({ command, containerId: restoredId, fixture: betaBackupState })
        passed('backup restores saved Forward Auth configuration and exact NPM importer history')
        const restoredEnvironment = JSON.parse(
            await inspect(restoredId, '{{json .Config.Env}}'),
        ) as string[]
        assert.ok(restoredEnvironment.includes('RENTNERPROXY_PUBLIC_ORIGIN=' + publicOrigin))
        assert.ok(
            restoredEnvironment.includes(
                'RENTNERPROXY_PROXY_TRUSTED_PROXY_CIDRS=' + trustedProxyCidrs,
            ),
        )
        const restoredSavedExternalConfig = JSON.parse(
            await command([
                'docker',
                'exec',
                restoredId,
                'gosu',
                'postgres',
                'psql',
                '--no-psqlrc',
                '--no-password',
                '--tuples-only',
                '--no-align',
                '--host=/var/run/postgresql',
                '--username=postgres',
                '--dbname=rentnerproxy',
                '--command',
                "SELECT value::text FROM rentnerproxy.system_settings WHERE key='crowdsec_configuration_v1';",
            ]),
        ) as typeof savedExternalConfig
        assert.deepEqual(
            restoredSavedExternalConfig.external.apiKey,
            savedExternalConfig.external.apiKey,
        )
        assert.equal(
            decryptCrowdSecApiKey(
                restoredSavedExternalConfig.external.apiKey,
                generatedSecrets.appEncryptionKey!,
            ),
            savedExternalApiKey,
        )
        await assertAlpha4PersistenceFixture({
            command,
            containerId: restoredId,
            fixture: persistenceFixture,
            expected: persistenceSnapshot,
        })
        await assertAlpha4PersistenceRequestDecrypts({
            command,
            containerId: restoredId,
            fixture: persistenceFixture,
        })
        passed(
            'backup restores exact binding jobs, retry states and event journal data with decryptable requests',
        )
        const disasterRestoreSecrets = JSON.parse(
            await command([
                'docker',
                'exec',
                restoredId,
                'bun',
                '-e',
                'const state = await Bun.file("/var/lib/rentnerproxy/bootstrap/secrets-v1.json").json(); process.stdout.write(JSON.stringify(state));',
            ]),
        ) as Record<string, string>
        assert.equal(disasterRestoreSecrets.appEncryptionKey, generatedSecrets.appEncryptionKey)
        assert.match(disasterRestoreSecrets.postgresPassword!, /^[a-f0-9]{64}$/u)
        assert.match(disasterRestoreSecrets.controllerToken!, /^[a-f0-9]{64}$/u)
        assert.equal(
            disasterRestoreSecrets.databaseUrl,
            `postgresql://rentnerproxy:${disasterRestoreSecrets.postgresPassword}@127.0.0.1:5432/rentnerproxy`,
        )
        assert.notEqual(disasterRestoreSecrets.postgresPassword, generatedSecrets.postgresPassword)
        assert.notEqual(disasterRestoreSecrets.controllerToken, generatedSecrets.controllerToken)
        assert.equal(
            await command([
                'docker',
                'exec',
                restoredId,
                'sh',
                '-c',
                `PGPASSWORD="$(cat /run/rentnerproxy/postgres/value)" gosu postgres psql --host=127.0.0.1 --username=rentnerproxy --dbname=rentnerproxy --tuples-only --no-align --command="SELECT marker FROM appliance_compose_smoke WHERE marker = '${marker}';"`,
            ]),
            marker,
        )
        assert.equal(
            await command(['docker', 'exec', restoredId, 'sha256sum', proxyBackupMarker]),
            proxyBackupMarkerDigest,
        )
        passed(
            'backup restores PostgreSQL, controller state, and application identity to a fresh appliance',
        )
        const preflightSecretsDigest = await command([
            'docker',
            'exec',
            restoredId,
            'sha256sum',
            '/var/lib/rentnerproxy/bootstrap/secrets-v1.json',
        ])
        const preflightBouncerKeyDigest = await command([
            'docker',
            'exec',
            restoredId,
            'sha256sum',
            crowdSecStateDirectory + '/bouncer/caddy-bouncer-key',
        ])
        const preflightDatabaseMarker = await command([
            'docker',
            'exec',
            restoredId,
            'sh',
            '-c',
            `PGPASSWORD="$(cat /run/rentnerproxy/postgres/value)" gosu postgres psql --host=127.0.0.1 --username=rentnerproxy --dbname=rentnerproxy --tuples-only --no-align --command="SELECT marker FROM appliance_compose_smoke WHERE marker = '${marker}';"`,
        ])
        async function assertRestorePreflightFailure(
            fixture: string,
            label: string,
            preflightEnvironment = scriptEnvironment,
        ): Promise<void> {
            let rejected = false
            try {
                await commandWithEnvironment(
                    [
                        process.execPath,
                        'scripts/production-restore.ts',
                        '--project',
                        restoreProject,
                        '--input',
                        fixture,
                        '--confirm-replace',
                    ],
                    preflightEnvironment,
                    900_000,
                )
            } catch {
                rejected = true
            }
            assert.equal(rejected, true, label + ' unexpectedly passed restore preflight')
            assert.equal(await containerId(restoreCompose), restoredId)
            await waitForHealthy(restoredId)
            assert.equal(
                await command([
                    'docker',
                    'exec',
                    restoredId,
                    'sh',
                    '-c',
                    `PGPASSWORD="$(cat /run/rentnerproxy/postgres/value)" gosu postgres psql --host=127.0.0.1 --username=rentnerproxy --dbname=rentnerproxy --tuples-only --no-align --command="SELECT marker FROM appliance_compose_smoke WHERE marker = '${marker}';"`,
                ]),
                preflightDatabaseMarker,
                label + ' changed the target database',
            )
            assert.equal(
                await command([
                    'docker',
                    'exec',
                    restoredId,
                    'sha256sum',
                    '/var/lib/rentnerproxy/bootstrap/secrets-v1.json',
                ]),
                preflightSecretsDigest,
                label + ' changed the target secrets',
            )
            assert.equal(
                await command([
                    'docker',
                    'exec',
                    restoredId,
                    'sha256sum',
                    crowdSecStateDirectory + '/bouncer/caddy-bouncer-key',
                ]),
                preflightBouncerKeyDigest,
                label + ' changed the target CrowdSec state',
            )
        }
        const corruptMetadataFixture = join(temporaryRoot, 'backup-corrupt-metadata')
        await cp(backupPath, corruptMetadataFixture, { recursive: true })
        await writeFile(join(corruptMetadataFixture, 'metadata.json'), '{\n', 'utf8')
        await assertRestorePreflightFailure(corruptMetadataFixture, 'corrupt metadata')

        const corruptArchiveFixture = join(temporaryRoot, 'backup-corrupt-crowdsec-archive')
        await cp(backupPath, corruptArchiveFixture, { recursive: true })
        const corruptCrowdSecArchive = await readFile(
            join(corruptArchiveFixture, 'crowdsec-state.tar'),
        )
        const lastArchiveByte = corruptCrowdSecArchive[corruptCrowdSecArchive.length - 1]
        if (lastArchiveByte === undefined) throw new Error('CrowdSec archive is empty.')
        corruptCrowdSecArchive[corruptCrowdSecArchive.length - 1] = lastArchiveByte ^ 1
        await writeFile(join(corruptArchiveFixture, 'crowdsec-state.tar'), corruptCrowdSecArchive)
        await assertRestorePreflightFailure(corruptArchiveFixture, 'corrupt CrowdSec archive')

        const missingArchiveFixture = join(temporaryRoot, 'backup-missing-crowdsec-archive')
        await cp(backupPath, missingArchiveFixture, { recursive: true })
        await rm(join(missingArchiveFixture, 'crowdsec-state.tar'))
        await assertRestorePreflightFailure(missingArchiveFixture, 'missing CrowdSec archive')

        const wrongKeyFixture = join(temporaryRoot, 'backup-wrong-application-key')
        await cp(backupPath, wrongKeyFixture, { recursive: true })
        const wrongApplicationKey = randomBytes(32).toString('base64')
        const wrongApplicationKeyBytes = Buffer.from(wrongApplicationKey)
        await writeFile(join(wrongKeyFixture, 'app-encryption-key'), wrongApplicationKeyBytes)
        const wrongKeyMetadataPath = join(wrongKeyFixture, 'metadata.json')
        const wrongKeyMetadata = JSON.parse(
            await readFile(wrongKeyMetadataPath, 'utf8'),
        ) as typeof backupMetadata & {
            applicationEncryptionKey: { bytes: number; file: string; sha256: string }
        }
        wrongKeyMetadata.applicationEncryptionKey = {
            bytes: wrongApplicationKeyBytes.byteLength,
            file: 'app-encryption-key',
            sha256: digest(wrongApplicationKeyBytes),
        }
        await writeFile(wrongKeyMetadataPath, JSON.stringify(wrongKeyMetadata, null, 2) + '\n')
        await assertRestorePreflightFailure(wrongKeyFixture, 'wrong application encryption key')
        for (const version of [1, 2] as const) {
            const unsupportedFixture = join(temporaryRoot, 'backup-unsupported-v' + version)
            await cp(backupPath, unsupportedFixture, { recursive: true })
            const unsupportedMetadataPath = join(unsupportedFixture, 'metadata.json')
            const unsupportedMetadata = JSON.parse(
                await readFile(unsupportedMetadataPath, 'utf8'),
            ) as typeof backupMetadata
            unsupportedMetadata.version = version
            await writeFile(
                unsupportedMetadataPath,
                JSON.stringify(unsupportedMetadata, null, 2) + '\n',
            )
            await assertRestorePreflightFailure(
                unsupportedFixture,
                'unsupported synthetic v' + version + ' metadata',
            )
        }
        passed(
            'invalid backups leave the running target database, secrets and CrowdSec state untouched',
        )

        const changedPublicOrigin = 'https://changed.appliance-smoke.invalid'
        const changedTrustedProxyCidrs = '192.0.2.0/24'
        const changedDeploymentEnvironment: NodeJS.ProcessEnv = {
            ...scriptEnvironment,
            RENTNERPROXY_PUBLIC_ORIGIN: changedPublicOrigin,
            RENTNERPROXY_PROXY_TRUSTED_PROXY_CIDRS: changedTrustedProxyCidrs,
        }
        await assertRestorePreflightFailure(
            backupPath,
            'deployment mismatch',
            changedDeploymentEnvironment,
        )
        passed('restore rejects a deployment mismatch before stopping or replacing the target')
        await command([...restoreCompose, 'stop', '--timeout', '30', 'rentnerproxy'], 180_000)
        await commandWithEnvironment(
            [
                process.execPath,
                'scripts/production-restore.ts',
                '--project',
                deploymentChangeProject,
                '--input',
                backupPath,
                '--confirm-replace',
                '--allow-deployment-change',
            ],
            changedDeploymentEnvironment,
            900_000,
        )
        const deploymentChangeId = await containerId(deploymentChangeCompose)
        await waitForHealthy(deploymentChangeId)
        const deploymentChangeRuntime = JSON.parse(
            await inspect(deploymentChangeId, '{{json .Config.Env}}'),
        ) as string[]
        assert.ok(
            deploymentChangeRuntime.includes('RENTNERPROXY_PUBLIC_ORIGIN=' + changedPublicOrigin),
        )
        assert.ok(
            deploymentChangeRuntime.includes(
                'RENTNERPROXY_PROXY_TRUSTED_PROXY_CIDRS=' + changedTrustedProxyCidrs,
            ),
        )
        await assertRealTraffic(
            deploymentChangeId,
            'an explicitly allowed deployment change preserves real traffic',
        )
        await command(
            [...deploymentChangeCompose, 'down', '--volumes', '--remove-orphans'],
            180_000,
        )
        passed(
            'an explicit deployment-change option permits restoring to the new deployment settings',
        )
        await command([...restoreCompose, 'start', 'rentnerproxy'], 180_000)
        await waitForHealthy(restoredId)

        await assertRealTraffic(
            restoredId,
            'v4 restore heals Caddy from desired DB and preserves HTTP/HTTPS traffic',
        )
        await assertPublishedQuic()
        passed(
            'verified HTTP/3 and deployment origin survive restore with trusted proxy configuration',
        )
        await command([
            'docker',
            'exec',
            restoredId,
            'rm',
            '-f',
            '/var/lib/rentnerproxy/bootstrap/secrets-v1.json',
        ])
        await command([...restoreCompose, 'restart', 'rentnerproxy'])
        await waitFor(
            async () => !(await containerHealth(restoredId)).includes('|healthy|'),
            'fail-closed startup after bootstrap state removal',
            150_000,
        )
        passed('removing bootstrap state while PostgreSQL data remains fails closed')
        await commandFails([...restoreCompose, 'down', '--volumes', '--remove-orphans'], 180_000)

        if (process.platform === 'linux') {
            const dockerExecutable = await command(['which', 'docker'])
            const dockerShimDirectory = join(temporaryRoot, 'restore-docker-shim')
            await mkdir(dockerShimDirectory, { recursive: true })
            const dockerShim = join(dockerShimDirectory, 'docker')
            await writeFile(
                dockerShim,
                `#!/bin/sh\ncase " $* " in\n  *"RENTNERPROXY_RESTORE_PHASE=database"*)\n    "${dockerExecutable}" "$@"\n    status=$?\n    if [ "$status" -eq 0 ]; then exit 143; fi\n    exit "$status"\n    ;;\nesac\nexec "${dockerExecutable}" "$@"\n`,
                { mode: 0o700 },
            )
            const interruptedEnvironment: NodeJS.ProcessEnv = {
                ...scriptEnvironment,
                PATH: dockerShimDirectory + ':' + (scriptEnvironment.PATH ?? ''),
            }
            let interrupted = false
            try {
                await commandWithEnvironment(
                    [
                        process.execPath,
                        'scripts/production-restore.ts',
                        '--project',
                        restoreProject,
                        '--input',
                        backupPath,
                        '--confirm-replace',
                    ],
                    interruptedEnvironment,
                    900_000,
                )
            } catch {
                interrupted = true
            }
            assert.equal(interrupted, true, 'restore phase shim did not interrupt after PostgreSQL')
            assert.equal(
                await command([...restoreCompose, 'ps', '--status', 'running', '--quiet']),
                '',
            )
            const restoreJournalPath = '/var/lib/rentnerproxy/bootstrap/production-restore-v1.json'
            const restoreJournal = JSON.parse(
                await command([
                    ...restoreCompose,
                    'run',
                    '--no-TTY',
                    '--rm',
                    '--no-deps',
                    '--entrypoint',
                    'cat',
                    'rentnerproxy',
                    restoreJournalPath,
                ]),
            ) as { backupId?: string; version?: number }
            assert.deepEqual(restoreJournal, {
                version: 1,
                backupId: digest(await readFile(join(backupPath, 'metadata.json'))),
            })
            let resumeRequired = false
            try {
                await commandWithEnvironment(
                    [
                        process.execPath,
                        'scripts/production-restore.ts',
                        '--project',
                        restoreProject,
                        '--input',
                        backupPath,
                        '--confirm-replace',
                    ],
                    scriptEnvironment,
                    900_000,
                )
            } catch {
                resumeRequired = true
            }
            assert.equal(
                resumeRequired,
                true,
                'restore without --resume ignored the pending journal',
            )
            assert.deepEqual(
                JSON.parse(
                    await command([
                        ...restoreCompose,
                        'run',
                        '--no-TTY',
                        '--rm',
                        '--no-deps',
                        '--entrypoint',
                        'cat',
                        'rentnerproxy',
                        restoreJournalPath,
                    ]),
                ),
                restoreJournal,
            )
            await commandWithEnvironment(
                [
                    process.execPath,
                    'scripts/production-restore.ts',
                    '--project',
                    restoreProject,
                    '--input',
                    backupPath,
                    '--confirm-replace',
                    '--resume',
                ],
                scriptEnvironment,
                900_000,
            )
            const resumedRestoreId = await containerId(restoreCompose)
            await waitForHealthy(resumedRestoreId)
            await waitForCrowdSec(
                resumedRestoreId,
                (status) =>
                    status.mode === 'managed' &&
                    status.state === 'connected' &&
                    status.managedEngine === 'ready',
                'resumed managed CrowdSec restore',
            )
            const resumedDecisionList = await command([
                'docker',
                'exec',
                resumedRestoreId,
                'gosu',
                'crowdsec',
                'cscli',
                '-c',
                '/usr/share/rentnerproxy/crowdsec/config.yaml',
                'decisions',
                'list',
                '--ip',
                crowdSecBackupDecision,
                '-o',
                'json',
            ])
            assert.match(resumedDecisionList, new RegExp(crowdSecBackupDecision, 'u'))
            await assertRealTraffic(
                resumedRestoreId,
                'an interrupted restore resumes from its journal and restores CrowdSec enforcement',
            )
            await command([
                'docker',
                'exec',
                resumedRestoreId,
                'test',
                '!',
                '-e',
                restoreJournalPath,
            ])
            passed('database-phase interruption requires and completes same-backup restore resume')
        }

        await command([...restoreCompose, 'down', '--volumes', '--remove-orphans'], 180_000)
        for (const verifyUpgrade of [verifyAlpha1Upgrade, verifyAlpha3Upgrade]) {
            await verifyUpgrade({
                imageTag,
                temporaryRoot,
                upstreamPort: backendPort,
                trafficMarker,
                envFile,
                environment: scriptEnvironment,
                command,
                commandWithEnvironment,
                passed,
            })
        }
    } finally {
        backend?.stop(true)
        await commandFails([...compose, 'down', '--volumes', '--remove-orphans'], 180_000)
        await commandFails([...restoreCompose, 'down', '--volumes', '--remove-orphans'], 180_000)
        await commandFails(
            [...deploymentChangeCompose, 'down', '--volumes', '--remove-orphans'],
            180_000,
        )
        await commandFails(['docker', 'image', 'rm', '--force', imageTag], 180_000)
        await commandFails(['docker', 'image', 'rm', http3Image], 180_000)
        await rm(temporaryRoot, { force: true, recursive: true })
    }
}

try {
    await runSmoke()
    console.log('Appliance Compose smoke passed: ' + assertions + ' assertions')
} catch (error) {
    // Assertion messages can contain generated secret values. Keep the type and source location.
    console.error(
        'Appliance Compose smoke failed: ' +
            (error instanceof Error ? error.name : 'unknown error'),
    )
    const locations =
        error instanceof Error
            ? error.stack?.matchAll(
                  /(appliance-compose-smoke|alpha1-upgrade-smoke|alpha1-upgrade-fixture|restore-rollback-smoke)\.ts:(\d+):(\d+)/gu,
              )
            : undefined
    if (locations) {
        for (const location of [...locations].slice(0, 6)) {
            const locationRoot =
                location[1] === 'appliance-compose-smoke' ? '.github/scripts/ci' : 'scripts'
            console.error(
                'at ' + locationRoot + '/' + location[1] + '.ts:' + location[2] + ':' + location[3],
            )
        }
    }
    process.exitCode = 1
}
