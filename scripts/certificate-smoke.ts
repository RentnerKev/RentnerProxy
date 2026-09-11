// oxlint-disable no-await-in-loop -- bounded readiness and certificate-operation polling.
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { basename, dirname, resolve } from 'node:path'

import { smokeDockerArguments } from './smoke-resources'
import { startCertificateDnsFixture } from './certificate-dns-fixture'
import { CERTIFICATE_ERROR_CODES } from '../web/src/config/certificates.config'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const runId = randomUUID().replaceAll('-', '').slice(0, 12)
const project = 'rentnerproxy-certificate-smoke-' + runId
const network = project + '-network'
const runtimeContainer = project + '-runtime'
const pebbleContainer = project + '-pebble'
const runtimeImage = project + ':runtime'
const pebbleImage =
    'ghcr.io/letsencrypt/pebble:2.10.1@sha256:ddf230642b1a584f519f32e347de1b05a6e4c1f6c35c1863b33effeab5f78199'
const token = randomBytes(32).toString('hex')
const environment: NodeJS.ProcessEnv = {
    ...process.env,
    RENTNERPROXY_CONTROLLER_TOKEN: token,
}
let assertions = 0
let opensslMode: 'host' | 'docker' = 'host'
let curlTestCaArgs: string[] = []
let opensslTempDirectory = ''
const opensslImage = runtimeImage

function uuidV7(): string {
    const bytes = randomBytes(16)
    const timestamp = BigInt(Date.now())
    bytes[0] = Number((timestamp >> 40n) & 0xffn)
    bytes[1] = Number((timestamp >> 32n) & 0xffn)
    bytes[2] = Number((timestamp >> 24n) & 0xffn)
    bytes[3] = Number((timestamp >> 16n) & 0xffn)
    bytes[4] = Number((timestamp >> 8n) & 0xffn)
    bytes[5] = Number(timestamp & 0xffn)
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
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

async function command(
    args: string[],
    options: { readonly inherit?: boolean; readonly timeoutMs?: number } = {},
): Promise<string> {
    const child = Bun.spawn({
        cmd: smokeDockerArguments(
            args[0] === 'curl' ? ['curl', ...curlTestCaArgs, ...args.slice(1)] : args,
        ),
        cwd: repositoryRoot,
        env: environment,
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
            // A container or an asynchronous ACME operation may not be ready yet.
        }
        await Bun.sleep(250)
    }
    throw new Error('Timed out waiting for ' + label)
}

function passed(label: string): void {
    assertions += 1
    console.log('PASS ' + label)
}

function jsonObject(value: unknown): Record<string, any> {
    assert.equal(typeof value, 'object')
    assert.notEqual(value, null)
    return value as Record<string, any>
}

function assertCertificateIssued(metadata: Record<string, any>): void {
    if (metadata.status === 'valid' && metadata.lastErrorCode === null) return
    const code =
        CERTIFICATE_ERROR_CODES.find((value) => value === metadata.lastErrorCode) ?? 'acme_failed'
    throw new Error('Certificate operation failed: ' + code)
}

async function freePort(): Promise<number> {
    const server = Bun.serve({ port: 0, fetch: () => new Response(null, { status: 204 }) })
    const port = server.port ?? 0
    server.stop(true)
    assert.ok(port > 0)
    return port
}

async function openssl(args: string[], timeoutMs = 30_000): Promise<string> {
    if (opensslMode === 'host') return command(['openssl', ...args], { timeoutMs })
    const mapped = args.map((value) =>
        value.startsWith(opensslTempDirectory)
            ? '/certs/' + value.slice(opensslTempDirectory.length).replaceAll('\\', '/')
            : value,
    )
    const connectIndex = mapped.indexOf('-connect')
    const connectTarget = connectIndex >= 0 ? mapped[connectIndex + 1] : undefined
    if (connectIndex >= 0 && connectTarget?.startsWith('127.0.0.1:')) {
        mapped[connectIndex + 1] = runtimeContainer + ':8443'
    }
    const uid = process.getuid?.()
    const gid = process.getgid?.()
    return command(
        [
            'docker',
            'run',
            '--rm',
            '--network',
            network,
            ...(uid === undefined || gid === undefined ? [] : ['--user', uid + ':' + gid]),
            '--volume',
            opensslTempDirectory + ':/certs',
            '--entrypoint',
            '/usr/bin/openssl',
            opensslImage,
            ...mapped,
        ],
        { timeoutMs },
    )
}

async function generateCertificateMaterial(directory: string, name: string, domain: string) {
    const prefix = directory + '/' + name
    await openssl([
        'req',
        '-new',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        prefix + '.key',
        '-out',
        prefix + '.csr',
        '-subj',
        '/CN=' + domain,
    ])
    const extensions = prefix + '.ext'
    await writeFile(
        extensions,
        `subjectAltName=DNS:${domain}
extendedKeyUsage=serverAuth
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
`,
    )
    await openssl([
        'x509',
        '-req',
        '-in',
        prefix + '.csr',
        '-CA',
        directory + '/ca.pem',
        '-CAkey',
        directory + '/ca.key',
        '-CAserial',
        prefix + '.srl',
        '-CAcreateserial',
        '-out',
        prefix + '.pem',
        '-days',
        '1',
        '-sha256',
        '-extfile',
        extensions,
    ])
    return { certificatePem: prefix + '.pem', privateKeyPem: prefix + '.key' }
}

async function fingerprint(path: string): Promise<string> {
    const output = await openssl(['x509', '-in', path, '-noout', '-fingerprint', '-sha256'])
    const value = output.match(/=([0-9A-F:]+)/u)?.[1]
    assert.ok(value)
    return value.replaceAll(':', '').toLowerCase()
}

async function readFileText(path: string): Promise<string> {
    return await Bun.file(path).text()
}

function snapshot(
    hosts: Array<Record<string, unknown>>,
    redirects: Array<Record<string, unknown>> = [],
) {
    const proxyHosts = hosts
        .map((input) => ({
            id: input.id,
            domains: (input.domains as string[]).toSorted(),
            forwardScheme: input.forwardScheme,
            forwardHost: input.forwardHost,
            forwardPort: input.forwardPort,
            ...(input.httpSettings === undefined ? {} : { httpSettings: input.httpSettings }),
            ...(input.certificateId === undefined ? {} : { certificateId: input.certificateId }),
            ...(input.forceHttps ? { forceHttps: true } : {}),
        }))
        .toSorted((left, right) => (String(left.id) < String(right.id) ? -1 : 1))
    const redirectHosts = redirects
        .map((input) => ({
            id: input.id,
            domains: (input.domains as string[]).toSorted(),
            destination: input.destination,
            statusCode: input.statusCode,
            preserveRequestUri: input.preserveRequestUri,
            ...(input.certificateId === undefined ? {} : { certificateId: input.certificateId }),
        }))
        .toSorted((left, right) => (String(left.id) < String(right.id) ? -1 : 1))
    const payload = { version: 7, proxyHosts, redirectHosts, httpSettings: {}, trustedCas: [] }
    const canonical = JSON.stringify(payload)
    return {
        ...payload,
        revision: 'sha256:' + new Bun.CryptoHasher('sha256').update(canonical).digest('hex'),
    }
}

function isOwnedTempDirectory(directory: string): boolean {
    const resolved = resolve(directory)
    return (
        dirname(resolved) === resolve(tmpdir()) &&
        basename(resolved).startsWith('rentnerproxy-certificate-smoke-')
    )
}

function host(
    id: string,
    domain: string,
    port: number,
    certificateId?: string,
    forceHttps = false,
) {
    return {
        id,
        domains: [domain],
        forwardScheme: 'http',
        forwardHost: 'host.docker.internal',
        forwardPort: port,
        ...(certificateId === undefined ? {} : { certificateId }),
        ...(forceHttps ? { forceHttps: true } : {}),
    }
}

function redirectHost(id: string, domain: string, destination: string, certificateId?: string) {
    return {
        id,
        domains: [domain],
        destination,
        statusCode: 308,
        preserveRequestUri: true,
        ...(certificateId === undefined ? {} : { certificateId }),
    }
}

async function runSmoke(): Promise<void> {
    const temp = await mkdtemp(tmpdir() + '/rentnerproxy-certificate-smoke-')
    const stateVolume = project + '-state'
    let backend: ReturnType<typeof Bun.serve> | undefined
    let dnsFixture: Awaited<ReturnType<typeof startCertificateDnsFixture>> | undefined
    const dnsToken = randomBytes(32).toString('hex')
    let controllerUrl = ''
    let httpUrl = ''
    let pebbleManagementUrl = ''
    let minicaPath = temp + '/pebble.minica.pem'
    let certSource = ''

    try {
        await command(['docker', 'version', '--format', '{{.Server.Version}}'])
        // Local fixture CAs have no revocation endpoints; keep chain and hostname verification.
        if ((await command(['curl', '--version'])).includes('Schannel')) {
            curlTestCaArgs = ['--ssl-revoke-best-effort']
        }
        try {
            await command(['openssl', 'version'])
        } catch {
            opensslMode = 'docker'
        }
        opensslTempDirectory = temp
        await command(['docker', 'pull', pebbleImage], { inherit: true, timeoutMs: 300_000 })
        await command(
            [
                'docker',
                'build',
                '--tag',
                runtimeImage,
                '--file',
                'docker/proxy-runtime/Dockerfile',
                '.',
            ],
            { inherit: true, timeoutMs: 900_000 },
        )
        await command(['docker', 'network', 'create', network])
        await command(['docker', 'volume', 'create', stateVolume])
        dnsFixture = await startCertificateDnsFixture(dnsToken)

        // Extract Pebble's official endpoint CA from the pinned image; it is never committed.
        certSource = project + '-cert-source'
        await command(['docker', 'create', '--name', certSource, pebbleImage])
        await command(['docker', 'cp', certSource + ':/test/certs/pebble.minica.pem', minicaPath])
        await command(['docker', 'rm', '--force', certSource])

        await openssl([
            'req',
            '-x509',
            '-newkey',
            'rsa:2048',
            '-nodes',
            '-keyout',
            temp + '/ca.key',
            '-out',
            temp + '/ca.pem',
            '-days',
            '1',
            '-subj',
            '/CN=RentnerProxy smoke CA',
            '-addext',
            'basicConstraints=critical,CA:TRUE',
            '-addext',
            'keyUsage=critical,keyCertSign,cRLSign',
        ])
        const first = await generateCertificateMaterial(temp, 'one.test', 'one.test')
        const second = await generateCertificateMaterial(temp, 'two.test', 'two.test')
        const redirectCertificate = await generateCertificateMaterial(
            temp,
            'redirect.test',
            'redirect.test',
        )
        const mismatch = await generateCertificateMaterial(temp, 'mismatch.test', 'mismatch.test')
        const replacement = await generateCertificateMaterial(
            temp,
            'one-replacement.test',
            'one.test',
        )
        const firstFingerprint = await fingerprint(first.certificatePem)
        const secondFingerprint = await fingerprint(second.certificatePem)
        const replacementFingerprint = await fingerprint(replacement.certificatePem)

        const pebbleConfigPath = temp + '/pebble-config.json'
        await writeFile(
            pebbleConfigPath,
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
                        default: { description: 'Local smoke certificate', validityPeriod: 86400 },
                    },
                },
            }),
        )

        const pebbleManagementPort = await freePort()
        await command(
            [
                'docker',
                'run',
                '--detach',
                '--name',
                pebbleContainer,
                '--network',
                network,
                '--network-alias',
                'pebble',
                '--add-host',
                'host.docker.internal:host-gateway',
                '--publish',
                '127.0.0.1:' + pebbleManagementPort + ':15000',
                '--env',
                'PEBBLE_VA_NOSLEEP=1',
                '--env',
                'PEBBLE_AUTHZREUSE=0',
                '--volume',
                pebbleConfigPath + ':/tmp/pebble-config.json:ro',
                pebbleImage,
                '-config',
                '/tmp/pebble-config.json',
                '-strict',
                '-dnsserver',
                'host.docker.internal:' + dnsFixture.dnsPort,
            ],
            { timeoutMs: 60_000 },
        )
        pebbleManagementUrl = 'https://localhost:' + pebbleManagementPort
        await waitFor(async () => {
            const result = await command([
                'curl',
                '--silent',
                '--show-error',
                '--fail',
                '--cacert',
                minicaPath,
                '--resolve',
                'localhost:' + pebbleManagementPort + ':127.0.0.1',
                pebbleManagementUrl + '/roots/0',
            ]).catch(() => '')
            return result.includes('BEGIN CERTIFICATE')
        }, 'Pebble management API')
        const dynamicRoot = await command([
            'curl',
            '--silent',
            '--show-error',
            '--fail',
            '--cacert',
            minicaPath,
            '--resolve',
            'localhost:' + pebbleManagementPort + ':127.0.0.1',
            pebbleManagementUrl + '/roots/0',
        ])
        assert.match(dynamicRoot, /BEGIN CERTIFICATE/u)
        await writeFile(temp + '/issuance-root.pem', dynamicRoot)
        passed('pinned Pebble starts; endpoint CA and dynamic issuance root are kept separate')

        const httpPort = await freePort()
        const httpsPort = await freePort()
        const controllerPort = await freePort()
        const upstreamRequests: string[] = []
        backend = Bun.serve({
            hostname: '0.0.0.0',
            port: 0,
            async fetch(request) {
                const url = new URL(request.url)
                const requestBody = await request.text()
                upstreamRequests.push(request.method + ' ' + url.pathname + url.search)
                if (url.pathname.startsWith('/.well-known/acme-challenge/')) {
                    return new Response('unexpected upstream challenge', { status: 500 })
                }
                return Response.json({
                    message: 'certificate-smoke-backend',
                    method: request.method,
                    path: url.pathname + url.search,
                    body: requestBody,
                })
            },
        })
        assert.ok(backend.port)

        await command(
            [
                'docker',
                'run',
                '--detach',
                '--name',
                runtimeContainer,
                '--network',
                network,
                '--network-alias',
                'one.test',
                '--network-alias',
                'two.test',
                '--network-alias',
                'plain.invalid',
                '--network-alias',
                'acme.invalid',
                '--add-host',
                'host.docker.internal:host-gateway',
                '--publish',
                '127.0.0.1:' + httpPort + ':8080',
                '--publish',
                '127.0.0.1:' + httpsPort + ':8443',
                '--publish',
                '127.0.0.1:' + controllerPort + ':8081',
                '--env',
                'RENTNERPROXY_CONTROLLER_LISTEN_ADDR=0.0.0.0:8081',
                '--env',
                'RENTNERPROXY_CONTROLLER_TOKEN=' + token,
                '--env',
                'RENTNERPROXY_PROXY_HTTP_PORT=8080',
                '--env',
                'RENTNERPROXY_PROXY_HTTPS_PORT=8443',
                '--env',
                'RENTNERPROXY_PROXY_PUBLIC_HTTPS_PORT=' + httpsPort,
                '--env',
                'RENTNERPROXY_ACME_TEST_DIRECTORY_URL=https://pebble:14000/dir',
                '--env',
                'RENTNERPROXY_ACME_TEST_ROOT_CERT=/test/pebble.minica.pem',
                '--env',
                'APP_ENCRYPTION_KEY=' + randomBytes(32).toString('base64'),
                '--env',
                'RENTNERPROXY_DNS_TEST_API_URL=http://host.docker.internal:' +
                    dnsFixture.apiPort +
                    '/client/v4',
                '--env',
                'RENTNERPROXY_PROXY_STATE_DIR=/var/lib/rentnerproxy/proxy',
                '--volume',
                stateVolume + ':/var/lib/rentnerproxy/proxy',
                '--volume',
                minicaPath + ':/test/pebble.minica.pem:ro',
                runtimeImage,
            ],
            { timeoutMs: 60_000 },
        )
        controllerUrl = 'http://127.0.0.1:' + controllerPort
        const dnsAddresses = dnsFixture.addresses
        async function refreshRuntimeDns(): Promise<void> {
            const runtimeAddress = await command([
                'docker',
                'inspect',
                '--format',
                '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}',
                runtimeContainer,
            ])
            dnsAddresses.set('acme.invalid', runtimeAddress)
        }
        async function restartRuntime(): Promise<void> {
            await command(['docker', 'restart', runtimeContainer], { timeoutMs: 60_000 })
            // Docker may allocate a different address after the network fault/restart tests.
            await refreshRuntimeDns()
        }
        await refreshRuntimeDns()
        httpUrl = 'http://127.0.0.1:' + httpPort
        await waitFor(async () => {
            const response = await fetch(controllerUrl + '/health').catch(() => null)
            return response?.status === 200
        }, 'controller health')
        await waitFor(async () => {
            const response = await fetch(controllerUrl + '/internal/v1/proxy/status', {
                headers: { authorization: 'Bearer ' + token },
            }).catch(() => null)
            return response?.status === 200 && (await response.json()).running === true
        }, 'Caddy startup')
        const portBindings = await command([
            'docker',
            'inspect',
            '--format',
            '{{json .HostConfig.PortBindings}}',
            runtimeContainer,
        ])
        assert.doesNotMatch(portBindings, /\/udp/iu)
        passed('isolated controller and Caddy runtime are ready')

        async function controllerRequest(
            path: string,
            options: RequestInit = {},
        ): Promise<Response> {
            const response = await fetch(controllerUrl + path, {
                ...options,
                headers: {
                    accept: 'application/json',
                    authorization: 'Bearer ' + token,
                    ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
                },
                signal: AbortSignal.timeout(30_000),
            })
            return response
        }

        async function waitForPebbleNetwork(): Promise<void> {
            await waitFor(async () => {
                await command(
                    [
                        'docker',
                        'exec',
                        runtimeContainer,
                        '/usr/bin/openssl',
                        's_client',
                        '-connect',
                        'pebble:14000',
                        '-servername',
                        'pebble',
                        '-verify_hostname',
                        'pebble',
                        '-verify_return_error',
                        '-CAfile',
                        '/test/pebble.minica.pem',
                        '-brief',
                    ],
                    { timeoutMs: 5_000 },
                )
                return true
            }, 'Pebble ACME endpoint in the runtime network')
        }

        async function importCertificate(
            id: string,
            material: { certificatePem: string; privateKeyPem: string },
            domains: string[],
        ) {
            const response = await controllerRequest(
                '/internal/v1/certificates/' + id + '/import',
                {
                    method: 'POST',
                    body: JSON.stringify({
                        certificatePem: await readFileText(material.certificatePem),
                        privateKeyPem: await readFileText(material.privateKeyPem),
                        chainPem: await readFileText(temp + '/ca.pem'),
                        requiredDomains: domains,
                    }),
                },
            )
            assert.equal(response.status, 200)
            return jsonObject(await response.json())
        }

        const firstId = uuidV7()
        const secondId = uuidV7()
        const redirectCertificateId = uuidV7()
        const acmeId = uuidV7()
        const firstMetadata = await importCertificate(firstId, first, ['one.test'])
        const secondMetadata = await importCertificate(secondId, second, ['two.test'])
        const redirectMetadata = await importCertificate(
            redirectCertificateId,
            redirectCertificate,
            ['redirect.test'],
        )
        assert.equal(firstMetadata.source, 'manual')
        assert.equal(secondMetadata.source, 'manual')
        assert.equal(redirectMetadata.source, 'manual')
        const preImportMetadata = JSON.stringify([firstMetadata, secondMetadata, redirectMetadata])
        assert.equal(preImportMetadata.includes('BEGIN '), false)
        assert.equal(preImportMetadata.includes('PRIVATE KEY'), false)
        assert.equal(preImportMetadata.includes(temp), false)
        assert.equal(preImportMetadata.includes('private-key.pem'), false)
        passed('manual certificates import with metadata only; PEM/key material is not returned')

        async function apply(configuration: unknown): Promise<void> {
            const response = await controllerRequest('/internal/v1/proxy/config', {
                method: 'PUT',
                body: JSON.stringify(configuration),
            })
            assert.equal(response.status, 200)
            await waitFor(async () => {
                const status = jsonObject(
                    await (await controllerRequest('/internal/v1/proxy/status')).json(),
                )
                return status.activeRevision === jsonObject(configuration).revision
            }, 'configuration apply')
        }
        async function curl(args: string[]): Promise<string> {
            return command(['curl', '--silent', '--show-error', '--noproxy', '*', ...args], {
                timeoutMs: 15_000,
            })
        }
        const one = host(uuidV7(), 'one.test', backend.port!, firstId, true)
        const two = host(uuidV7(), 'two.test', backend.port!, secondId, true)
        const acmeHost = host(uuidV7(), 'acme.invalid', backend.port!)
        const plainHost = host(uuidV7(), 'plain.invalid', backend.port!)
        const httpsRedirect = redirectHost(
            uuidV7(),
            'redirect.test',
            'https://new.example.test/base',
            redirectCertificateId,
        )
        const initialSnapshot = snapshot([one, two, plainHost], [httpsRedirect])
        const preview = await controllerRequest('/internal/v1/proxy/config/preview', {
            method: 'POST',
            body: JSON.stringify(initialSnapshot),
        })
        assert.equal(preview.status, 200)
        const previewPayload = jsonObject(await preview.json())
        const previewSource = jsonObject(JSON.parse(previewPayload.config as string))
        assert.equal(typeof previewSource, 'object')
        assert.notEqual(previewSource, null)
        assert.equal(typeof jsonObject(previewSource).apps, 'object')
        assert.equal(JSON.stringify(previewSource).includes('BEGIN '), false)
        await apply(initialSnapshot)
        passed('TLS preview and apply resolve controller-owned material without returning PEM')

        const httpsOne = await curl([
            '--cacert',
            temp + '/ca.pem',
            '--resolve',
            'one.test:' + httpsPort + ':127.0.0.1',
            'https://one.test:' + httpsPort + '/real/path?query=a%2Fb',
        ])
        const httpsTwo = await curl([
            '--cacert',
            temp + '/ca.pem',
            '--resolve',
            'two.test:' + httpsPort + ':127.0.0.1',
            'https://two.test:' + httpsPort + '/',
        ])
        assert.match(httpsOne, /certificate-smoke-backend/u)
        assert.match(httpsTwo, /certificate-smoke-backend/u)
        const upstreamCountBeforeRedirect = upstreamRequests.length
        const redirectOverHttps = await curl([
            '--include',
            '--cacert',
            temp + '/ca.pem',
            '--resolve',
            'redirect.test:' + httpsPort + ':127.0.0.1',
            'https://redirect.test:' + httpsPort + '/real/path?query=a%2Fb',
        ])
        // Linux curl negotiates HTTP/2 for HTTPS; both protocols must preserve the status.
        assert.match(redirectOverHttps, /^HTTP\/(?:1\.1|2) 308(?:\s|$)/u)
        assert.match(
            redirectOverHttps,
            /Location: https:\/\/new\.example\.test\/base\/real\/path\?query=a%2Fb/iu,
        )
        const redirectOverHttp = await curl([
            '--include',
            httpUrl + '/plain/path?query=1',
            '--header',
            'Host: redirect.test',
        ])
        assert.match(redirectOverHttp, /HTTP\/1\.1 308/u)
        assert.match(
            redirectOverHttp,
            /Location: https:\/\/new\.example\.test\/base\/plain\/path\?query=1/iu,
        )
        assert.equal(upstreamRequests.length, upstreamCountBeforeRedirect)
        passed('first-class redirect host serves matching HTTP and certificate-backed HTTPS SNI')
        const servedOne = await openssl(
            [
                's_client',
                '-connect',
                '127.0.0.1:' + httpsPort,
                '-servername',
                'one.test',
                '-CAfile',
                temp + '/ca.pem',
                '-showcerts',
            ],
            15_000,
        ).catch(() => '')
        const servedTwo = await openssl(
            [
                's_client',
                '-connect',
                '127.0.0.1:' + httpsPort,
                '-servername',
                'two.test',
                '-CAfile',
                temp + '/ca.pem',
                '-showcerts',
            ],
            15_000,
        ).catch(() => '')
        assert.match(servedOne, /BEGIN CERTIFICATE/u)
        assert.match(servedTwo, /BEGIN CERTIFICATE/u)
        // The actual SNI certificate is checked by extracting each first PEM block.
        const servedOnePem = servedOne.match(
            /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/u,
        )?.[0]
        const servedTwoPem = servedTwo.match(
            /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/u,
        )?.[0]
        assert.ok(servedOnePem)
        assert.ok(servedTwoPem)
        await writeFile(temp + '/served-one.pem', servedOnePem)
        await writeFile(temp + '/served-two.pem', servedTwoPem)
        assert.equal(await fingerprint(temp + '/served-one.pem'), firstFingerprint)
        assert.equal(await fingerprint(temp + '/served-two.pem'), secondFingerprint)
        passed('HTTPS SNI serves two distinct imported certificates and real backend traffic')
        const http2Handshake = await openssl(
            [
                's_client',
                '-connect',
                '127.0.0.1:' + httpsPort,
                '-servername',
                'one.test',
                '-alpn',
                'h2',
                '-CAfile',
                temp + '/ca.pem',
            ],
            15_000,
        )
        assert.match(http2Handshake, /ALPN protocol: h2/iu)
        passed('real TLS handshake negotiates HTTP/2 through Caddy')

        const activeRevisionBeforeReplacement = jsonObject(
            await (await controllerRequest('/internal/v1/proxy/status')).json(),
        ).activeRevision
        await importCertificate(firstId, replacement, ['one.test'])
        await waitFor(async () => {
            const served = await openssl(
                [
                    's_client',
                    '-connect',
                    '127.0.0.1:' + httpsPort,
                    '-servername',
                    'one.test',
                    '-CAfile',
                    temp + '/ca.pem',
                    '-showcerts',
                ],
                15_000,
            ).catch(() => '')
            const pem = served.match(
                /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/u,
            )?.[0]
            if (!pem) return false
            await writeFile(temp + '/served-replacement.pem', pem)
            return (await fingerprint(temp + '/served-replacement.pem')) === replacementFingerprint
        }, 'certificate replacement')
        assert.equal(
            jsonObject(await (await controllerRequest('/internal/v1/proxy/status')).json())
                .activeRevision,
            activeRevisionBeforeReplacement,
        )
        passed(
            'certificate replacement changes the SNI fingerprint without changing the active revision',
        )

        const redirect = await curl([
            '--max-time',
            '10',
            '--request',
            'POST',
            '--data',
            'payload',
            '--include',
            '--resolve',
            'one.test:' + httpPort + ':127.0.0.1',
            httpUrl + '/redirect/path?x=1',
            '--header',
            'Host: one.test',
        ])
        assert.match(redirect, /HTTP\/1\.1 308/u)
        assert.match(
            redirect,
            new RegExp('Location: https://one\\.test:' + httpsPort + '/redirect/path\\?x=1', 'iu'),
        )
        const followed = await curl([
            '--location',
            '--data',
            'payload',
            '--cacert',
            temp + '/ca.pem',
            '--resolve',
            'one.test:' + httpPort + ':127.0.0.1',
            '--resolve',
            'one.test:' + httpsPort + ':127.0.0.1',
            httpUrl + '/redirect/path?x=1',
            '--header',
            'Host: one.test',
        ])
        assert.match(followed, /certificate-smoke-backend/u)
        assert.match(followed, /"body":"payload"/u)
        assert.equal(
            upstreamRequests.some((request) => request === 'POST /redirect/path?x=1'),
            true,
        )
        const plainHttp = await curl([
            '--resolve',
            'plain.invalid:' + httpPort + ':127.0.0.1',
            httpUrl + '/',
            '--header',
            'Host: plain.invalid',
        ])
        assert.match(plainHttp, /certificate-smoke-backend/u)
        passed('HTTP non-forceHttps host reaches the real backend; 308 follow preserves POST')
        passed('forceHttps returns a public-port 308 preserving path/query')

        const withSettings = snapshot([
            {
                ...one,
                httpSettings: { clientMaxBodySizeBytes: 4096 },
            },
        ])
        await apply(withSettings)
        passed('structured body limits survive HTTPS rendering')
        const tooLarge = await curl([
            '--include',
            '--data-binary',
            'x'.repeat(5000),
            '--cacert',
            temp + '/ca.pem',
            '--resolve',
            'one.test:' + httpsPort + ':127.0.0.1',
            'https://one.test:' + httpsPort + '/body-limit',
        ])
        assert.match(tooLarge, /^HTTP\/(?:1\.1|2) 413(?:\s|$)/u)
        passed('per-host body size settings still apply to HTTPS traffic')
        const challengeBypass = await curl([
            '--include',
            httpUrl + '/.well-known/acme-challenge/unknown_token',
            '--header',
            'Host: one.test',
        ])
        assert.match(challengeBypass, /HTTP\/1\.1 404/u)
        assert.doesNotMatch(challengeBypass, /Location:/iu)
        passed('HTTP-01 bypasses force HTTPS even for unknown tokens')

        const knownTls = await curl([
            '--cacert',
            temp + '/ca.pem',
            '--resolve',
            'one.test:' + httpsPort + ':127.0.0.1',
            'https://one.test:' + httpsPort + '/',
        ])
        assert.match(knownTls, /certificate-smoke-backend/u)
        await assert.rejects(() =>
            curl([
                '--insecure',
                '--resolve',
                'unknown.test:' + httpsPort + ':127.0.0.1',
                'https://unknown.test:' + httpsPort + '/',
            ]),
        )
        passed('known SNI remains healthy while unknown SNI fails TLS negotiation')

        const disabled = await snapshot([])
        await apply(disabled)
        const disabledHttp = await curl([
            '--include',
            '--resolve',
            'one.test:' + httpPort + ':127.0.0.1',
            httpUrl + '/',
            '--header',
            'Host: one.test',
        ])
        assert.match(disabledHttp, /404/u)
        await assert.rejects(() =>
            curl([
                '--include',
                '--cacert',
                temp + '/ca.pem',
                '--resolve',
                'one.test:' + httpsPort + ':127.0.0.1',
                'https://one.test:' + httpsPort + '/',
            ]),
        )
        await apply(await snapshot([one]))
        const deletedCertificate = await controllerRequest(
            '/internal/v1/certificates/' + secondId,
            { method: 'DELETE' },
        )
        assert.equal(deletedCertificate.status, 200)
        assert.deepEqual(await deletedCertificate.json(), { deleted: true })
        await command([
            'docker',
            'exec',
            runtimeContainer,
            'test',
            '!',
            '-e',
            '/var/lib/rentnerproxy/proxy/certificates/' + secondId,
        ])
        const deletedHttp = await curl([
            '--include',
            '--resolve',
            'two.test:' + httpPort + ':127.0.0.1',
            httpUrl + '/',
            '--header',
            'Host: two.test',
        ])
        assert.match(deletedHttp, /404/u)
        await assert.rejects(() =>
            curl([
                '--cacert',
                temp + '/ca.pem',
                '--resolve',
                'two.test:' + httpsPort + ':127.0.0.1',
                'https://two.test:' + httpsPort + '/',
            ]),
        )
        passed('removing a host permits certificate deletion and removes its HTTP and HTTPS routes')

        const oldFingerprint = 'sha256:' + replacementFingerprint
        const badImport = await controllerRequest(
            '/internal/v1/certificates/' + firstId + '/import',
            {
                method: 'POST',
                body: JSON.stringify({
                    certificatePem: await readFileText(first.certificatePem),
                    privateKeyPem: await readFileText(mismatch.privateKeyPem),
                    requiredDomains: ['one.test'],
                }),
            },
        )
        assert.equal(badImport.status, 422)
        assert.equal(jsonObject(await badImport.json()).error, 'key_mismatch')
        assert.equal(
            jsonObject(
                await (await controllerRequest('/internal/v1/certificates/' + firstId)).json(),
            ).fingerprint,
            oldFingerprint,
        )
        passed('key mismatch is rejected without replacing the served certificate')

        const invalidSnapshot = await snapshot([one])
        const activeBeforeInvalidApply = jsonObject(
            await (await controllerRequest('/internal/v1/proxy/status')).json(),
        ).activeRevision
        const corruptCertificatePath =
            '/var/lib/rentnerproxy/proxy/certificates/' +
            firstId +
            '/versions/' +
            new Bun.CryptoHasher('sha256')
                .update(await readFileText(replacement.certificatePem))
                .update('\0')
                .update(await readFileText(temp + '/ca.pem'))
                .update('\0')
                .update(await readFileText(replacement.privateKeyPem))
                .digest('hex') +
            '/fullchain.pem'
        const savedCertificatePath = '/tmp/' + project + '-fullchain.pem'
        await command([
            'docker',
            'exec',
            runtimeContainer,
            'cp',
            corruptCertificatePath,
            savedCertificatePath,
        ])
        await command(['docker', 'exec', runtimeContainer, 'rm', corruptCertificatePath])
        const invalidApply = await controllerRequest('/internal/v1/proxy/config', {
            method: 'PUT',
            body: JSON.stringify(invalidSnapshot),
        })
        assert.equal(invalidApply.status, 502)
        assert.equal(
            jsonObject(await (await controllerRequest('/internal/v1/proxy/status')).json())
                .activeRevision,
            activeBeforeInvalidApply,
        )
        await waitFor(
            async () => (await controllerRequest('/internal/v1/proxy/status')).status === 200,
            'controller status after rollback',
        )
        const afterRollback = await curl([
            '--cacert',
            temp + '/ca.pem',
            '--resolve',
            'one.test:' + httpsPort + ':127.0.0.1',
            'https://one.test:' + httpsPort + '/',
        ])
        assert.match(afterRollback, /certificate-smoke-backend/u)
        await command([
            'docker',
            'exec',
            runtimeContainer,
            'mv',
            savedCertificatePath,
            corruptCertificatePath,
        ])
        passed(
            'missing certificate material rolls back while the previous HTTPS route remains live',
        )

        const accountFile = '/var/lib/rentnerproxy/proxy/certificates/acme-accounts/staging.json'
        await command(['docker', 'network', 'disconnect', network, pebbleContainer])
        let pendingAccountDigest = ''
        for (let attempt = 0; attempt < 2; attempt += 1) {
            const interruptedId = uuidV7()
            const interrupted = await controllerRequest(
                '/internal/v1/certificates/' + interruptedId + '/issue',
                {
                    method: 'POST',
                    body: JSON.stringify({
                        domains: ['acme.invalid'],
                        environment: 'staging',
                        acceptTerms: true,
                    }),
                },
            )
            assert.equal(interrupted.status, 202)
            await waitFor(
                async () => {
                    const metadata = jsonObject(
                        await (
                            await controllerRequest('/internal/v1/certificates/' + interruptedId)
                        ).json(),
                    )
                    return metadata.status === 'failed' && metadata.operation === 'idle'
                },
                'interrupted initial account registration',
                90_000,
            )
            const digest = await command([
                'docker',
                'exec',
                runtimeContainer,
                'sha256sum',
                accountFile,
            ])
            if (attempt === 0) {
                pendingAccountDigest = digest
                await restartRuntime()
                await waitFor(async () => {
                    const response = await controllerRequest('/internal/v1/proxy/status')
                    return (
                        response.status === 200 &&
                        jsonObject(await response.json()).running === true
                    )
                }, 'restart before account registration recovery')
                assert.equal(
                    await command(['docker', 'exec', runtimeContainer, 'sha256sum', accountFile]),
                    pendingAccountDigest,
                )
                passed(
                    'private ACME registration key is persisted before network access and survives restart',
                )
            } else {
                assert.equal(digest, pendingAccountDigest)
                passed('failed account registration retries reuse the persisted private key')
            }
        }
        await command([
            'docker',
            'network',
            'connect',
            '--alias',
            'pebble',
            network,
            pebbleContainer,
        ])
        await waitForPebbleNetwork()

        const acmeIssue = await controllerRequest(
            '/internal/v1/certificates/' + acmeId + '/issue',
            {
                method: 'POST',
                body: JSON.stringify({
                    domains: ['acme.invalid'],
                    environment: 'staging',
                    acceptTerms: true,
                }),
            },
        )
        assert.equal(acmeIssue.status, 202)
        await waitFor(
            async () => {
                const metadata = jsonObject(
                    await (await controllerRequest('/internal/v1/certificates/' + acmeId)).json(),
                )
                return metadata.operation === 'idle'
            },
            'Pebble ACME HTTP-01 issuance',
            90_000,
        )
        const acmeMetadata = jsonObject(
            await (await controllerRequest('/internal/v1/certificates/' + acmeId)).json(),
        )
        assertCertificateIssued(acmeMetadata)
        assert.equal(acmeMetadata.source, 'acme')
        assert.equal(acmeMetadata.environment, 'staging')
        assert.equal(typeof acmeMetadata.fingerprint, 'string')
        assert.equal(
            upstreamRequests.some((request) => request.includes('/.well-known/acme-challenge/')),
            false,
        )
        passed(
            'real Pebble account/order HTTP-01 issuance completes; challenge traffic does not reach the upstream',
        )
        const accountBeforeRenewal = await command([
            'docker',
            'exec',
            runtimeContainer,
            'sha256sum',
            accountFile,
        ])
        const failedAuthorizationId = uuidV7()
        const failedAuthorization = await controllerRequest(
            '/internal/v1/certificates/' + failedAuthorizationId + '/issue',
            {
                method: 'POST',
                body: JSON.stringify({
                    domains: ['failed.invalid'],
                    environment: 'staging',
                    acceptTerms: true,
                }),
            },
        )
        assert.equal(failedAuthorization.status, 202)
        await waitFor(
            async () => {
                const metadata = jsonObject(
                    await (
                        await controllerRequest(
                            '/internal/v1/certificates/' + failedAuthorizationId,
                        )
                    ).json(),
                )
                return metadata.operation === 'idle'
            },
            'failed Pebble authorization',
            90_000,
        )
        const failedAuthorizationMetadata = jsonObject(
            await (
                await controllerRequest('/internal/v1/certificates/' + failedAuthorizationId)
            ).json(),
        )
        assert.equal(failedAuthorizationMetadata.status, 'failed')
        assert.equal(failedAuthorizationMetadata.lastErrorCode, 'acme_failed')
        passed('unroutable authorization fails with the safe acme_failed code')
        await apply(
            await snapshot([{ ...one }, { ...acmeHost, certificateId: acmeId, forceHttps: true }]),
        )
        const acmeHttps = await curl([
            '--cacert',
            temp + '/issuance-root.pem',
            '--resolve',
            'acme.invalid:' + httpsPort + ':127.0.0.1',
            'https://acme.invalid:' + httpsPort + '/issued',
        ])
        assert.match(acmeHttps, /certificate-smoke-backend/u)
        passed(
            'issued Pebble certificate is installed and verified through the fetched issuance root',
        )

        const issuedFingerprint = acmeMetadata.fingerprint
        await command(['docker', 'network', 'disconnect', network, pebbleContainer], {
            timeoutMs: 30_000,
        })
        const failedRenew = await controllerRequest(
            '/internal/v1/certificates/' + acmeId + '/renew',
            { method: 'POST', body: '{}' },
        )
        assert.equal(failedRenew.status, 202)
        await waitFor(
            async () => {
                const metadata = jsonObject(
                    await (await controllerRequest('/internal/v1/certificates/' + acmeId)).json(),
                )
                return metadata.operation === 'idle'
            },
            'bounded failed renewal recovery',
            90_000,
        )
        const afterFailedRenew = jsonObject(
            await (await controllerRequest('/internal/v1/certificates/' + acmeId)).json(),
        )
        assert.equal(afterFailedRenew.status, 'valid')
        assert.equal(afterFailedRenew.lastErrorCode, 'acme_failed')
        assert.equal(afterFailedRenew.fingerprint, issuedFingerprint)
        const afterFailedRenewTraffic = await curl([
            '--cacert',
            temp + '/issuance-root.pem',
            '--resolve',
            'acme.invalid:' + httpsPort + ':127.0.0.1',
            'https://acme.invalid:' + httpsPort + '/renewal-failure',
        ])
        assert.match(afterFailedRenewTraffic, /certificate-smoke-backend/u)
        passed(
            'failed ACME renewal preserves the previous certificate and HTTPS traffic, then returns to idle',
        )

        await command(
            ['docker', 'network', 'connect', '--alias', 'pebble', network, pebbleContainer],
            { timeoutMs: 30_000 },
        )
        await waitForPebbleNetwork()
        const successfulRenew = await controllerRequest(
            '/internal/v1/certificates/' + acmeId + '/renew',
            { method: 'POST', body: '{}' },
        )
        assert.equal(successfulRenew.status, 202)
        await waitFor(
            async () => {
                const metadata = jsonObject(
                    await (await controllerRequest('/internal/v1/certificates/' + acmeId)).json(),
                )
                return metadata.operation === 'idle'
            },
            'successful ACME renewal',
            90_000,
        )
        const afterRenew = jsonObject(
            await (await controllerRequest('/internal/v1/certificates/' + acmeId)).json(),
        )
        assertCertificateIssued(afterRenew)
        assert.notEqual(afterRenew.fingerprint, issuedFingerprint)
        assert.equal(
            await command(['docker', 'exec', runtimeContainer, 'sha256sum', accountFile]),
            accountBeforeRenewal,
        )
        const renewedTraffic = await curl([
            '--cacert',
            temp + '/issuance-root.pem',
            '--resolve',
            'acme.invalid:' + httpsPort + ':127.0.0.1',
            'https://acme.invalid:' + httpsPort + '/renewed',
        ])
        assert.match(renewedTraffic, /certificate-smoke-backend/u)
        passed(
            'ACME renewal reuses the persisted account and installs new certificate material after recovery',
        )
        await restartRuntime()
        await waitFor(async () => {
            const status = await controllerRequest('/internal/v1/proxy/status')
            return status.status === 200 && jsonObject(await status.json()).running === true
        }, 'controller restart with persisted certificate state')
        assert.equal(
            jsonObject(
                await (await controllerRequest('/internal/v1/certificates/' + acmeId)).json(),
            ).fingerprint,
            afterRenew.fingerprint,
        )
        assert.equal(
            await command(['docker', 'exec', runtimeContainer, 'sha256sum', accountFile]),
            accountBeforeRenewal,
        )
        assert.match(
            await curl([
                '--cacert',
                temp + '/issuance-root.pem',
                '--resolve',
                'acme.invalid:' + httpsPort + ':127.0.0.1',
                'https://acme.invalid:' + httpsPort + '/restart',
            ]),
            /certificate-smoke-backend/u,
        )
        passed('controller restart preserves account, metadata and live HTTPS configuration')

        const wildcardId = uuidV7()
        const dnsRequest = {
            domains: ['*.example.com', 'example.com'],
            environment: 'staging',
            acceptTerms: true,
            challengeType: 'dns-01',
            dnsProvider: { type: 'cloudflare', zoneId: dnsFixture.zoneId, apiToken: dnsToken },
        }
        const forbiddenHttpWildcard = await controllerRequest(
            '/internal/v1/certificates/' + uuidV7() + '/issue',
            {
                method: 'POST',
                body: JSON.stringify({
                    ...dnsRequest,
                    challengeType: 'http-01',
                    dnsProvider: undefined,
                }),
            },
        )
        assert.equal(forbiddenHttpWildcard.status, 422)
        const wildcardIssue = await controllerRequest(
            '/internal/v1/certificates/' + wildcardId + '/issue',
            { method: 'POST', body: JSON.stringify(dnsRequest) },
        )
        assert.equal(wildcardIssue.status, 202)
        async function waitForDnsCertificate() {
            let metadata: Record<string, any> = {}
            await waitFor(
                async () => {
                    metadata = jsonObject(
                        await (
                            await controllerRequest('/internal/v1/certificates/' + wildcardId)
                        ).json(),
                    )
                    return metadata.operation === 'idle'
                },
                'Pebble DNS-01 operation',
                180_000,
            )
            assertCertificateIssued(metadata)
            return metadata
        }
        const wildcardIssued = await waitForDnsCertificate()
        assert.deepEqual(wildcardIssued.domains, ['*.example.com', 'example.com'])
        assert.ok(dnsFixture.maxSimultaneousTxt >= 2)
        assert.equal(dnsFixture.records.length, 0)
        passed('mixed apex/wildcard DNS-01 validates simultaneous TXT proofs and cleans up')
        const wildcardProxy = host(uuidV7(), 'proxy.example.com', backend.port!, wildcardId)
        const wildcardApex = host(uuidV7(), 'example.com', backend.port!, wildcardId)
        const wildcardRedirect = redirectHost(
            uuidV7(),
            'redirect.example.com',
            'https://example.org',
            wildcardId,
        )
        const wildcardSnapshot = snapshot([wildcardProxy, wildcardApex], [wildcardRedirect])
        await apply(wildcardSnapshot)
        async function checkWildcardTraffic() {
            for (const name of ['proxy.example.com', 'example.com']) {
                const response = await curl([
                    '--cacert',
                    temp + '/issuance-root.pem',
                    '--resolve',
                    name + ':' + httpsPort + ':127.0.0.1',
                    'https://' + name + ':' + httpsPort + '/wildcard',
                ])
                assert.match(response, /certificate-smoke-backend/u)
            }
            const redirectResponse = await curl([
                '--include',
                '--cacert',
                temp + '/issuance-root.pem',
                '--resolve',
                'redirect.example.com:' + httpsPort + ':127.0.0.1',
                'https://redirect.example.com:' + httpsPort + '/wildcard',
            ])
            assert.match(redirectResponse, /HTTP\/1\.1 308/u)
            assert.match(redirectResponse, /Location: https:\/\/example\.org\/wildcard/iu)
        }
        await checkWildcardTraffic()
        for (const unrelated of ['deep.proxy.example.com', 'unrelated.org']) {
            const rejected = await controllerRequest('/internal/v1/proxy/config', {
                method: 'PUT',
                body: JSON.stringify(
                    snapshot([host(uuidV7(), unrelated, backend.port!, wildcardId)]),
                ),
            })
            assert.notEqual(rejected.status, 200)
        }
        passed(
            'wildcard certificate serves Proxy/Redirect Hosts and rejects deeper/unrelated hosts',
        )
        const stateJson = await command([
            'docker',
            'exec',
            runtimeContainer,
            'cat',
            '/var/lib/rentnerproxy/proxy/certificates/certificate-metadata.json',
        ])
        assert.equal(stateJson.includes(dnsToken), false)
        await restartRuntime()
        await waitFor(
            async () => (await controllerRequest('/internal/v1/proxy/status')).status === 200,
            'restart before DNS renewal',
        )
        assert.equal(
            (
                await controllerRequest('/internal/v1/certificates/' + wildcardId + '/renew', {
                    method: 'POST',
                    body: '{}',
                })
            ).status,
            202,
        )
        const wildcardRenewed = await waitForDnsCertificate()
        assert.notEqual(wildcardRenewed.fingerprint, wildcardIssued.fingerprint)
        assert.equal(
            jsonObject(await (await controllerRequest('/internal/v1/proxy/status')).json())
                .activeRevision,
            wildcardSnapshot.revision,
        )
        assert.equal(dnsFixture.records.length, 0)
        await checkWildcardTraffic()
        passed(
            'DNS renewal decrypts persisted credentials after restart and retains host assignments',
        )

        dnsFixture.failCleanup = true
        assert.equal(
            (
                await controllerRequest('/internal/v1/certificates/' + wildcardId + '/renew', {
                    method: 'POST',
                    body: '{}',
                })
            ).status,
            202,
        )
        let cleanupFailure: Record<string, any> = {}
        await waitFor(
            async () => {
                cleanupFailure = jsonObject(
                    await (
                        await controllerRequest('/internal/v1/certificates/' + wildcardId)
                    ).json(),
                )
                return cleanupFailure.operation === 'idle'
            },
            'visible DNS cleanup failure',
            180_000,
        )
        assert.equal(cleanupFailure.lastErrorCode, 'dns_cleanup_failed')
        assert.equal(cleanupFailure.status, 'valid')
        assert.equal(cleanupFailure.fingerprint, wildcardRenewed.fingerprint)
        assert.ok(dnsFixture.records.length > 0)
        await checkWildcardTraffic()
        dnsFixture.failCleanup = false
        await restartRuntime()
        await waitFor(
            async () => (await controllerRequest('/internal/v1/proxy/status')).status === 200,
            'restart with pending DNS cleanup',
        )
        assert.equal(
            (
                await controllerRequest('/internal/v1/certificates/' + wildcardId + '/renew', {
                    method: 'POST',
                    body: '{}',
                })
            ).status,
            202,
        )
        await waitForDnsCertificate()
        assert.equal(dnsFixture.records.length, 0)
        await checkWildcardTraffic()
        passed(
            'failed DNS cleanup preserves live TLS and pending proofs are cleaned on retry after restart',
        )

        const unrelatedDnsId = uuidV7()
        assert.equal(
            (
                await controllerRequest('/internal/v1/certificates/' + unrelatedDnsId + '/issue', {
                    method: 'POST',
                    body: JSON.stringify({ ...dnsRequest, domains: ['unrelatedexample.com'] }),
                })
            ).status,
            202,
        )
        let unrelatedMetadata: Record<string, any> = {}
        await waitFor(async () => {
            unrelatedMetadata = jsonObject(
                await (
                    await controllerRequest('/internal/v1/certificates/' + unrelatedDnsId)
                ).json(),
            )
            return unrelatedMetadata.operation === 'idle'
        }, 'DNS zone boundary validation')
        assert.equal(unrelatedMetadata.status, 'failed')
        assert.equal(dnsFixture.records.length, 0)
        passed('DNS provider authorization cannot expand to an unrelated zone')

        const unauthorized = await fetch(controllerUrl + '/internal/v1/certificates').catch(
            () => null,
        )
        assert.equal(unauthorized?.status, 401)
        const list = jsonObject(await (await controllerRequest('/internal/v1/certificates')).json())
        assert.ok(Array.isArray(list.certificates))
        assert.equal(JSON.stringify(list).includes('BEGIN '), false)
        assert.equal(JSON.stringify(list).includes(dnsToken), false)
        passed('certificate endpoints require the controller token and never return keys or PEM')
        console.log('Certificate HTTPS/ACME integration: ' + assertions + ' checks passed.')
    } finally {
        backend?.stop(true)
        dnsFixture?.stop()
        await command(['docker', 'rm', '--force', '--volumes', runtimeContainer]).catch(
            () => undefined,
        )
        await command(['docker', 'rm', '--force', '--volumes', pebbleContainer]).catch(
            () => undefined,
        )
        if (certSource)
            await command(['docker', 'rm', '--force', certSource]).catch(() => undefined)
        await command(['docker', 'volume', 'rm', stateVolume]).catch(() => undefined)
        await command(['docker', 'network', 'rm', network]).catch(() => undefined)
        await command(['docker', 'image', 'rm', runtimeImage]).catch(() => undefined)
        if (isOwnedTempDirectory(temp)) await rm(temp, { recursive: true, force: true })
    }
}

if (!existsSync(repositoryRoot + '/docker/proxy-runtime/Dockerfile')) {
    throw new Error('Run this smoke from the RentnerProxy repository.')
}
await runSmoke()
