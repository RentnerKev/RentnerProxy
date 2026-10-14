// oxlint-disable no-await-in-loop -- Bounded smoke scenarios preserve their sequential polling.
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import type { CertificateTrustedProxyContext } from './Types/scenarios.types.ts'

export async function verifyCertificateTrustedProxy(context: CertificateTrustedProxyContext) {
    assert.ok(context.backend)
    const one = context.host(
        Bun.randomUUIDv7(),
        'one.test',
        context.backend.port!,
        context.firstId,
        true,
    )
    const two = context.host(
        Bun.randomUUIDv7(),
        'two.test',
        context.backend.port!,
        context.secondId,
        true,
    )
    const acmeHost = context.host(Bun.randomUUIDv7(), 'acme.invalid', context.backend.port!)
    const plainHost = context.host(Bun.randomUUIDv7(), 'plain.invalid', context.backend.port!)
    const httpsRedirect = context.redirectHost(
        Bun.randomUUIDv7(),
        'redirect.test',
        'https://new.example.test/base',
        context.redirectCertificateId,
    )
    const initialSnapshot = context.snapshot([one, two, plainHost], [httpsRedirect])
    const preview = await context.controllerRequest('/internal/v1/proxy/config/preview', {
        method: 'POST',
        body: JSON.stringify(initialSnapshot),
    })
    assert.equal(preview.status, 200)
    const previewPayload = context.jsonObject(await preview.json())
    const previewSource = context.jsonObject(JSON.parse(previewPayload.config as string))
    assert.equal(typeof previewSource, 'object')
    assert.notEqual(previewSource, null)
    assert.equal(typeof context.jsonObject(previewSource).apps, 'object')
    assert.equal(JSON.stringify(previewSource).includes('BEGIN '), false)
    await context.apply(initialSnapshot)
    const trustedFrontConfigPath = context.temp + '/trusted-front.json'
    await writeFile(
        trustedFrontConfigPath,
        JSON.stringify({
            admin: { disabled: true },
            apps: {
                http: {
                    servers: {
                        'trusted-front': {
                            listen: [':9443'],
                            routes: [
                                {
                                    handle: [
                                        {
                                            handler: 'reverse_proxy',
                                            upstreams: [{ dial: context.runtimeIpv4 + ':8080' }],
                                            headers: {
                                                request: {
                                                    set: {
                                                        Host: ['{http.request.host}'],
                                                        'X-Forwarded-Proto': [
                                                            '{http.request.scheme}',
                                                        ],
                                                    },
                                                    delete: [
                                                        'Forwarded',
                                                        'X-Forwarded-For',
                                                        'X-Forwarded-Host',
                                                        'X-Forwarded-Port',
                                                        'X-Forwarded-Prefix',
                                                        'Proxy',
                                                    ],
                                                },
                                            },
                                        },
                                    ],
                                },
                            ],
                            automatic_https: { disable: true },
                            protocols: ['h1', 'h2'],
                            strict_sni_host: true,
                            tls_connection_policies: [
                                {
                                    match: { sni: ['one.test'] },
                                    certificate_selection: { any_tag: ['trusted-front'] },
                                    protocol_min: 'tls1.2',
                                    alpn: ['h2', 'http/1.1'],
                                },
                            ],
                        },
                    },
                },
                tls: {
                    certificates: {
                        load_files: [
                            {
                                certificate: '/test/one.test.pem',
                                key: '/test/one.test.key',
                                tags: ['trusted-front'],
                            },
                        ],
                    },
                },
            },
        }),
    )
    await context.command([
        'docker',
        'exec',
        '--user',
        '0',
        context.trustedProxyContainer,
        '/usr/bin/caddy',
        'validate',
        '--config',
        '/test/trusted-front.json',
    ])
    await context.command([
        'docker',
        'exec',
        '--user',
        '0',
        '--detach',
        context.trustedProxyContainer,
        '/usr/bin/caddy',
        'run',
        '--config',
        '/test/trusted-front.json',
    ])
    await context.waitFor(
        async () =>
            /^HTTP\/1\.1 200(?:\s|$)/u.test(
                await context.trustedTlsFrontCurl(['--http1.1'], '/trusted-front-ready'),
            ),
        'trusted TLS front listener',
    )
    const trustedFrontPath = '/trusted-front/post?query=front%2Frequest'
    for (const protocol of ['--http1.1', '--http2'] as const) {
        const frontResponse = await context.trustedTlsFrontCurl(
            [
                protocol,
                '--request',
                'POST',
                '--data',
                'front-body',
                '--header',
                'X-Forwarded-Proto: http',
            ],
            trustedFrontPath,
        )
        assert.match(
            frontResponse,
            protocol === '--http1.1' ? /^HTTP\/1\.1 200(?:\s|$)/u : /^HTTP\/2 200(?:\s|$)/u,
        )
        assert.doesNotMatch(frontResponse, /308/u)
        assert.match(frontResponse, /"method":"POST"/u)
        assert.match(frontResponse, /"path":"\/trusted-front\/post\?query=front%2Frequest"/u)
        assert.match(frontResponse, /"body":"front-body"/u)
    }
    context.passed(
        'real TLS front termination proxies h1/h2 POST traffic to the HTTP runtime and overwrites forged X-Forwarded-Proto',
    )
    const trustedPath = '/trusted-termination/path?query=a%2Fb'
    const trustedHeaders = ['--header', 'Host: one.test']
    const trustedAccepted = (addressFamily: 'ipv4' | 'ipv6') =>
        context.trustedProxyCurl(
            addressFamily,
            [
                '--request',
                'POST',
                '--data',
                'trusted-body',
                ...trustedHeaders,
                '--header',
                'X-Forwarded-Proto: https',
            ],
            trustedPath,
        )
    for (const addressFamily of ['ipv4', 'ipv6'] as const) {
        const accepted = await trustedAccepted(addressFamily)
        assert.match(accepted, /^HTTP\/1\.1 200(?:\s|$)/u)
        assert.match(accepted, /"method":"POST"/u)
        assert.match(accepted, /"path":"\/trusted-termination\/path\?query=a%2Fb"/u)
        assert.match(accepted, /"body":"trusted-body"/u)
    }
    const rejectionCases = [
        { label: 'http', headers: ['--header', 'X-Forwarded-Proto: http'] },
        { label: 'empty', headers: ['--header', 'X-Forwarded-Proto:'] },
        {
            label: 'duplicate same',
            headers: [
                '--header',
                'X-Forwarded-Proto: https',
                '--header',
                'X-Forwarded-Proto: https',
            ],
        },
        {
            label: 'duplicate different',
            headers: [
                '--header',
                'X-Forwarded-Proto: https',
                '--header',
                'X-Forwarded-Proto: http',
            ],
        },
        { label: 'comma', headers: ['--header', 'X-Forwarded-Proto: https,https'] },
    ]
    for (const scenario of rejectionCases) {
        const rejected = await context.trustedProxyCurl(
            'ipv4',
            [...trustedHeaders, ...scenario.headers],
            trustedPath,
        )
        assert.match(rejected, /^HTTP\/1\.1 308(?:\s|$)/u, scenario.label)
        assert.match(
            rejected,
            new RegExp(
                'Location: https://one\\.test:' +
                    context.httpsPort +
                    '/trusted-termination/path\\?query=a%2Fb',
                'iu',
            ),
            scenario.label,
        )
        assert.match(rejected, /Cache-Control: no-store/iu, scenario.label)
    }
    const untrustedDefault = await context.curl([
        '--include',
        '--request',
        'POST',
        '--data',
        'untrusted-body',
        context.httpUrl + trustedPath,
        ...trustedHeaders,
    ])
    assert.match(untrustedDefault, /^HTTP\/1\.1 308(?:\s|$)/u)
    const untrustedForged = await context.curl([
        '--include',
        '--request',
        'POST',
        '--data',
        'untrusted-body',
        context.httpUrl + trustedPath,
        ...trustedHeaders,
        '--header',
        'X-Forwarded-Proto: https',
    ])
    assert.match(untrustedForged, /^HTTP\/1\.1 308(?:\s|$)/u)
    assert.match(
        untrustedForged,
        new RegExp(
            'Location: https://one\\.test:' +
                context.httpsPort +
                '/trusted-termination/path\\?query=a%2Fb',
            'iu',
        ),
    )
    assert.match(untrustedForged, /Cache-Control: no-store/iu)
    const untrustedFollowed = await context.curl([
        '--location',
        '--cacert',
        context.temp + '/ca.pem',
        '--resolve',
        'one.test:' + context.httpPort + ':127.0.0.1',
        '--resolve',
        'one.test:' + context.httpsPort + ':127.0.0.1',
        '--request',
        'POST',
        '--data',
        'untrusted-body',
        context.httpUrl + trustedPath,
        ...trustedHeaders,
        '--header',
        'X-Forwarded-Proto: https',
    ])
    assert.match(untrustedFollowed, /"method":"POST"/u)
    assert.match(untrustedFollowed, /"path":"\/trusted-termination\/path\?query=a%2Fb"/u)
    assert.match(untrustedFollowed, /"body":"untrusted-body"/u)
    const acmePrecedence = await context.curl([
        '--include',
        context.httpUrl + '/.well-known/acme-challenge/trusted-termination-token',
        ...trustedHeaders,
        '--header',
        'X-Forwarded-Proto: https',
    ])
    assert.match(acmePrecedence, /^HTTP\/1\.1 404(?:\s|$)/u)
    assert.doesNotMatch(acmePrecedence, /Location:/iu)
    context.passed(
        'trusted TLS termination requires one exact https value from the configured IPv4/IPv6 peers; forged, empty, duplicate and comma values keep a no-store public-port 308 and ACME remains first',
    )
    context.passed('TLS preview and apply resolve controller-owned material without returning PEM')
    return {
        one,
        acmeHost,
    }
}
