import { certificateRetryIndexSchema } from './responses.validation.ts'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { isIP } from 'node:net'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { startCertificateDnsFixture } from './dns-fixture.ts'
import { refreshManualDnsForwarder } from './dns-forwarder.ts'
import { buildHttp3Client } from '../http3/client.ts'
import type { CertificateSetupContext } from './Types/scenarios.types.ts'

export async function verifyCertificateSetup(context: CertificateSetupContext) {
    await context.command(['docker', 'version', '--format', '{{.Server.Version}}'])

    const curlVersion = await context.command(['curl', '--version'])
    if (curlVersion.includes('Schannel')) {
        context.curlTestCaArgs = ['--ssl-revoke-best-effort']
    }
    try {
        await context.command(['openssl', 'version'])
    } catch {
        context.opensslMode = 'docker'
    }
    context.opensslTempDirectory = context.temp
    await context.command(['docker', 'pull', context.pebbleImage], {
        inherit: true,
        timeoutMs: 300_000,
    })
    await context.buildRuntimeImage()
    await buildHttp3Client(context.command, context.http3Image)
    await context.command(['docker', 'network', 'create', '--ipv6', context.network])
    await context.command(
        [
            'docker',
            'run',
            '--detach',
            '--name',
            context.trustedProxyContainer,
            '--network',
            context.network,
            '--volume',
            context.temp + ':/test:ro',
            '--entrypoint',
            '/usr/bin/tail',
            context.runtimeImage,
            '-f',
            '/dev/null',
        ],
        { timeoutMs: 60_000 },
    )
    const trustedAddresses = await context.command([
        'docker',
        'inspect',
        '--format',
        '{{range .NetworkSettings.Networks}}{{.IPAddress}}|{{.GlobalIPv6Address}}{{end}}',
        context.trustedProxyContainer,
    ])
    const [trustedProxyIpv4, trustedProxyIpv6] = trustedAddresses.split('|')
    assert.ok(trustedProxyIpv4 && isIP(trustedProxyIpv4) === 4)
    assert.ok(trustedProxyIpv6 && isIP(trustedProxyIpv6) === 6)
    await context.command(['docker', 'volume', 'create', context.stateVolume])
    context.dnsFixture = await startCertificateDnsFixture(context.dnsToken)

    context.certSource = context.project + '-cert-source'
    await context.command(['docker', 'create', '--name', context.certSource, context.pebbleImage])
    await context.command([
        'docker',
        'cp',
        context.certSource + ':/test/certs/pebble.minica.pem',
        context.minicaPath,
    ])
    await context.command(['docker', 'rm', '--force', context.certSource])

    await context.openssl([
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        context.temp + '/ca.key',
        '-out',
        context.temp + '/ca.pem',
        '-days',
        '1',
        '-subj',
        '/CN=RentnerProxy smoke CA',
        '-addext',
        'basicConstraints=critical,CA:TRUE',
        '-addext',
        'keyUsage=critical,keyCertSign,cRLSign',
    ])
    const first = await context.generateCertificateMaterial(context.temp, 'one.test', 'one.test')
    const second = await context.generateCertificateMaterial(context.temp, 'two.test', 'two.test')
    const redirectCertificate = await context.generateCertificateMaterial(
        context.temp,
        'redirect.test',
        'redirect.test',
    )
    const mismatch = await context.generateCertificateMaterial(
        context.temp,
        'mismatch.test',
        'mismatch.test',
    )
    const replacement = await context.generateCertificateMaterial(
        context.temp,
        'one-replacement.test',
        'one.test',
    )
    const firstFingerprint = await context.fingerprint(first.certificatePem)
    const secondFingerprint = await context.fingerprint(second.certificatePem)
    const replacementFingerprint = await context.fingerprint(replacement.certificatePem)

    const pebbleConfigPath = context.temp + '/pebble-config.json'
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

    const pebbleManagementPort = await context.freePort()
    await context.command(
        [
            'docker',
            'run',
            '--detach',
            '--name',
            context.pebbleContainer,
            '--network',
            context.network,
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
            context.pebbleImage,
            '-config',
            '/tmp/pebble-config.json',
            '-strict',
            '-dnsserver',
            'host.docker.internal:' + context.dnsFixture.dnsPort,
        ],
        { timeoutMs: 60_000 },
    )
    context.pebbleManagementUrl = 'https://localhost:' + pebbleManagementPort
    await context.waitFor(async () => {
        const result = await context
            .command([
                'curl',
                '--silent',
                '--show-error',
                '--fail',
                '--cacert',
                context.minicaPath,
                '--resolve',
                'localhost:' + pebbleManagementPort + ':127.0.0.1',
                context.pebbleManagementUrl + '/roots/0',
            ])
            .catch(() => '')
        return result.includes('BEGIN CERTIFICATE')
    }, 'Pebble management API')
    const dynamicRoot = await context.command([
        'curl',
        '--silent',
        '--show-error',
        '--fail',
        '--cacert',
        context.minicaPath,
        '--resolve',
        'localhost:' + pebbleManagementPort + ':127.0.0.1',
        context.pebbleManagementUrl + '/roots/0',
    ])
    assert.match(dynamicRoot, /BEGIN CERTIFICATE/u)
    await writeFile(context.temp + '/issuance-root.pem', dynamicRoot)
    context.passed('pinned Pebble starts; endpoint CA and dynamic issuance root are kept separate')

    const httpPort = await context.freePort()
    const httpsPort = await context.freePort()
    const tcpOnlyHttpsPort = await context.freePort()
    const controllerPort = await context.freePort()
    const upstreamRequests: string[] = []
    context.backend = Bun.serve({
        hostname: '0.0.0.0',
        port: 0,
        async fetch(request) {
            const url = new URL(request.url)
            const requestBody = await request.text()
            upstreamRequests.push(request.method + ' ' + url.pathname + url.search)
            if (url.pathname === '/basic-auth') {
                assert.equal(request.headers.has('authorization'), false)
            }
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
    assert.ok(context.backend.port)

    await context.command(
        [
            'docker',
            'run',
            '--detach',
            '--name',
            context.runtimeContainer,
            '--network',
            context.network,
            '--network-alias',
            'one.test',
            '--network-alias',
            'two.test',
            '--network-alias',
            'plain.invalid',
            '--network-alias',
            'acme.invalid',
            '--network-alias',
            'certificate-job.example.com',
            '--add-host',
            'host.docker.internal:host-gateway',
            '--publish',
            '127.0.0.1:' + httpPort + ':8080',
            '--publish',
            '127.0.0.1:' + httpsPort + ':8443',
            '--publish',
            '127.0.0.1:' + httpsPort + ':8443/udp',
            '--publish',
            '127.0.0.1:' + tcpOnlyHttpsPort + ':8443/tcp',
            '--publish',
            '127.0.0.1:' + controllerPort + ':8081',
            '--env',
            'RENTNERPROXY_CONTROLLER_LISTEN_ADDR=0.0.0.0:8081',
            '--env',
            'RENTNERPROXY_CONTROLLER_TOKEN=' + context.token,
            '--env',
            'RENTNERPROXY_PROXY_HTTP_PORT=8080',
            '--env',
            'RENTNERPROXY_PROXY_HTTPS_PORT=8443',
            '--env',
            'RENTNERPROXY_PROXY_PUBLIC_HTTPS_PORT=' + httpsPort,
            '--env',
            'PROXY_TRUSTED_PROXY_CIDRS=' + trustedProxyIpv4 + '/32,' + trustedProxyIpv6 + '/128',
            '--env',
            'RENTNERPROXY_ACME_TEST_DIRECTORY_URL=https://pebble:14000/dir',
            '--env',
            'RENTNERPROXY_ACME_TEST_ROOT_CERT=/test/pebble.minica.pem',
            '--env',
            'RENTNERPROXY_ACME_TEST_DNS_ADDR=127.0.0.1:15353',
            '--env',
            'APP_ENCRYPTION_KEY=' + randomBytes(32).toString('base64'),
            '--env',
            'RENTNERPROXY_DNS_TEST_API_URL=http://host.docker.internal:' +
                context.dnsFixture.apiPort +
                '/client/v4',
            '--env',
            'RENTNERPROXY_PROXY_STATE_DIR=/var/lib/rentnerproxy/proxy',
            '--volume',
            context.stateVolume + ':/var/lib/rentnerproxy/proxy',
            '--volume',
            context.minicaPath + ':/test/pebble.minica.pem:ro',
            context.runtimeImage,
        ],
        { timeoutMs: 60_000 },
    )
    context.controllerUrl = 'http://127.0.0.1:' + controllerPort
    const dnsAddresses = context.dnsFixture.addresses
    async function refreshRuntimeDns(): Promise<void> {
        await refreshManualDnsForwarder(context)
        context.runtimeIpv4 = await context.command([
            'docker',
            'inspect',
            '--format',
            '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}',
            context.runtimeContainer,
        ])
        context.runtimeIpv6 = await context.command([
            'docker',
            'inspect',
            '--format',
            '{{range .NetworkSettings.Networks}}{{.GlobalIPv6Address}}{{end}}',
            context.runtimeContainer,
        ])
        dnsAddresses.set('acme.invalid', context.runtimeIpv4)
        dnsAddresses.set('certificate-job.example.com', context.runtimeIpv4)
    }
    async function restartRuntime(): Promise<void> {
        await context.command(['docker', 'restart', context.runtimeContainer], {
            timeoutMs: 60_000,
        })

        await refreshRuntimeDns()
        await waitForRuntimeReady()
    }
    async function waitForRuntimeReady(): Promise<void> {
        await context.waitFor(async () => {
            const response = await controllerRequest('/internal/v1/proxy/status')
            if (!response.ok) return false
            const status = context.jsonObject(await response.json())
            return status.available === true && status.running === true
        }, 'Caddy runtime ready after restart')
    }
    async function expireRetryFixture(certificateId: string): Promise<void> {
        await context.command(['docker', 'stop', context.runtimeContainer], { timeoutMs: 60_000 })
        const indexPath = '/var/lib/rentnerproxy/proxy/certificates/certificate-metadata.json'
        const fixturePath = resolve(context.temp, 'retry-index.json')
        await context.command([
            'docker',
            'cp',
            context.runtimeContainer + ':' + indexPath,
            fixturePath,
        ])
        const index = certificateRetryIndexSchema.parse(
            JSON.parse(await Bun.file(fixturePath).text()),
        )
        const entry = index.certificates[certificateId]
        assert.ok(entry)
        entry.nextAttemptAt = '2000-01-01T00:00:00Z'
        delete entry.retryAfter
        await writeFile(fixturePath, JSON.stringify(index), { mode: 0o600 })
        await context.command([
            'docker',
            'cp',
            fixturePath,
            context.runtimeContainer + ':' + indexPath,
        ])
        await context.command([
            'docker',
            'run',
            '--rm',
            '--user',
            '0',
            '--entrypoint',
            'sh',
            '--volume',
            context.stateVolume + ':/var/lib/rentnerproxy/proxy',
            context.runtimeImage,
            '-c',
            'chown 10001:10001 "$1" && chmod 600 "$1"',
            'fixture',
            indexPath,
        ])
        await context.command(['docker', 'start', context.runtimeContainer])
        await refreshRuntimeDns()
        await waitForRuntimeReady()
    }
    await refreshRuntimeDns()
    context.httpUrl = 'http://127.0.0.1:' + httpPort
    await context.waitFor(async () => {
        const response = await fetch(context.controllerUrl + '/health').catch(() => null)
        return response?.status === 200
    }, 'controller health')
    await context.waitFor(async () => {
        const response = await fetch(context.controllerUrl + '/internal/v1/proxy/status', {
            headers: { authorization: 'Bearer ' + context.token },
        }).catch(() => null)
        return response?.status === 200 && (await response.json()).running === true
    }, 'Caddy startup')
    const portBindings = await context.command([
        'docker',
        'inspect',
        '--format',
        '{{json .HostConfig.PortBindings}}',
        context.runtimeContainer,
    ])
    assert.deepEqual(JSON.parse(portBindings)['8443/udp'], [
        { HostIp: '127.0.0.1', HostPort: String(httpsPort) },
    ])
    context.passed('isolated controller and Caddy runtime are ready')

    async function controllerRequest(path: string, options: RequestInit = {}): Promise<Response> {
        const response = await fetch(context.controllerUrl + path, {
            ...options,
            headers: {
                accept: 'application/json',
                authorization: 'Bearer ' + context.token,
                ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
            },
            signal: AbortSignal.timeout(30_000),
        })
        return response
    }

    async function waitForPebbleNetwork(): Promise<void> {
        await context.waitFor(async () => {
            await context.command(
                [
                    'docker',
                    'exec',
                    context.runtimeContainer,
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
        const response = await controllerRequest('/internal/v1/certificates/' + id + '/import', {
            method: 'POST',
            body: JSON.stringify({
                certificatePem: await Bun.file(material.certificatePem).text(),
                privateKeyPem: await Bun.file(material.privateKeyPem).text(),
                chainPem: await Bun.file(context.temp + '/ca.pem').text(),
                requiredDomains: domains,
            }),
        })
        assert.equal(response.status, 200)
        return context.jsonObject(await response.json())
    }

    const firstId = Bun.randomUUIDv7()
    const secondId = Bun.randomUUIDv7()
    const redirectCertificateId = Bun.randomUUIDv7()
    const acmeId = Bun.randomUUIDv7()
    const firstMetadata = await importCertificate(firstId, first, ['one.test'])
    const secondMetadata = await importCertificate(secondId, second, ['two.test'])
    const redirectMetadata = await importCertificate(redirectCertificateId, redirectCertificate, [
        'redirect.test',
    ])
    assert.equal(firstMetadata.source, 'manual')
    assert.equal(secondMetadata.source, 'manual')
    assert.equal(redirectMetadata.source, 'manual')
    const preImportMetadata = JSON.stringify([firstMetadata, secondMetadata, redirectMetadata])
    assert.equal(preImportMetadata.includes('BEGIN '), false)
    assert.equal(preImportMetadata.includes('PRIVATE KEY'), false)
    assert.equal(preImportMetadata.includes(context.temp), false)
    assert.equal(preImportMetadata.includes('private-key.pem'), false)
    context.passed(
        'manual certificates import with metadata only; PEM/key material is not returned',
    )

    async function apply(configuration: unknown): Promise<void> {
        const response = await controllerRequest('/internal/v1/proxy/config', {
            method: 'PUT',
            body: JSON.stringify(configuration),
        })
        assert.equal(response.status, 200)
        await context.waitFor(async () => {
            const status = context.jsonObject(
                await (await controllerRequest('/internal/v1/proxy/status')).json(),
            )
            return status.activeRevision === context.jsonObject(configuration).revision
        }, 'configuration apply')
    }
    async function curl(args: string[]): Promise<string> {
        return context.command(['curl', '--silent', '--show-error', '--noproxy', '*', ...args], {
            timeoutMs: 15_000,
        })
    }
    async function trustedProxyCurl(
        addressFamily: 'ipv4' | 'ipv6',
        args: string[],
        path = '/',
    ): Promise<string> {
        const runtimeAddress =
            addressFamily === 'ipv4'
                ? context.runtimeIpv4
                : (() => {
                      assert.ok(context.runtimeIpv6)
                      return '[' + context.runtimeIpv6 + ']'
                  })()
        return context.command([
            'docker',
            'exec',
            context.trustedProxyContainer,
            'curl',
            '--silent',
            '--show-error',
            '--noproxy',
            '*',
            '--include',
            '--max-time',
            '5',
            ...args,
            'http://' + runtimeAddress + ':8080' + path,
        ])
    }
    async function trustedTlsFrontCurl(args: string[], path = '/'): Promise<string> {
        return context.command([
            'docker',
            'exec',
            '--user',
            '0',
            context.trustedProxyContainer,
            '/usr/bin/curl',
            '--silent',
            '--show-error',
            '--noproxy',
            '*',
            '--include',
            '--max-time',
            '5',
            '--cacert',
            '/test/ca.pem',
            '--resolve',
            'one.test:9443:127.0.0.1',
            ...args,
            'https://one.test:9443' + path,
        ])
    }
    async function servedCertificateFingerprint(
        hostname: string,
        outputPath: string,
    ): Promise<string> {
        const served = await context
            .openssl(
                [
                    's_client',
                    '-connect',
                    '127.0.0.1:' + httpsPort,
                    '-servername',
                    hostname,
                    '-CAfile',
                    context.temp + '/issuance-root.pem',
                    '-showcerts',
                ],
                15_000,
            )
            .catch(() => '')
        const pem = served.match(
            /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/u,
        )?.[0]
        assert.ok(pem)
        await writeFile(outputPath, pem)
        return 'sha256:' + (await context.fingerprint(outputPath))
    }
    return {
        first,
        mismatch,
        replacement,
        firstFingerprint,
        secondFingerprint,
        replacementFingerprint,
        httpPort,
        httpsPort,
        tcpOnlyHttpsPort,
        upstreamRequests,
        restartRuntime,
        expireRetryFixture,
        controllerRequest,
        waitForPebbleNetwork,
        importCertificate,
        firstId,
        secondId,
        redirectCertificateId,
        acmeId,
        apply,
        curl,
        trustedProxyCurl,
        trustedTlsFrontCurl,
        servedCertificateFingerprint,
    }
}
