// oxlint-disable no-await-in-loop -- Bounded smoke scenarios preserve their sequential polling.
import assert from 'node:assert/strict'
import { assertHttp3Response } from '../http3/client.ts'
import type { CertificateIpPoliciesContext } from './Types/scenarios.types.ts'

export async function verifyCertificateIpPolicies(context: CertificateIpPoliciesContext) {
    const ipAllowAll = { defaultAction: 'allow', allow: [], deny: [] }
    const ipDenyAll = { defaultAction: 'deny', allow: [], deny: [] }
    const loopbackRules = {
        defaultAction: 'deny',
        allow: ['127.0.0.0/8', '::1/128'],
        deny: [],
    }
    const ipPolicy = { id: context.policyId, mode: 'ip-restricted', combination: null }
    const localIpCurl = (address: string, password?: string) =>
        context.command([
            'docker',
            'exec',
            context.runtimeContainer,
            'curl',
            '--silent',
            '--show-error',
            '--noproxy',
            '*',
            '--include',
            '--max-time',
            '5',
            '--header',
            'Host: policy.example.com',
            '--header',
            'X-Forwarded-For: 192.0.2.99',
            '--header',
            'X-Real-IP: 192.0.2.99',
            '--header',
            'Forwarded: for=192.0.2.99',
            ...(password === undefined ? [] : ['--user', context.authUsername + ':' + password]),
            'http://' + address + ':8080/ip-rules',
        ])
    for (const scenario of [
        { rules: loopbackRules, expected: 200 },
        { rules: { ...loopbackRules, deny: ['127.0.0.1/32', '::1/128'] }, expected: 403 },
        { rules: { ...ipAllowAll, deny: ['127.0.0.0/8', '::1/128'] }, expected: 403 },
        { rules: ipAllowAll, expected: 200 },
        { rules: ipDenyAll, expected: 403 },
        { rules: { ...ipDenyAll, allow: ['192.0.2.99/32'] }, expected: 403 },
    ]) {
        await context.apply(
            context.snapshot([
                { ...context.policyHost, accessPolicy: { ...ipPolicy, ipRules: scenario.rules } },
            ]),
        )
        for (const address of ['127.0.0.1', '[::1]']) {
            const result = await localIpCurl(address)
            assertHttp3Response(
                await context.policyQuic({
                    network: 'container:' + context.runtimeContainer,
                    address,
                    port: 8443,
                    headers: [
                        'X-Forwarded-For: 192.0.2.99',
                        'X-Real-IP: 192.0.2.99',
                        'Forwarded: for=192.0.2.99',
                    ],
                }),
                scenario.expected,
                context.httpsPort,
            )
            assert.equal(Number(result.match(/^HTTP\/(?:1\.1|2) (\d{3})/u)?.[1]), scenario.expected)
            if (scenario.expected === 403) assert.doesNotMatch(result, /certificate-smoke-backend/u)
            else assert.match(result, /certificate-smoke-backend/u)
        }
    }
    context.passed(
        'real IPv4 and IPv6 peers enforce CIDRs, deny precedence and explicit defaults; forged forwarding headers cannot allow access',
    )
    await context.apply(
        context.snapshot([
            {
                ...context.policyHost,
                accessPolicy: {
                    ...ipPolicy,
                    ipRules: { ...ipDenyAll, allow: ['::/0'] },
                },
            },
        ]),
    )
    assert.match(await localIpCurl('127.0.0.1'), /^HTTP\/(?:1\.1|2) 403(?:\s|$)/u)
    assert.match(await localIpCurl('[::1]'), /^HTTP\/(?:1\.1|2) 200(?:\s|$)/u)
    context.passed('an IPv6 all-addresses rule does not authorize IPv4 peers')

    for (const scenario of [
        { combination: 'all', rules: ipAllowAll, password: undefined, expected: 401 },
        { combination: 'all', rules: ipAllowAll, password: context.authPassword, expected: 200 },
        { combination: 'all', rules: ipDenyAll, password: context.authPassword, expected: 403 },
        { combination: 'any', rules: ipAllowAll, password: 'wrong', expected: 200 },
        { combination: 'any', rules: ipDenyAll, password: 'wrong', expected: 401 },
        { combination: 'any', rules: ipDenyAll, password: context.authPassword, expected: 200 },
    ]) {
        await context.apply(
            context.snapshot([
                {
                    ...context.policyHost,
                    accessPolicy: {
                        ...context.basicPolicy,
                        mode: 'combined',
                        combination: scenario.combination,
                        ipRules: scenario.rules,
                    },
                },
            ]),
        )
        const result = await context.authCurl(scenario.password)
        assert.equal(Number(result.match(/^HTTP\/(?:1\.1|2) (\d{3})/u)?.[1]), scenario.expected)
        if (scenario.expected !== 200) assert.doesNotMatch(result, /certificate-smoke-backend/u)
    }
    for (const combination of ['all', 'any']) {
        await context.apply(
            context.snapshot([
                {
                    ...context.policyHost,
                    accessPolicy: {
                        ...ipPolicy,
                        mode: 'combined',
                        combination,
                        ipRules: ipAllowAll,
                    },
                },
            ]),
        )
        const result = await context.authCurl()
        assert.equal(
            Number(result.match(/^HTTP\/(?:1\.1|2) (\d{3})/u)?.[1]),
            combination === 'all' ? 403 : 200,
        )
    }
    context.passed(
        'verified HTTPS combines IP rules and Basic Auth with explicit all/any semantics, including missing credentials',
    )

    await context.apply(
        context.snapshot([
            {
                ...context.policyHost,
                forceHttps: true,
                accessPolicy: { ...ipPolicy, ipRules: ipDenyAll },
            },
        ]),
    )
    const redirectIp = await fetch(context.httpUrl + '/ip-rules', {
        headers: { host: 'policy.example.com' },
        redirect: 'manual',
        signal: AbortSignal.timeout(5_000),
    })
    assert.equal(redirectIp.status, 308)
    await redirectIp.body?.cancel()
    assert.match(await context.authCurl(), /^HTTP\/(?:1\.1|2) 403(?:\s|$)/u)
    const ipChallenge = await fetch(
        context.httpUrl + '/.well-known/acme-challenge/unknown-ip-token',
        {
            headers: { host: 'policy.example.com' },
            signal: AbortSignal.timeout(5_000),
        },
    )
    assert.equal(ipChallenge.status, 404)
    await ipChallenge.body?.cancel()
    const persistedIpSnapshot = context.snapshot([
        {
            ...context.policyHost,
            accessPolicy: {
                ...ipPolicy,
                ipRules: { ...ipDenyAll, allow: ['127.0.0.0/8'] },
            },
        },
    ])
    await context.apply(persistedIpSnapshot)
    await context.restartRuntime()
    await context.waitFor(async () => {
        const response = await context.controllerRequest('/internal/v1/proxy/status')
        if (!response.ok) return false
        const status = context.jsonObject(await response.json())
        return status.running === true && status.activeRevision === persistedIpSnapshot.revision
    }, 'IP policy recovery after restart')
    assert.match(await localIpCurl('127.0.0.1'), /^HTTP\/(?:1\.1|2) 200(?:\s|$)/u)
    assert.match(await localIpCurl('[::1]'), /^HTTP\/(?:1\.1|2) 403(?:\s|$)/u)
    context.passed(
        'IP rules preserve HTTPS redirects and ACME and retain their IPv4/IPv6 behavior after restart',
    )
    return {}
}
