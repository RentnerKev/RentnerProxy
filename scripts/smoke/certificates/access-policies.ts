// oxlint-disable no-await-in-loop -- Bounded smoke scenarios preserve their sequential polling.
import assert from 'node:assert/strict'
import { requestHttp3Client, assertHttp3Response } from '../http3/client.ts'
import type { CertificateAccessPoliciesContext } from './Types/scenarios.types.ts'

export async function verifyCertificateAccessPolicies(context: CertificateAccessPoliciesContext) {
    assert.ok(context.backend)
    const unauthorized = await fetch(context.controllerUrl + '/internal/v1/certificates').catch(
        () => null,
    )
    assert.equal(unauthorized?.status, 401)
    const list = context.jsonObject(
        await (await context.controllerRequest('/internal/v1/certificates')).json(),
    )
    assert.ok(Array.isArray(list.certificates))
    assert.equal(JSON.stringify(list).includes('BEGIN '), false)
    assert.equal(JSON.stringify(list).includes(context.dnsToken), false)
    context.passed(
        'certificate endpoints require the controller token and never return keys or PEM',
    )

    const policyHost = context.host(
        Bun.randomUUIDv7(),
        'policy.example.com',
        context.backend.port!,
        context.wildcardId,
    )
    const policyId = Bun.randomUUIDv7()
    const upstreamBeforePolicies = context.upstreamRequests.length
    for (const policy of [
        { mode: 'authenticated', combination: null },
        { mode: 'ip-restricted', combination: null },
        { mode: 'combined', combination: 'all' },
        { mode: 'combined', combination: 'any' },
    ]) {
        await context.apply(
            context.snapshot([{ ...policyHost, accessPolicy: { id: policyId, ...policy } }]),
        )
        const deniedHttp = await fetch(context.httpUrl + '/private', {
            headers: { host: 'policy.example.com', 'x-forwarded-for': '127.0.0.1' },
            signal: AbortSignal.timeout(5_000),
        })
        assert.equal(deniedHttp.status, 403)
        await deniedHttp.body?.cancel()
        const deniedHttps = await context.curl([
            '--include',
            '--cacert',
            context.temp + '/issuance-root.pem',
            '--resolve',
            'policy.example.com:' + context.httpsPort + ':127.0.0.1',
            'https://policy.example.com:' + context.httpsPort + '/private',
        ])
        assert.match(deniedHttps, /^HTTP\/(?:1\.1|2) 403(?:\s|$)/u)
        assert.doesNotMatch(deniedHttps, /certificate-smoke-backend/u)
    }
    assert.equal(context.upstreamRequests.length, upstreamBeforePolicies)
    const challenge = await fetch(
        context.httpUrl + '/.well-known/acme-challenge/unknown-policy-token',
        {
            headers: { host: 'policy.example.com' },
            signal: AbortSignal.timeout(5_000),
        },
    )
    assert.equal(challenge.status, 404)
    await challenge.body?.cancel()
    await context.apply(
        context.snapshot([
            {
                ...policyHost,
                accessPolicy: { id: policyId, mode: 'public', combination: null },
            },
        ]),
    )
    const publicHttps = await context.curl([
        '--cacert',
        context.temp + '/issuance-root.pem',
        '--resolve',
        'policy.example.com:' + context.httpsPort + ':127.0.0.1',
        'https://policy.example.com:' + context.httpsPort + '/public',
    ])
    assert.match(publicHttps, /certificate-smoke-backend/u)
    context.passed(
        'Access Policies deny HTTP and verified HTTPS in every protected mode while preserving ACME challenges',
    )

    const authUsername = 'https-smoke'
    const authPassword = 'HTTPS-smoke-password:one'
    const passwordHash = await Bun.password.hash(authPassword, {
        algorithm: 'argon2id',
        memoryCost: 47104,
        timeCost: 1,
    })
    const basicAuth = { accounts: [{ username: authUsername, passwordHash }] }
    const basicPolicy = { id: policyId, mode: 'authenticated', combination: null, basicAuth }
    const authSnapshot = context.snapshot([{ ...policyHost, accessPolicy: basicPolicy }])
    const policyQuic = (options: Partial<Parameters<typeof requestHttp3Client>[1]> = {}) =>
        context.quic({
            hostname: 'policy.example.com',
            caFile: context.temp + '/issuance-root.pem',
            path: '/basic-auth',
            ...options,
        })
    const authCurl = (password?: string) =>
        context.curl([
            '--include',
            '--cacert',
            context.temp + '/issuance-root.pem',
            '--resolve',
            'policy.example.com:' + context.httpsPort + ':127.0.0.1',
            ...(password === undefined ? [] : ['--user', authUsername + ':' + password]),
            'https://policy.example.com:' + context.httpsPort + '/basic-auth',
        ])
    for (const mode of [
        { mode: 'authenticated', combination: null, allowed: true },
        { mode: 'combined', combination: 'any', allowed: true },
        { mode: 'combined', combination: 'all', allowed: false },
        { mode: 'ip-restricted', combination: null, allowed: false },
    ]) {
        await context.apply(
            context.snapshot([
                {
                    ...policyHost,
                    accessPolicy: {
                        ...basicPolicy,
                        mode: mode.mode,
                        combination: mode.combination,
                    },
                },
            ]),
        )
        const beforeDenied = context.upstreamRequests.length
        const denied = await authCurl('incorrect-password')
        assertHttp3Response(
            await policyQuic({ credentials: authUsername + ':incorrect-password' }),
            mode.allowed ? 401 : 403,
            context.httpsPort,
        )
        assert.match(
            denied,
            mode.allowed ? /^HTTP\/(?:1\.1|2) 401(?:\s|$)/u : /^HTTP\/(?:1\.1|2) 403(?:\s|$)/u,
        )
        if (mode.allowed) assert.match(denied, /www-authenticate: Basic realm="RentnerProxy"/iu)
        assert.equal(context.upstreamRequests.length, beforeDenied)
        const authorized = await authCurl(authPassword)
        assertHttp3Response(
            await policyQuic({ credentials: authUsername + ':' + authPassword }),
            mode.allowed ? 200 : 403,
            context.httpsPort,
        )
        assert.match(
            authorized,
            mode.allowed ? /^HTTP\/(?:1\.1|2) 200(?:\s|$)/u : /^HTTP\/(?:1\.1|2) 403(?:\s|$)/u,
        )
        if (mode.allowed) assert.match(authorized, /certificate-smoke-backend/u)
        else assert.equal(context.upstreamRequests.length, beforeDenied)
    }
    await context.apply(authSnapshot)
    assert.match(await authCurl(), /^HTTP\/(?:1\.1|2) 401(?:\s|$)/u)
    for (const path of [
        '/internal/v1/proxy/config',
        '/internal/v1/proxy/hosts/' + String(policyHost.id) + '/config',
    ]) {
        for (const isAuthPreview of [false, true]) {
            const response = await context.controllerRequest(
                path + (isAuthPreview ? '/preview' : ''),
                isAuthPreview ? { method: 'POST', body: JSON.stringify(authSnapshot) } : {},
            )
            assert.equal(response.status, 200)
            const source = await response.text()
            assert.equal(source.includes(passwordHash), false)
            assert.equal(source.includes('$argon2'), false)
            assert.equal(source.includes(authPassword), false)
            assert.equal(source.includes('authentication'), true)
        }
    }
    await context.apply(
        context.snapshot([{ ...policyHost, forceHttps: true, accessPolicy: basicPolicy }]),
    )
    assertHttp3Response(
        await policyQuic({
            credentials: authUsername + ':' + authPassword,
            network: 'container:' + context.trustedProxyContainer,
            address: context.runtimeIpv4,
            port: 8443,
            headers: ['X-Forwarded-Proto: http'],
        }),
        200,
        context.httpsPort,
    )
    const forceAuthHttps = await fetch(context.httpUrl + '/basic-auth', {
        headers: { host: 'policy.example.com' },
        redirect: 'manual',
        signal: AbortSignal.timeout(5_000),
    })
    assert.equal(forceAuthHttps.status, 308)
    assert.equal(forceAuthHttps.headers.has('www-authenticate'), false)
    await forceAuthHttps.body?.cancel()
    assert.match(await authCurl(authPassword), /^HTTP\/(?:1\.1|2) 200(?:\s|$)/u)
    context.passed(
        'Basic Auth enforces verified HTTPS and combination semantics, preserves redirects and redacts every config API',
    )
    return {
        policyHost,
        policyId,
        authUsername,
        authPassword,
        basicPolicy,
        policyQuic,
        authCurl,
    }
}
