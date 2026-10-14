import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { assertHttp3Response } from '../http3/client.ts'
import type { CertificateManualLifecycleContext } from './Types/scenarios.types.ts'

export async function verifyCertificateManualLifecycle(context: CertificateManualLifecycleContext) {
    const activeRevisionBeforeReplacement = context.jsonObject(
        await (await context.controllerRequest('/internal/v1/proxy/status')).json(),
    ).activeRevision
    await context.importCertificate(context.firstId, context.replacement, ['one.test'])
    await context.waitFor(async () => {
        const served = await context
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
        const pem = served.match(
            /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/u,
        )?.[0]
        if (!pem) return false
        await writeFile(context.temp + '/served-replacement.pem', pem)
        return (
            (await context.fingerprint(context.temp + '/served-replacement.pem')) ===
            context.replacementFingerprint
        )
    }, 'certificate replacement')
    assert.equal(
        context.jsonObject(
            await (await context.controllerRequest('/internal/v1/proxy/status')).json(),
        ).activeRevision,
        activeRevisionBeforeReplacement,
    )
    context.passed(
        'certificate replacement changes the SNI fingerprint without changing the active revision',
    )
    const replacedQuic = await context.quic()
    assertHttp3Response(replacedQuic, 200, context.httpsPort)
    assert.equal(replacedQuic.fingerprint, 'sha256:' + context.replacementFingerprint)
    context.passed(
        'HTTP/3 reload serves the replaced certificate fingerprint in a fresh verified handshake',
    )

    const redirect = await context.curl([
        '--max-time',
        '10',
        '--request',
        'POST',
        '--data',
        'payload',
        '--include',
        '--resolve',
        'one.test:' + context.httpPort + ':127.0.0.1',
        context.httpUrl + '/redirect/path?x=1',
        '--header',
        'Host: one.test',
    ])
    assert.match(redirect, /HTTP\/1\.1 308/u)
    assert.match(
        redirect,
        new RegExp(
            'Location: https://one\\.test:' + context.httpsPort + '/redirect/path\\?x=1',
            'iu',
        ),
    )
    const followed = await context.curl([
        '--location',
        '--data',
        'payload',
        '--cacert',
        context.temp + '/ca.pem',
        '--resolve',
        'one.test:' + context.httpPort + ':127.0.0.1',
        '--resolve',
        'one.test:' + context.httpsPort + ':127.0.0.1',
        context.httpUrl + '/redirect/path?x=1',
        '--header',
        'Host: one.test',
    ])
    assert.match(followed, /certificate-smoke-backend/u)
    assert.match(followed, /"body":"payload"/u)
    assert.equal(
        context.upstreamRequests.some((request) => request === 'POST /redirect/path?x=1'),
        true,
    )
    const plainHttp = await context.curl([
        '--resolve',
        'plain.invalid:' + context.httpPort + ':127.0.0.1',
        context.httpUrl + '/',
        '--header',
        'Host: plain.invalid',
    ])
    assert.match(plainHttp, /certificate-smoke-backend/u)
    context.passed('HTTP non-forceHttps host reaches the real backend; 308 follow preserves POST')
    context.passed('forceHttps returns a public-port 308 preserving path/query')

    const withSettings = context.snapshot([
        {
            ...context.one,
            httpSettings: { clientMaxBodySizeBytes: 4096 },
        },
    ])
    await context.apply(withSettings)
    context.passed('structured body limits survive HTTPS rendering')
    const tooLarge = await context.curl([
        '--include',
        '--data-binary',
        'x'.repeat(5000),
        '--cacert',
        context.temp + '/ca.pem',
        '--resolve',
        'one.test:' + context.httpsPort + ':127.0.0.1',
        'https://one.test:' + context.httpsPort + '/body-limit',
    ])
    assert.match(tooLarge, /^HTTP\/(?:1\.1|2) 413(?:\s|$)/u)
    context.passed('per-host body size settings still apply to HTTPS traffic')
    const challengeBypass = await context.curl([
        '--include',
        context.httpUrl + '/.well-known/acme-challenge/unknown_token',
        '--header',
        'Host: one.test',
    ])
    assert.match(challengeBypass, /HTTP\/1\.1 404/u)
    assert.doesNotMatch(challengeBypass, /Location:/iu)
    context.passed('HTTP-01 bypasses force HTTPS even for unknown tokens')

    const knownTls = await context.curl([
        '--cacert',
        context.temp + '/ca.pem',
        '--resolve',
        'one.test:' + context.httpsPort + ':127.0.0.1',
        'https://one.test:' + context.httpsPort + '/',
    ])
    assert.match(knownTls, /certificate-smoke-backend/u)
    await assert.rejects(() =>
        context.curl([
            '--insecure',
            '--resolve',
            'unknown.test:' + context.httpsPort + ':127.0.0.1',
            'https://unknown.test:' + context.httpsPort + '/',
        ]),
    )
    context.passed('known SNI remains healthy while unknown SNI fails TLS negotiation')

    const disabled = await context.snapshot([])
    await context.apply(disabled)
    const disabledHttp = await context.curl([
        '--include',
        '--resolve',
        'one.test:' + context.httpPort + ':127.0.0.1',
        context.httpUrl + '/',
        '--header',
        'Host: one.test',
    ])
    assert.match(disabledHttp, /404/u)
    await assert.rejects(() =>
        context.curl([
            '--include',
            '--cacert',
            context.temp + '/ca.pem',
            '--resolve',
            'one.test:' + context.httpsPort + ':127.0.0.1',
            'https://one.test:' + context.httpsPort + '/',
        ]),
    )
    await context.apply(await context.snapshot([context.one]))
    const deletedCertificate = await context.controllerRequest(
        '/internal/v1/certificates/' + context.secondId,
        { method: 'DELETE' },
    )
    assert.equal(deletedCertificate.status, 200)
    assert.deepEqual(await deletedCertificate.json(), { deleted: true })
    await context.command([
        'docker',
        'exec',
        context.runtimeContainer,
        'test',
        '!',
        '-e',
        '/var/lib/rentnerproxy/proxy/certificates/' + context.secondId,
    ])
    const deletedHttp = await context.curl([
        '--include',
        '--resolve',
        'two.test:' + context.httpPort + ':127.0.0.1',
        context.httpUrl + '/',
        '--header',
        'Host: two.test',
    ])
    assert.match(deletedHttp, /404/u)
    await assert.rejects(() =>
        context.curl([
            '--cacert',
            context.temp + '/ca.pem',
            '--resolve',
            'two.test:' + context.httpsPort + ':127.0.0.1',
            'https://two.test:' + context.httpsPort + '/',
        ]),
    )
    context.passed(
        'removing a host permits certificate deletion and removes its HTTP and HTTPS routes',
    )

    const oldFingerprint = 'sha256:' + context.replacementFingerprint
    const badImport = await context.controllerRequest(
        '/internal/v1/certificates/' + context.firstId + '/import',
        {
            method: 'POST',
            body: JSON.stringify({
                certificatePem: await Bun.file(context.first.certificatePem).text(),
                privateKeyPem: await Bun.file(context.mismatch.privateKeyPem).text(),
                requiredDomains: ['one.test'],
            }),
        },
    )
    assert.equal(badImport.status, 422)
    assert.equal(context.jsonObject(await badImport.json()).error, 'key_mismatch')
    assert.equal(
        context.jsonObject(
            await (
                await context.controllerRequest('/internal/v1/certificates/' + context.firstId)
            ).json(),
        ).fingerprint,
        oldFingerprint,
    )
    context.passed('key mismatch is rejected without replacing the served certificate')

    const invalidSnapshot = await context.snapshot([context.one])
    const activeBeforeInvalidApply = context.jsonObject(
        await (await context.controllerRequest('/internal/v1/proxy/status')).json(),
    ).activeRevision
    const corruptCertificatePath =
        '/var/lib/rentnerproxy/proxy/certificates/' +
        context.firstId +
        '/versions/' +
        new Bun.CryptoHasher('sha256')
            .update(await Bun.file(context.replacement.certificatePem).text())
            .update('\0')
            .update(await Bun.file(context.temp + '/ca.pem').text())
            .update('\0')
            .update(await Bun.file(context.replacement.privateKeyPem).text())
            .digest('hex') +
        '/fullchain.pem'
    const savedCertificatePath = '/tmp/' + context.project + '-fullchain.pem'
    await context.command([
        'docker',
        'exec',
        context.runtimeContainer,
        'cp',
        corruptCertificatePath,
        savedCertificatePath,
    ])
    await context.command([
        'docker',
        'exec',
        context.runtimeContainer,
        'rm',
        corruptCertificatePath,
    ])
    const invalidApply = await context.controllerRequest('/internal/v1/proxy/config', {
        method: 'PUT',
        body: JSON.stringify(invalidSnapshot),
    })
    assert.equal(invalidApply.status, 502)
    assert.equal(
        context.jsonObject(
            await (await context.controllerRequest('/internal/v1/proxy/status')).json(),
        ).activeRevision,
        activeBeforeInvalidApply,
    )
    await context.waitFor(
        async () => (await context.controllerRequest('/internal/v1/proxy/status')).status === 200,
        'controller status after rollback',
    )
    const afterRollback = await context.curl([
        '--cacert',
        context.temp + '/ca.pem',
        '--resolve',
        'one.test:' + context.httpsPort + ':127.0.0.1',
        'https://one.test:' + context.httpsPort + '/',
    ])
    assert.match(afterRollback, /certificate-smoke-backend/u)
    await context.command([
        'docker',
        'exec',
        context.runtimeContainer,
        'mv',
        savedCertificatePath,
        corruptCertificatePath,
    ])
    context.passed(
        'missing certificate material rolls back while the previous HTTPS route remains live',
    )
    return {}
}
