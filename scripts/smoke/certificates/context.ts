// oxlint-disable no-await-in-loop -- Runtime image build retries run sequentially.
import {
    certificateOperationSchema,
    certificateCandidateSchema,
    certificateEventsSchema,
} from './responses.validation.ts'
import { runSmokeProcess } from '../process.ts'
import { waitForSmoke } from '../wait.ts'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { basename, dirname, resolve } from 'node:path'
import { sharedSmokeImage, verifySharedSmokeImage } from '../images.ts'
import { smokeDockerArguments } from '../resources.ts'
import { startCertificateDnsFixture } from './dns-fixture.ts'
import { CERTIFICATE_ERROR_CODES } from '../../../web/src/config/certificates.config.ts'

const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url))
const runId = randomUUID().replaceAll('-', '').slice(0, 12)
const project = 'rentnerproxy-certificate-smoke-' + runId
const network = project + '-network'
const runtimeContainer = project + '-runtime'
const trustedProxyContainer = project + '-trusted-proxy'
const pebbleContainer = project + '-pebble'
const runtimeImage = sharedSmokeImage('proxy-runtime') ?? project + ':runtime'
const http3Image = sharedSmokeImage('http3-client') ?? project + ':http3-client'
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

async function command(
    args: string[],
    options: { readonly inherit?: boolean; readonly timeoutMs?: number } = {},
): Promise<string> {
    const { exitCode, stdout, stderr, timedOut } = await runSmokeProcess(
        smokeDockerArguments(
            args[0] === 'curl' ? ['curl', ...curlTestCaArgs, ...args.slice(1)] : args,
        ),
        {
            cwd: repositoryRoot,
            env: environment,

            timeoutMs: options.timeoutMs ?? 30_000,
            ...(options.inherit === undefined ? {} : { inherit: options.inherit }),
        },
    )
    if (exitCode !== 0 || timedOut)
        throw new Error('Smoke command failed: ' + args.slice(0, 3).join(' '))
    return (stdout || stderr).trim()
}

async function buildRuntimeImage(): Promise<void> {
    if (sharedSmokeImage('proxy-runtime')) {
        await verifySharedSmokeImage(command, 'proxy-runtime')
        return
    }
    const args = [
        'docker',
        'build',
        '--tag',
        runtimeImage,
        '--file',
        'docker/proxy-runtime/Dockerfile',
        '.',
    ]

    for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
            await command(args, { inherit: true, timeoutMs: 900_000 })
            return
        } catch (error) {
            if (attempt === 2) throw error
            console.warn('Docker runtime image build failed; retrying once.')
            await Bun.sleep(2_000)
        }
    }
}

function waitFor(check: () => Promise<boolean>, label: string, timeoutMs = 45_000): Promise<void> {
    return waitForSmoke(check, {
        timeoutMs,
        intervalMs: 250,
        timeoutError: () => new Error('Timed out waiting for ' + label),
    })
}

function passed(label: string): void {
    assertions += 1
    console.log('PASS ' + label)
}

function jsonObject(value: unknown): Record<string, unknown> {
    assert.equal(typeof value, 'object')
    assert.notEqual(value, null)
    assert.equal(Array.isArray(value), false)
    return value as Record<string, unknown>
}

function assertCertificateIssued(metadata: Record<string, unknown>): void {
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
            ...(input.accessPolicy === undefined ? {} : { accessPolicy: input.accessPolicy }),
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

export async function createCertificateSmokeContext() {
    const temp = await mkdtemp(tmpdir() + '/rentnerproxy-certificate-smoke-')
    const stateVolume = project + '-state'
    let backend: ReturnType<typeof Bun.serve> | undefined
    let dnsFixture: Awaited<ReturnType<typeof startCertificateDnsFixture>> | undefined
    const dnsToken = randomBytes(32).toString('hex')
    let controllerUrl = ''
    let httpUrl = ''
    let runtimeIpv4 = ''
    let runtimeIpv6 = ''
    let pebbleManagementUrl = ''
    let minicaPath = temp + '/pebble.minica.pem'
    let certSource = ''

    return {
        project,
        network,
        runtimeContainer,
        trustedProxyContainer,
        pebbleContainer,
        runtimeImage,
        http3Image,
        pebbleImage,
        token,
        get assertions() {
            return assertions
        },
        set assertions(value: typeof assertions) {
            assertions = value
        },
        get opensslMode() {
            return opensslMode
        },
        set opensslMode(value: typeof opensslMode) {
            opensslMode = value
        },
        get curlTestCaArgs() {
            return curlTestCaArgs
        },
        set curlTestCaArgs(value: typeof curlTestCaArgs) {
            curlTestCaArgs = value
        },
        get opensslTempDirectory() {
            return opensslTempDirectory
        },
        set opensslTempDirectory(value: typeof opensslTempDirectory) {
            opensslTempDirectory = value
        },
        command,
        buildRuntimeImage,
        waitFor,
        passed,
        jsonObject,
        certificateOperation: (value: unknown) => certificateOperationSchema.parse(value),
        certificateCandidate: (value: unknown) => certificateCandidateSchema.parse(value),
        certificateEvents: (value: unknown) => certificateEventsSchema.parse(value),
        assertCertificateIssued,
        freePort,
        openssl,
        generateCertificateMaterial,
        fingerprint,
        snapshot,
        host,
        redirectHost,
        temp,
        stateVolume,
        get backend() {
            return backend
        },
        set backend(value: typeof backend) {
            backend = value
        },
        get dnsFixture() {
            return dnsFixture
        },
        set dnsFixture(value: typeof dnsFixture) {
            dnsFixture = value
        },
        dnsToken,
        get controllerUrl() {
            return controllerUrl
        },
        set controllerUrl(value: typeof controllerUrl) {
            controllerUrl = value
        },
        get httpUrl() {
            return httpUrl
        },
        set httpUrl(value: typeof httpUrl) {
            httpUrl = value
        },
        get runtimeIpv4() {
            return runtimeIpv4
        },
        set runtimeIpv4(value: typeof runtimeIpv4) {
            runtimeIpv4 = value
        },
        get runtimeIpv6() {
            return runtimeIpv6
        },
        set runtimeIpv6(value: typeof runtimeIpv6) {
            runtimeIpv6 = value
        },
        get pebbleManagementUrl() {
            return pebbleManagementUrl
        },
        set pebbleManagementUrl(value: typeof pebbleManagementUrl) {
            pebbleManagementUrl = value
        },
        get minicaPath() {
            return minicaPath
        },
        set minicaPath(value: typeof minicaPath) {
            minicaPath = value
        },
        get certSource() {
            return certSource
        },
        set certSource(value: typeof certSource) {
            certSource = value
        },
    }
}

// Preserve accessors so captured helpers and cleanup observe recreated resource handles.
export function extendSmokeContext<T extends object, U extends object>(
    context: T,
    values: U,
): T & U {
    return Object.defineProperties(context, Object.getOwnPropertyDescriptors(values)) as T & U
}

export { repositoryRoot, isOwnedTempDirectory }
