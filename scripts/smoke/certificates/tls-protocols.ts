import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { requestHttp3Client, assertHttp3Response } from '../http3/client.ts'
import type { CertificateTlsProtocolsContext } from './Types/scenarios.types.ts'

export async function verifyCertificateTlsProtocols(context: CertificateTlsProtocolsContext) {
    const httpsOne = await context.curl([
        '--cacert',
        context.temp + '/ca.pem',
        '--resolve',
        'one.test:' + context.httpsPort + ':127.0.0.1',
        'https://one.test:' + context.httpsPort + '/real/path?query=a%2Fb',
    ])
    const httpsTwo = await context.curl([
        '--cacert',
        context.temp + '/ca.pem',
        '--resolve',
        'two.test:' + context.httpsPort + ':127.0.0.1',
        'https://two.test:' + context.httpsPort + '/',
    ])
    assert.match(httpsOne, /certificate-smoke-backend/u)
    assert.match(httpsTwo, /certificate-smoke-backend/u)
    const httpsOneHttp1 = await context.curl([
        '--http1.1',
        '--cacert',
        context.temp + '/ca.pem',
        '--resolve',
        'one.test:' + context.httpsPort + ':127.0.0.1',
        'https://one.test:' + context.httpsPort + '/http1',
    ])
    assert.match(httpsOneHttp1, /certificate-smoke-backend/u)
    const httpsOneHttp2 = await context.command([
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
        '--http2',
        '--cacert',
        '/test/ca.pem',
        '--resolve',
        'one.test:8443:' + context.runtimeIpv4,
        '--write-out',
        '\n%{http_version}',
        'https://one.test:8443/http2',
    ])
    assert.match(httpsOneHttp2, /certificate-smoke-backend/u)
    assert.match(httpsOneHttp2, /\n2$/u)
    context.passed('curl verifies HTTP/1.1 and negotiated HTTP/2 requests over TLS')
    const quic = (options: Partial<Parameters<typeof requestHttp3Client>[1]> = {}) =>
        requestHttp3Client(context.command, {
            image: context.http3Image,
            caFile: context.temp + '/ca.pem',
            hostname: 'one.test',
            port: context.httpsPort,
            ...options,
        })
    const firstQuic = await quic()
    assertHttp3Response(firstQuic, 200, context.httpsPort)
    assert.equal(firstQuic.fingerprint, 'sha256:' + context.firstFingerprint)
    assert.match(firstQuic.output, /certificate-smoke-backend/u)
    const h2Fallback = await quic({ protocol: '--http2' })
    assert.equal(h2Fallback.protocol, '2')
    assert.equal(h2Fallback.status, 200)
    const h1Fallback = await quic({ protocol: '--http1.1' })
    assert.equal(h1Fallback.protocol, '1.1')
    assert.equal(h1Fallback.status, 200)
    await assert.rejects(() => quic({ port: context.tcpOnlyHttpsPort }))
    const blockedUdp = await quic({ protocol: '--http3', port: context.tcpOnlyHttpsPort })
    assert.equal(blockedUdp.protocol, '2')
    assert.equal(blockedUdp.status, 200)
    assertHttp3Response(await quic({ hostname: 'redirect.test' }), 308, context.httpsPort)
    assertHttp3Response(
        await quic({ path: '/.well-known/acme-challenge/missing' }),
        404,
        context.httpsPort,
    )
    const mismatchedAuthority = await quic({ headers: ['Host: missing.example.com'] })
    assert.equal(mismatchedAuthority.status, 421)
    assert.equal(mismatchedAuthority.protocol, '3')
    assert.doesNotMatch(mismatchedAuthority.output, /^alt-svc:.*:8443/gimu)
    const mismatchedTcpAuthority = await quic({
        protocol: '--http2',
        headers: ['Host: missing.example.com'],
    })
    assert.equal(mismatchedTcpAuthority.status, 421)
    assert.doesNotMatch(mismatchedTcpAuthority.output, /^alt-svc:.*:8443/gimu)
    context.passed(
        'verified HTTP/3 crosses published UDP with public-port Alt-Svc; HTTP/2 and HTTP/1.1 survive unavailable UDP',
    )
    const upstreamCountBeforeRedirect = context.upstreamRequests.length
    const redirectOverHttps = await context.curl([
        '--include',
        '--cacert',
        context.temp + '/ca.pem',
        '--resolve',
        'redirect.test:' + context.httpsPort + ':127.0.0.1',
        'https://redirect.test:' + context.httpsPort + '/real/path?query=a%2Fb',
    ])

    assert.match(redirectOverHttps, /^HTTP\/(?:1\.1|2) 308(?:\s|$)/u)
    assert.match(
        redirectOverHttps,
        /Location: https:\/\/new\.example\.test\/base\/real\/path\?query=a%2Fb/iu,
    )
    const redirectOverHttp = await context.curl([
        '--include',
        context.httpUrl + '/plain/path?query=1',
        '--header',
        'Host: redirect.test',
    ])
    assert.match(redirectOverHttp, /HTTP\/1\.1 308/u)
    assert.match(
        redirectOverHttp,
        /Location: https:\/\/new\.example\.test\/base\/plain\/path\?query=1/iu,
    )
    assert.equal(context.upstreamRequests.length, upstreamCountBeforeRedirect)
    context.passed(
        'first-class redirect host serves matching HTTP and certificate-backed HTTPS SNI',
    )
    const servedOne = await context
        .openssl(
            [
                's_client',
                '-connect',
                '127.0.0.1:' + context.httpsPort,
                '-servername',
                'one.test',
                '-CAfile',
                context.temp + '/ca.pem',
                '-showcerts',
            ],
            15_000,
        )
        .catch(() => '')
    const servedTwo = await context
        .openssl(
            [
                's_client',
                '-connect',
                '127.0.0.1:' + context.httpsPort,
                '-servername',
                'two.test',
                '-CAfile',
                context.temp + '/ca.pem',
                '-showcerts',
            ],
            15_000,
        )
        .catch(() => '')
    assert.match(servedOne, /BEGIN CERTIFICATE/u)
    assert.match(servedTwo, /BEGIN CERTIFICATE/u)

    const servedOnePem = servedOne.match(
        /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/u,
    )?.[0]
    const servedTwoPem = servedTwo.match(
        /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/u,
    )?.[0]
    assert.ok(servedOnePem)
    assert.ok(servedTwoPem)
    await writeFile(context.temp + '/served-one.pem', servedOnePem)
    await writeFile(context.temp + '/served-two.pem', servedTwoPem)
    assert.equal(
        await context.fingerprint(context.temp + '/served-one.pem'),
        context.firstFingerprint,
    )
    assert.equal(
        await context.fingerprint(context.temp + '/served-two.pem'),
        context.secondFingerprint,
    )
    context.passed('HTTPS SNI serves two distinct imported certificates and real backend traffic')
    const http2Handshake = await context.openssl(
        [
            's_client',
            '-connect',
            '127.0.0.1:' + context.httpsPort,
            '-servername',
            'one.test',
            '-alpn',
            'h2',
            '-CAfile',
            context.temp + '/ca.pem',
        ],
        15_000,
    )
    assert.match(http2Handshake, /ALPN protocol: h2/iu)
    context.passed('real TLS handshake negotiates HTTP/2 through Caddy')
    return {
        quic,
    }
}
