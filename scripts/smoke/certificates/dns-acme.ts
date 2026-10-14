// oxlint-disable no-await-in-loop -- Bounded smoke scenarios preserve their sequential polling.
import assert from 'node:assert/strict'
import { restoreCertificateStateFixture } from './state-restore.ts'
import type { CertificateDnsAcmeContext } from './Types/scenarios.types.ts'

export async function verifyCertificateDnsAcme(context: CertificateDnsAcmeContext) {
    assert.ok(context.dnsFixture)
    assert.ok(context.backend)
    const wildcardId = Bun.randomUUIDv7()
    const dnsRequest = {
        domains: ['*.example.com', 'example.com'],
        environment: 'staging',
        acceptTerms: true,
        challengeType: 'dns-01',
        dnsProvider: {
            type: 'cloudflare',
            zoneId: context.dnsFixture.zoneId,
            apiToken: context.dnsToken,
        },
    }
    const forbiddenHttpWildcard = await context.controllerRequest(
        '/internal/v1/certificates/' + Bun.randomUUIDv7() + '/issue',
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
    const wildcardIssue = await context.controllerRequest(
        '/internal/v1/certificates/' + wildcardId + '/issue',
        { method: 'POST', body: JSON.stringify(dnsRequest) },
    )
    assert.equal(wildcardIssue.status, 202)
    async function waitForDnsCertificate() {
        let metadata: Record<string, unknown> = {}
        await context.waitFor(
            async () => {
                metadata = context.jsonObject(
                    await (
                        await context.controllerRequest('/internal/v1/certificates/' + wildcardId)
                    ).json(),
                )
                return metadata.operation === 'idle'
            },
            'Pebble DNS-01 operation',
            180_000,
        )
        context.assertCertificateIssued(metadata)
        return metadata
    }
    const activeDnsFixture = context.dnsFixture
    if (activeDnsFixture === undefined) {
        throw new Error('DNS fixture was not initialized')
    }
    async function waitForDnsRecordsToClear(): Promise<void> {
        await context.waitFor(
            async () => activeDnsFixture.records.length === 0,
            'DNS-01 record cleanup',
            90_000,
        )
    }
    const wildcardIssued = await waitForDnsCertificate()
    assert.deepEqual(wildcardIssued.domains, ['*.example.com', 'example.com'])
    assert.ok(context.dnsFixture.maxSimultaneousTxt >= 2)
    await waitForDnsRecordsToClear()
    context.passed('mixed apex/wildcard DNS-01 validates simultaneous TXT proofs and cleans up')
    const wildcardProxy = context.host(
        Bun.randomUUIDv7(),
        'proxy.example.com',
        context.backend.port!,
        wildcardId,
    )
    const wildcardApex = context.host(
        Bun.randomUUIDv7(),
        'example.com',
        context.backend.port!,
        wildcardId,
    )
    const wildcardRedirect = context.redirectHost(
        Bun.randomUUIDv7(),
        'redirect.example.com',
        'https://example.org',
        wildcardId,
    )
    const wildcardSnapshot = context.snapshot([wildcardProxy, wildcardApex], [wildcardRedirect])
    await context.apply(wildcardSnapshot)
    async function checkWildcardTraffic() {
        for (const name of ['proxy.example.com', 'example.com']) {
            const response = await context.curl([
                '--cacert',
                context.temp + '/issuance-root.pem',
                '--resolve',
                name + ':' + context.httpsPort + ':127.0.0.1',
                'https://' + name + ':' + context.httpsPort + '/wildcard',
            ])
            assert.match(response, /certificate-smoke-backend/u)
        }
        const redirectResponse = await context.curl([
            '--include',
            '--cacert',
            context.temp + '/issuance-root.pem',
            '--resolve',
            'redirect.example.com:' + context.httpsPort + ':127.0.0.1',
            'https://redirect.example.com:' + context.httpsPort + '/wildcard',
        ])
        assert.match(redirectResponse, /^HTTP\/(?:1\.1|2) 308(?:\s|$)/u)
        assert.match(redirectResponse, /Location: https:\/\/example\.org\/wildcard/iu)
    }
    await checkWildcardTraffic()
    for (const unrelated of ['deep.proxy.example.com', 'unrelated.org']) {
        const rejected = await context.controllerRequest('/internal/v1/proxy/config', {
            method: 'PUT',
            body: JSON.stringify(
                context.snapshot([
                    context.host(Bun.randomUUIDv7(), unrelated, context.backend.port!, wildcardId),
                ]),
            ),
        })
        assert.notEqual(rejected.status, 200)
    }
    context.passed(
        'wildcard certificate serves Proxy/Redirect Hosts and rejects deeper/unrelated hosts',
    )
    const stateJson = await context.command([
        'docker',
        'exec',
        context.runtimeContainer,
        'cat',
        '/var/lib/rentnerproxy/proxy/certificates/certificate-metadata.json',
    ])
    assert.equal(stateJson.includes(context.dnsToken), false)
    await context.restartRuntime()
    await context.waitFor(
        async () => (await context.controllerRequest('/internal/v1/proxy/status')).status === 200,
        'restart before DNS renewal',
    )
    assert.equal(
        (
            await context.controllerRequest('/internal/v1/certificates/' + wildcardId + '/renew', {
                method: 'POST',
                body: '{}',
            })
        ).status,
        202,
    )
    const wildcardRenewed = await waitForDnsCertificate()
    assert.notEqual(wildcardRenewed.fingerprint, wildcardIssued.fingerprint)
    assert.equal(
        context.jsonObject(
            await (await context.controllerRequest('/internal/v1/proxy/status')).json(),
        ).activeRevision,
        wildcardSnapshot.revision,
    )
    await waitForDnsRecordsToClear()
    await checkWildcardTraffic()
    context.passed(
        'DNS renewal decrypts persisted credentials after restart and retains host assignments',
    )

    context.dnsFixture.failCleanup = true
    assert.equal(
        (
            await context.controllerRequest('/internal/v1/certificates/' + wildcardId + '/renew', {
                method: 'POST',
                body: '{}',
            })
        ).status,
        202,
    )
    let cleanupFailure: Record<string, unknown> = {}
    await context.waitFor(
        async () => {
            cleanupFailure = context.jsonObject(
                await (
                    await context.controllerRequest('/internal/v1/certificates/' + wildcardId)
                ).json(),
            )
            return cleanupFailure.operation === 'idle'
        },
        'visible DNS cleanup failure',
        180_000,
    )
    assert.equal(cleanupFailure.lastErrorCode, null)
    assert.equal(cleanupFailure.status, 'valid')
    assert.equal(cleanupFailure.candidate, null)
    assert.equal(cleanupFailure.dnsCleanupPending, true)
    assert.notEqual(cleanupFailure.fingerprint, wildcardRenewed.fingerprint)
    const cleanupRecoveredFingerprint = cleanupFailure.fingerprint
    assert.ok(context.dnsFixture.records.length > 0)
    await checkWildcardTraffic()
    await context.command(
        ['docker', 'network', 'disconnect', context.network, context.pebbleContainer],
        {
            timeoutMs: 30_000,
        },
    )

    await restoreCertificateStateFixture(context.command, {
        container: context.runtimeContainer,
        volume: context.stateVolume,
        image: context.runtimeImage,
        requiredFiles: [
            'certificates/certificate-metadata.json',
            'certificates/acme-accounts/staging.json',
        ],
    })
    context.passed(
        'production archive restores encrypted DNS credentials and pending cleanup state',
    )
    context.dnsFixture.failCleanup = false
    await context.restartRuntime()
    await context.waitFor(
        async () => (await context.controllerRequest('/internal/v1/proxy/status')).status === 200,
        'restart with pending DNS cleanup',
    )
    let afterDnsRecovery: Record<string, unknown> = {}
    await context.waitFor(
        async () => {
            afterDnsRecovery = context.jsonObject(
                await (
                    await context.controllerRequest('/internal/v1/certificates/' + wildcardId)
                ).json(),
            )
            return (
                afterDnsRecovery.operation === 'idle' &&
                afterDnsRecovery.candidate === null &&
                afterDnsRecovery.dnsCleanupPending === false &&
                afterDnsRecovery.fingerprint === cleanupRecoveredFingerprint
            )
        },
        'issued candidate and DNS cleanup recovery without a second order',
        180_000,
    )
    await waitForDnsRecordsToClear()
    await checkWildcardTraffic()
    await context.command(
        [
            'docker',
            'network',
            'connect',
            '--alias',
            'pebble',
            context.network,
            context.pebbleContainer,
        ],
        { timeoutMs: 30_000 },
    )
    await context.waitForPebbleNetwork()
    context.passed(
        'DNS cleanup failure keeps the issued certificate live and restart recovery clears proofs without another CA order',
    )

    const unrelatedDnsId = Bun.randomUUIDv7()
    assert.equal(
        (
            await context.controllerRequest(
                '/internal/v1/certificates/' + unrelatedDnsId + '/issue',
                {
                    method: 'POST',
                    body: JSON.stringify({ ...dnsRequest, domains: ['unrelatedexample.com'] }),
                },
            )
        ).status,
        202,
    )
    let unrelatedMetadata: Record<string, unknown> = {}
    await context.waitFor(async () => {
        unrelatedMetadata = context.jsonObject(
            await (
                await context.controllerRequest('/internal/v1/certificates/' + unrelatedDnsId)
            ).json(),
        )
        return unrelatedMetadata.operation === 'idle'
    }, 'DNS zone boundary validation')
    assert.equal(unrelatedMetadata.status, 'failed')
    await waitForDnsRecordsToClear()
    context.passed('DNS provider authorization cannot expand to an unrelated zone')
    return {
        wildcardId,
    }
}
