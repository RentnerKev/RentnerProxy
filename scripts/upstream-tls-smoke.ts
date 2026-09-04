// oxlint-disable no-await-in-loop -- bounded readiness polling must await each probe.
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createProxyRuntimeSnapshot } from '../web/src/server/ProxyRuntime/proxy-runtime-snapshot'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const runId = randomUUID().replaceAll('-', '').slice(0, 12)
const network = 'rentnerproxy-upstream-tls-' + runId
const runtimeContainer = network + '-runtime'
const backendContainer = network + '-backend'
const stateVolume = network + '-state'
const runtimeImage = network + ':runtime'
const token = randomBytes(32).toString('hex')
const openrestyImage =
    'openresty/openresty:1.31.1.1-2-bookworm@sha256:f03133864fb753a546a5393305a909296fae094725d0271fa07a4c6508ea4219'
const tempDirectory = await mkdtemp(join(tmpdir(), 'rentnerproxy-upstream-tls-smoke-'))
let assertions = 0
let httpPort = 0
let controllerPort = 0

type JsonObject = Record<string, any>
type UpstreamTls = {
    readonly verify: boolean
    readonly serverName: string | null
    readonly trustedCaId: string | null
}
type ProxyHost = {
    readonly id: string
    readonly domains: readonly string[]
    readonly forwardScheme: 'http' | 'https'
    readonly forwardHost: string
    readonly forwardPort: number
    readonly advancedConfig?: string
    readonly upstreamTls?: UpstreamTls
}
type TrustedCa = {
    readonly id: string
    readonly pem: string
    readonly fingerprintSha256: string
}
type Snapshot = {
    readonly version: 1 | 5
    readonly revision: string
    readonly proxyHosts: readonly ProxyHost[]
    readonly httpSettings?: Record<string, never>
    readonly trustedCas?: readonly TrustedCa[]
}

async function command(
    args: readonly string[],
    options: { readonly inherit?: boolean; readonly timeoutMs?: number } = {},
): Promise<string> {
    const child = Bun.spawn({
        cmd: [...args],
        cwd: repositoryRoot,
        stdin: 'ignore',
        stdout: options.inherit ? 'inherit' : 'pipe',
        stderr: options.inherit ? 'inherit' : 'pipe',
    })
    const timeout = setTimeout(() => child.kill(), options.timeoutMs ?? 30_000)
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
        if (exitCode !== 0) throw new Error('Smoke command failed: ' + args.slice(0, 3).join(' '))
        return (output || errors).trim()
    } finally {
        clearTimeout(timeout)
    }
}

async function waitFor(
    check: () => Promise<boolean>,
    label: string,
    timeoutMs = 45_000,
): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        try {
            if (await check()) return
        } catch {
            // Docker containers and the controller may still be starting.
        }
        await Bun.sleep(250)
    }
    throw new Error('Timed out waiting for ' + label)
}

function passed(label: string): void {
    assertions += 1
    console.log('PASS ' + label)
}

function uuidV7(): string {
    const bytes = randomBytes(16)
    const timestamp = BigInt(Date.now())
    bytes[0] = Number((timestamp >> 40n) & 0xffn)
    bytes[1] = Number((timestamp >> 32n) & 0xffn)
    bytes[2] = Number((timestamp >> 24n) & 0xffn)
    bytes[3] = Number((timestamp >> 16n) & 0xffn)
    bytes[4] = Number((timestamp >> 8n) & 0xffn)
    bytes[5] = Number(timestamp & 0xffn)
    bytes[6] = (bytes[6]! & 0x0f) | 0x70
    bytes[8] = (bytes[8]! & 0x3f) | 0x80
    const hex = Buffer.from(bytes).toString('hex')
    return (
        hex.slice(0, 8) +
        '-' +
        hex.slice(8, 12) +
        '-' +
        hex.slice(12, 16) +
        '-' +
        hex.slice(16, 20) +
        '-' +
        hex.slice(20)
    )
}

function hashRevision(value: unknown): string {
    return 'sha256:' + new Bun.CryptoHasher('sha256').update(JSON.stringify(value)).digest('hex')
}

function canonicalHost(host: ProxyHost): ProxyHost {
    return {
        id: host.id,
        domains: [...host.domains].toSorted(),
        forwardScheme: host.forwardScheme,
        forwardHost: host.forwardHost,
        forwardPort: host.forwardPort,
        ...(host.advancedConfig ? { advancedConfig: host.advancedConfig } : {}),
        ...(host.upstreamTls ? { upstreamTls: host.upstreamTls } : {}),
    }
}

function createHttpSnapshot(host: ProxyHost): Snapshot {
    const canonical = { version: 1 as const, proxyHosts: [canonicalHost(host)] }
    return { ...canonical, revision: hashRevision(canonical) }
}

function createHttpsSnapshot(host: ProxyHost, trustedCas: readonly TrustedCa[] = []): Snapshot {
    const canonical = {
        version: 5 as const,
        proxyHosts: [canonicalHost(host)],
        httpSettings: {},
        trustedCas: [...trustedCas].toSorted((left, right) => left.id.localeCompare(right.id)),
    }
    return { ...canonical, revision: hashRevision(canonical) }
}

function publishedPort(output: string): number {
    const match = /(?:127\.0\.0\.1|0\.0\.0\.0):([0-9]+)/u.exec(output)
    const port = Number(match?.[1])
    assert.ok(port > 0 && port <= 65_535)
    return port
}

async function openssl(args: readonly string[]): Promise<string> {
    const mapped = args.map((value) =>
        value.startsWith(tempDirectory)
            ? '/certs/' + value.slice(tempDirectory.length).replaceAll('\\', '/')
            : value,
    )
    return command([
        'docker',
        'run',
        '--rm',
        '--volume',
        tempDirectory + ':/certs',
        '--entrypoint',
        '/usr/bin/openssl',
        openrestyImage,
        ...mapped,
    ])
}

async function createCa(prefix: string, commonName: string): Promise<string> {
    const caPath = join(tempDirectory, prefix + '.pem')
    await openssl([
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        join(tempDirectory, prefix + '.key'),
        '-out',
        caPath,
        '-days',
        '1',
        '-subj',
        '/CN=' + commonName,
        '-addext',
        'basicConstraints=critical,CA:TRUE',
        '-addext',
        'keyUsage=critical,keyCertSign,cRLSign',
    ])
    return caPath
}

async function createBackendCertificate(prefix: string, caPrefix: string): Promise<void> {
    const csr = join(tempDirectory, prefix + '.csr')
    const extensionPath = join(tempDirectory, prefix + '.ext')
    await writeFile(
        extensionPath,
        '[v3_req]\nsubjectAltName=DNS:backend.test\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n',
    )
    await openssl([
        'req',
        '-new',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        join(tempDirectory, prefix + '.key'),
        '-out',
        csr,
        '-subj',
        '/CN=backend.test',
    ])
    await openssl([
        'x509',
        '-req',
        '-in',
        csr,
        '-CA',
        join(tempDirectory, caPrefix + '.pem'),
        '-CAkey',
        join(tempDirectory, caPrefix + '.key'),
        '-CAcreateserial',
        '-out',
        join(tempDirectory, prefix + '.pem'),
        '-days',
        '1',
        '-sha256',
        '-extfile',
        extensionPath,
        '-extensions',
        'v3_req',
    ])
}

async function writeBackendConfig(prefix: string): Promise<string> {
    const path = join(tempDirectory, prefix + '.conf')
    const lines = [
        'events {}',
        'http {',
        '    access_log off;',
        '    error_log stderr warn;',
        '    server {',
        '        listen 8080;',
        '        server_name _;',
        '        default_type text/plain;',
        '        return 200 "backend-http-ok\\n";',
        '    }',
        '    server {',
        '        listen 8443 ssl;',
        '        server_name backend.test;',
        '        ssl_certificate /certs/' + prefix + '.pem;',
        '        ssl_certificate_key /certs/' + prefix + '.key;',
        '        ssl_protocols TLSv1.2 TLSv1.3;',
        '        default_type text/plain;',
        '        return 200 "backend-' + prefix + ' sni=$ssl_server_name\\n";',
        '    }',
        '}',
        '',
    ]
    await writeFile(path, lines.join(String.fromCharCode(10)))
    return path
}

async function startBackend(configPath: string): Promise<void> {
    await command([
        'docker',
        'run',
        '--detach',
        '--name',
        backendContainer,
        '--network',
        network,
        '--network-alias',
        'backend-tls',
        '--network-alias',
        'backend.test',
        '--volume',
        tempDirectory + ':/certs:ro',
        '--entrypoint',
        '/usr/local/openresty/nginx/sbin/nginx',
        openrestyImage,
        '-p',
        '/usr/local/openresty/nginx/',
        '-c',
        '/certs/' + basename(configPath),
        '-g',
        'daemon off;',
    ])
    await waitFor(async () => {
        return (
            (await command(['docker', 'inspect', '-f', '{{.State.Running}}', backendContainer])) ===
            'true'
        )
    }, 'HTTPS backend')
}

async function controllerRequest(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers)
    headers.set('authorization', 'Bearer ' + token)
    return fetch('http://127.0.0.1:' + controllerPort + path, { ...init, headers })
}

async function controllerJson(path: string, init: RequestInit = {}): Promise<JsonObject> {
    const response = await controllerRequest(path, init)
    const body = await response.text()
    let parsed: JsonObject = {}
    try {
        parsed = JSON.parse(body) as JsonObject
    } catch {
        // Assertions use the status when an endpoint returns no JSON.
    }
    return { httpStatus: response.status, ...parsed }
}

async function apply(snapshot: Snapshot): Promise<JsonObject> {
    return controllerJson('/internal/v1/proxy/config', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(snapshot),
    })
}

async function waitForRevision(revision: string): Promise<void> {
    await waitFor(async () => {
        const status = await controllerJson('/internal/v1/proxy/status')
        return (
            status.httpStatus === 200 &&
            status.running === true &&
            status.activeRevision === revision
        )
    }, 'active proxy revision')
}

async function proxyRequest(
    host: string,
): Promise<{ readonly status: number; readonly body: string }> {
    const response = await fetch('http://127.0.0.1:' + httpPort + '/', { headers: { host } })
    return { status: response.status, body: await response.text() }
}

async function waitForProxyBody(
    host: string,
    expectedStatus: number,
    expectedBody: RegExp,
    label: string,
): Promise<void> {
    await waitFor(async () => {
        const response = await proxyRequest(host)
        return response.status === expectedStatus && expectedBody.test(response.body)
    }, label)
}
async function activeConfig(): Promise<string> {
    const result = await controllerJson('/internal/v1/proxy/config')
    assert.equal(result.httpStatus, 200)
    assert.equal(typeof result.config, 'string')
    return result.config as string
}

async function validateCa(pem: string): Promise<TrustedCa> {
    const result = await controllerJson('/internal/v1/trusted-cas/validate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pem }),
    })
    assert.equal(result.httpStatus, 200)
    assert.equal(typeof result.pem, 'string')
    assert.match(result.fingerprintSha256, /^sha256:[a-f0-9]{64}$/u)
    return {
        id: uuidV7(),
        pem: result.pem as string,
        fingerprintSha256: result.fingerprintSha256 as string,
    }
}

async function runSmoke(): Promise<void> {
    let caOnePath = ''
    let caTwoPath = ''
    try {
        await command(['docker', 'version', '--format', '{{.Server.Version}}'])
        await command(
            [
                'docker',
                'build',
                '--file',
                'docker/proxy-runtime/Dockerfile',
                '--tag',
                runtimeImage,
                '.',
            ],
            { inherit: true, timeoutMs: 600_000 },
        )
        await command(['docker', 'network', 'create', network])
        caOnePath = await createCa('ca-one', 'RentnerProxy upstream smoke CA one')
        caTwoPath = await createCa('ca-two', 'RentnerProxy upstream smoke CA two')
        await createBackendCertificate('backend-one', 'ca-one')
        await createBackendCertificate('backend-two', 'ca-two')
        const backendOneConfig = await writeBackendConfig('backend-one')
        const backendTwoConfig = await writeBackendConfig('backend-two')
        await command([
            'docker',
            'run',
            '--detach',
            '--name',
            runtimeContainer,
            '--network',
            network,
            '--volume',
            stateVolume + ':/var/lib/rentnerproxy/proxy',
            '--publish',
            '127.0.0.1::8080',
            '--publish',
            '127.0.0.1::8081',
            '--publish',
            '127.0.0.1::8443',
            '--env',
            'RENTNERPROXY_CONTROLLER_TOKEN=' + token,
            '--env',
            'RENTNERPROXY_SYSTEM_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt',
            runtimeImage,
        ])
        httpPort = publishedPort(await command(['docker', 'port', runtimeContainer, '8080/tcp']))
        controllerPort = publishedPort(
            await command(['docker', 'port', runtimeContainer, '8081/tcp']),
        )
        await waitFor(
            async () => (await fetch('http://127.0.0.1:' + controllerPort + '/health')).ok,
            'controller',
        )
        await startBackend(backendOneConfig)
        const backendIp = await command([
            'docker',
            'inspect',
            '-f',
            '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}',
            backendContainer,
        ])
        assert.match(backendIp, /^(?:\d{1,3}\.){3}\d{1,3}$/u)

        const httpHost: ProxyHost = {
            id: uuidV7(),
            domains: ['http-upstream.test'],
            forwardScheme: 'http',
            forwardHost: backendIp,
            forwardPort: 8080,
        }
        const httpSnapshot = createHttpSnapshot(httpHost)
        const httpApply = await apply(httpSnapshot)
        assert.equal(httpApply.httpStatus, 200)
        await waitForRevision(httpSnapshot.revision)
        const httpResponse = await proxyRequest('http-upstream.test')
        assert.equal(httpResponse.status, 200)
        assert.match(httpResponse.body, /backend-http-ok/u)
        assert.equal((await activeConfig()).includes('proxy_ssl_'), false)
        passed('HTTP upstream reaches a real backend and has no TLS directives')

        const secureHost: ProxyHost = {
            id: uuidV7(),
            domains: ['secure-upstream.test'],
            forwardScheme: 'https',
            forwardHost: backendIp,
            forwardPort: 8443,
            upstreamTls: { verify: true, serverName: 'backend.test', trustedCaId: null },
        }
        const systemSnapshot = createHttpsSnapshot(secureHost)
        const systemApply = await apply(systemSnapshot)
        assert.equal(systemApply.httpStatus, 200)
        await waitForRevision(systemSnapshot.revision)
        await waitForProxyBody('secure-upstream.test', 502, /./u, 'system-trust rejection route')
        const systemConfig = await activeConfig()
        assert.match(systemConfig, /proxy_ssl_verify on;/u)
        assert.match(systemConfig, /proxy_ssl_server_name on;/u)
        assert.match(systemConfig, /proxy_ssl_name backend\.test;/u)
        assert.match(systemConfig, /proxy_ssl_verify_depth 5;/u)
        assert.match(
            systemConfig,
            /proxy_ssl_trusted_certificate \/etc\/ssl\/certs\/ca-certificates\.crt;/u,
        )
        passed('HTTPS upstream with an unknown CA is rejected against the explicit system bundle')

        const caOne = await validateCa(await readFile(caOnePath, 'utf8'))
        const customHost: ProxyHost = {
            ...secureHost,
            upstreamTls: { verify: true, serverName: 'backend.test', trustedCaId: caOne.id },
        }
        const customSnapshot = createHttpsSnapshot(customHost, [caOne])
        const runtimeCustomSnapshot = createProxyRuntimeSnapshot(
            [{ ...customHost, enabled: true }],
            {},
            [caOne],
        )
        assert.deepEqual(runtimeCustomSnapshot, customSnapshot)
        passed('TypeScript snapshot builder matches the Rust runtime payload contract')
        const customApply = await apply(customSnapshot)
        assert.equal(customApply.httpStatus, 200)
        await waitForRevision(customSnapshot.revision)
        await waitForProxyBody(
            'secure-upstream.test',
            200,
            /backend-one.*sni=backend\.test/u,
            'custom CA route with explicit SNI',
        )
        const customConfig = await activeConfig()
        assert.match(customConfig, /proxy_ssl_trusted_certificate /u)
        assert.equal(customConfig.includes('/etc/ssl/certs/ca-certificates.crt'), false)
        passed('custom CA verifies the IP-targeted HTTPS upstream and backend observes correct SNI')

        const automaticDnsHost: ProxyHost = {
            id: uuidV7(),
            domains: ['automatic-dns-upstream.test'],
            forwardScheme: 'https',
            forwardHost: 'backend.test',
            forwardPort: 8443,
            upstreamTls: { verify: true, serverName: null, trustedCaId: caOne.id },
        }
        const automaticDnsSnapshot = createHttpsSnapshot(automaticDnsHost, [caOne])
        assert.equal((await apply(automaticDnsSnapshot)).httpStatus, 200)
        await waitForRevision(automaticDnsSnapshot.revision)
        await waitForProxyBody(
            'automatic-dns-upstream.test',
            200,
            /backend-one/u,
            'automatic DNS identity HTTPS route',
        )
        const automaticDnsResponse = await proxyRequest('automatic-dns-upstream.test')
        assert.match(automaticDnsResponse.body, /sni=backend\.test/u)
        passed('DNS target with automatic identity verifies and sends backend.test SNI')

        const wrongNameSnapshot = createHttpsSnapshot(
            {
                ...customHost,
                upstreamTls: { verify: true, serverName: 'wrong.test', trustedCaId: caOne.id },
            },
            [caOne],
        )
        const wrongNameApply = await apply(wrongNameSnapshot)
        assert.equal(wrongNameApply.httpStatus, 200)
        await waitForRevision(wrongNameSnapshot.revision)
        await waitForProxyBody(
            'secure-upstream.test',
            502,
            /./u,
            'wrong TLS identity rejection route',
        )
        passed('correct CA with a wrong TLS identity is rejected')

        const restoreCustom = await apply(customSnapshot)
        assert.equal(restoreCustom.httpStatus, 200)
        await waitForRevision(customSnapshot.revision)
        await waitForProxyBody(
            'secure-upstream.test',
            200,
            /backend-one/u,
            'restored custom HTTPS route',
        )
        const noServerName = createHttpsSnapshot(
            {
                ...customHost,
                upstreamTls: { verify: true, serverName: null, trustedCaId: caOne.id },
            },
            [caOne],
        )
        assert.equal((await apply(noServerName)).httpStatus, 422)
        assert.equal(
            (await controllerJson('/internal/v1/proxy/status')).activeRevision,
            customSnapshot.revision,
        )
        await waitForProxyBody(
            'secure-upstream.test',
            200,
            /backend-one/u,
            'HTTPS route after rejected no-server-name apply',
        )
        passed('verified IP upstream without an explicit DNS name fails closed before apply')

        const insecureSnapshot = createHttpsSnapshot({
            ...customHost,
            upstreamTls: { verify: false, serverName: 'backend.test', trustedCaId: null },
        })
        const insecureApply = await apply(insecureSnapshot)
        assert.equal(insecureApply.httpStatus, 200)
        await waitForRevision(insecureSnapshot.revision)
        await waitForProxyBody(
            'secure-upstream.test',
            200,
            /backend-one.*sni=backend\.test/u,
            'verification-disabled route with DNS SNI',
        )
        const insecureConfig = await activeConfig()
        assert.match(insecureConfig, /proxy_ssl_server_name on;/u)
        assert.match(insecureConfig, /proxy_ssl_name backend\.test;/u)
        assert.match(insecureConfig, /proxy_ssl_verify off;/u)
        passed('explicit verification disable succeeds while preserving DNS SNI')

        const aliasHost: ProxyHost = { ...customHost, forwardHost: 'backend-tls' }
        const aliasSnapshot = createHttpsSnapshot(aliasHost, [caOne])
        assert.equal((await apply(aliasSnapshot)).httpStatus, 200)
        await waitForRevision(aliasSnapshot.revision)
        await waitForProxyBody(
            'secure-upstream.test',
            200,
            /backend-one/u,
            'backend alias HTTPS route',
        )

        await command(['docker', 'rm', '--force', backendContainer])
        await startBackend(backendTwoConfig)
        const caTwo = await validateCa(await readFile(caTwoPath, 'utf8'))
        const replacementSnapshot = createHttpsSnapshot(
            {
                ...aliasHost,
                upstreamTls: { verify: true, serverName: 'backend.test', trustedCaId: caOne.id },
            },
            [{ ...caTwo, id: caOne.id }],
        )
        assert.notEqual(replacementSnapshot.revision, aliasSnapshot.revision)
        assert.equal((await apply(replacementSnapshot)).httpStatus, 200)
        await waitForRevision(replacementSnapshot.revision)
        await waitForProxyBody(
            'secure-upstream.test',
            200,
            /backend-two/u,
            'replacement HTTPS route',
        )
        passed('direct CA replacement changes revision and activates new trust material')

        const missingCa = createHttpsSnapshot(
            {
                ...aliasHost,
                upstreamTls: { verify: true, serverName: 'backend.test', trustedCaId: caOne.id },
            },
            [],
        )
        assert.equal((await apply(missingCa)).httpStatus, 422)
        assert.equal(
            (await controllerJson('/internal/v1/proxy/status')).activeRevision,
            replacementSnapshot.revision,
        )
        await waitForProxyBody(
            'secure-upstream.test',
            200,
            /backend-two/u,
            'HTTPS route after missing CA apply',
        )
        const invalidCa = createHttpsSnapshot(
            {
                ...aliasHost,
                upstreamTls: { verify: true, serverName: 'backend.test', trustedCaId: caOne.id },
            },
            [
                {
                    id: caOne.id,
                    pem: 'invalid-certificate',
                    fingerprintSha256: 'sha256:' + '0'.repeat(64),
                },
            ],
        )
        assert.equal((await apply(invalidCa)).httpStatus, 422)
        assert.equal(
            (await controllerJson('/internal/v1/proxy/status')).activeRevision,
            replacementSnapshot.revision,
        )
        await waitForProxyBody(
            'secure-upstream.test',
            200,
            /backend-two/u,
            'HTTPS route after invalid CA apply',
        )
        passed('missing or invalid trust material fails closed and preserves active traffic')

        const invalidAdvanced = createHttpsSnapshot(
            { ...aliasHost, advancedConfig: 'this_directive_should_not_exist;' },
            [{ ...caTwo, id: caOne.id }],
        )
        const invalidAdvancedApply = await apply(invalidAdvanced)
        assert.equal(invalidAdvancedApply.httpStatus, 502)
        assert.equal(invalidAdvancedApply.error, 'apply_failed')
        assert.equal(
            (await controllerJson('/internal/v1/proxy/status')).activeRevision,
            replacementSnapshot.revision,
        )
        await waitForProxyBody(
            'secure-upstream.test',
            200,
            /backend-two/u,
            'HTTPS route after advanced-config rollback',
        )
        passed(
            'invalid advanced configuration rolls back while the previous HTTPS route stays live',
        )

        console.log('Real HTTPS upstream TLS integration: ' + assertions + ' checks passed.')
    } finally {
        await command(['docker', 'rm', '--force', backendContainer]).catch(() => undefined)
        await command(['docker', 'rm', '--force', '--volumes', runtimeContainer]).catch(
            () => undefined,
        )
        await command(['docker', 'volume', 'rm', stateVolume]).catch(() => undefined)
        await command(['docker', 'network', 'rm', network]).catch(() => undefined)
        await command(['docker', 'image', 'rm', '--force', runtimeImage]).catch(() => undefined)
        await rm(tempDirectory, { recursive: true, force: true }).catch(() => undefined)
    }
}

await runSmoke()
