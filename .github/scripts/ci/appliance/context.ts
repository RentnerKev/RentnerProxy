import { runSmokeProcess } from '../../../../scripts/smoke/process.ts'
import { waitForSmoke } from '../../../../scripts/smoke/wait.ts'
import type { CrowdSecMode, CrowdSecRuntimeStatus } from '../Types/appliance-compose-smoke.types.ts'
import assert from 'node:assert/strict'
import { dockerBuildDiagnostic } from '../../../../scripts/smoke/docker-build-diagnostics.ts'
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
    restoreSmokeDiagnostic,
    smokeCompose,
    smokeDockerArguments,
} from '../../../../scripts/smoke/resources.ts'
import { sharedSmokeImage } from '../../../../scripts/smoke/images.ts'

const repositoryRoot = fileURLToPath(new URL('../../../..', import.meta.url))
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
    const { exitCode, stdout, stderr, timedOut } = await runSmokeProcess(
        smokeDockerArguments(argumentsList),
        { cwd: repositoryRoot, env: commandEnvironment, timeoutMs },
    )
    if (exitCode !== 0 || timedOut) {
        if (argumentsList[0] === 'docker' && argumentsList[1] === 'build')
            console.error(dockerBuildDiagnostic(stderr))
        const diagnostic = restoreSmokeDiagnostic(stderr)
        if (diagnostic) console.error(diagnostic)
        throw new Error('smoke command failed: ' + argumentsList.slice(0, 2).join(' '))
    }
    return (stdout || stderr).trim()
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
    const { exitCode, stdout, stderr, timedOut } = await runSmokeProcess(
        smokeDockerArguments(argumentsList),
        { cwd: repositoryRoot, env: environment, timeoutMs },
    )
    if (exitCode !== 0 || timedOut) {
        const diagnostic = restoreSmokeDiagnostic(stderr)
        if (diagnostic) console.error(diagnostic)
        throw new Error(
            diagnostic ?? 'smoke command failed: ' + argumentsList.slice(0, 2).join(' '),
        )
    }
    return (stdout || stderr).trim()
}

async function commandFails(argumentsList: string[], timeoutMs = 120_000): Promise<boolean> {
    try {
        await command(argumentsList, timeoutMs)
        return false
    } catch {
        return true
    }
}

function waitFor(check: () => Promise<boolean>, label: string, timeoutMs = 120_000): Promise<void> {
    return waitForSmoke(check, {
        timeoutMs,
        intervalMs: 500,
        timeoutError: () => new Error('timed out waiting for ' + label),
    })
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

export async function createApplianceSmokeContext() {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'rentnerproxy-appliance-smoke-'))
    const envFile = join(temporaryRoot, 'smtp.env')
    const temporaryComposeFile = join(temporaryRoot, 'docker-compose.yml')
    const imageTag = sharedSmokeImage('appliance') ?? 'rentnerproxy-appliance-smoke:' + runId
    const http3Image = sharedSmokeImage('http3-client') ?? 'rentnerproxy-appliance-http3:' + runId
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

    return {
        repositoryRoot,
        productionDockerfile,
        accessLogPath,
        runId,
        project,
        publicOrigin,
        trustedProxyCidrs,
        smtpEnvironment,
        smtpNames,
        passed,
        command,
        http3Command,
        valkeyCommand,
        commandWithEnvironment,
        commandFails,
        waitFor,
        availableLoopbackPort,
        containerId,
        inspect,
        containerHealth,
        waitForHealthy,
        httpStatus,
        controllerCall,
        parseCrowdSecStatus,
        waitForCrowdSec,
        persistCrowdSecMode,
        applyCrowdSecMode,
        crowdSecEngineUids,
        digest,
        encryptCrowdSecApiKey,
        decryptCrowdSecApiKey,
        listenerAddresses,
        assertLoopbackListeners,
        temporaryRoot,
        imageTag,
        http3Image,
        volumeName,
        inheritedVolumeName,
        httpPort,
        managementPort,
        httpsPort,
        compose,
        restoreProject,
        restoreCompose,
        deploymentChangeProject,
        deploymentChangeCompose,
        get backend() {
            return backend
        },
        set backend(value: typeof backend) {
            backend = value
        },
        scriptEnvironment,
    }
}

// Preserve accessors so captured helpers and cleanup observe recreated resource handles.
export function extendSmokeContext<T extends object, U extends object>(
    context: T,
    values: U,
): T & U {
    return Object.defineProperties(context, Object.getOwnPropertyDescriptors(values)) as T & U
}

export { assertions }
