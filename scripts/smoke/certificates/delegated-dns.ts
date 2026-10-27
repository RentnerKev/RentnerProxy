// oxlint-disable no-await-in-loop -- Isolated ACME scenarios deliberately run sequentially.
import assert from 'node:assert/strict'
import { CERTIFICATE_ERROR_CODES } from '../../../web/src/config/certificates.config.ts'
import type { CertificateDnsAcmeContext } from './Types/scenarios.types.ts'
import { DNS_CONNECTION_ERROR_CODES } from '../../../web/src/config/dns-connections.config.ts'

async function connectionResult(
    response: Response,
    operation: string,
): Promise<Record<string, unknown>> {
    const payload: unknown = await response.json().catch(() => null)
    const body =
        payload !== null && typeof payload === 'object' && !Array.isArray(payload)
            ? (payload as Record<string, unknown>)
            : {}
    const error = DNS_CONNECTION_ERROR_CODES.find((code) => code === body.error) ?? 'unknown_error'
    // Never print provider bodies: only our public error catalog is safe for diagnostics.
    assert.equal(response.status, 200, `${operation} failed: ${error}`)
    return body
}

export async function verifyCertificateDelegatedDns(
    context: CertificateDnsAcmeContext,
): Promise<void> {
    assert.ok(context.dnsFixture)
    const fixture = context.dnsFixture
    assert.ok(context.backend?.port)
    assert.equal(fixture.records.length, 0)
    const source = '_acme-challenge.delegated.example.net'
    const terminal = '_acme-challenge.customer.example.com'
    const nsSource = '_acme-challenge.ns-delegated.example.net'
    const nsZoneId = 'b'.repeat(32)
    const unrelatedZoneId = 'c'.repeat(32)
    fixture.cnames.set(source, terminal)
    fixture.nameservers.set('example.com', ['ns.fixture.invalid'])
    fixture.zones.set(nsZoneId, nsSource)
    fixture.zones.set(unrelatedZoneId, 'example.net')
    fixture.nameservers.set(nsSource, ['ns.fixture.invalid'])
    const foreign = [terminal, nsSource].map((name) => ({
        id: Bun.randomUUIDv7(),
        type: 'TXT' as const,
        name,
        content: 'foreign-TXT-must-survive',
    }))
    fixture.records.push(...foreign)

    const connectionId = Bun.randomUUIDv7()
    const connectionPath = '/internal/v1/dns/connections/' + connectionId
    await connectionResult(
        await context.controllerRequest(connectionPath, {
            method: 'PUT',
            body: JSON.stringify({
                provider: 'cloudflare',
                expectedRevision: 0,
                name: 'Delegated DNS smoke',
                apiToken: context.dnsToken,
                zoneIds: [fixture.zoneId, nsZoneId],
                actorUserId: Bun.randomUUIDv7(),
            }),
        }),
        'Saved DNS connection creation',
    )
    const verification = await context.controllerRequest(connectionPath + '/verify', {
        method: 'POST',
        body: JSON.stringify({ expectedRevision: 1 }),
    })
    const verified = await connectionResult(verification, 'Saved DNS connection verification')
    assert.equal(context.jsonObject(verified.verification).status, 'connected')
    assert.deepEqual(fixture.records, foreign, 'Connection verification leaked its probe')

    function issueRequest(domains: string[], zoneId = fixture.zoneId) {
        return {
            domains,
            environment: 'staging',
            acceptTerms: true,
            challengeType: 'dns-01',
            dnsMode: 'delegated',
            dnsProvider: { type: 'connection', provider: 'cloudflare', connectionId, zoneId },
        }
    }
    async function waitIdle(id: string): Promise<Record<string, unknown>> {
        let metadata: Record<string, unknown> = {}
        await context.waitFor(
            async () => {
                metadata = context.jsonObject(
                    await (
                        await context.controllerRequest('/internal/v1/certificates/' + id)
                    ).json(),
                )
                return metadata.operation === 'idle'
            },
            'delegated DNS ACME operation',
            180_000,
        )
        return metadata
    }
    async function issue(
        id: string,
        domains: string[],
        zoneId = fixture.zoneId,
    ): Promise<Record<string, unknown>> {
        const accepted = await context.controllerRequest(
            '/internal/v1/certificates/' + id + '/issue',
            {
                method: 'POST',
                body: JSON.stringify(issueRequest(domains, zoneId)),
            },
        )
        if (accepted.status !== 202) {
            const body = context.jsonObject(await accepted.json())
            const errorCode =
                CERTIFICATE_ERROR_CODES.find((code) => code === body.error) ?? 'unknown_error'
            throw new Error(`Delegated ACME request failed (HTTP ${accepted.status}: ${errorCode})`)
        }
        const metadata = await waitIdle(id)
        context.assertCertificateIssued(metadata)
        assert.equal(metadata.dnsMode, 'delegated')
        assert.deepEqual(metadata.domains, domains)
        return metadata
    }
    async function cleared(): Promise<void> {
        await context.waitFor(
            async () => fixture.records.length === foreign.length,
            'delegated TXT cleanup',
            90_000,
        )
        assert.deepEqual(fixture.records, foreign)
    }
    async function disconnectCa(): Promise<void> {
        await context.command(
            ['docker', 'network', 'disconnect', context.network, context.pebbleContainer],
            { timeoutMs: 30_000 },
        )
    }
    async function reconnectCa(): Promise<void> {
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
    }

    // The CA is unreachable: a delegation error proves preflight precedes any new order.
    await disconnectCa()
    try {
        const invalid = Bun.randomUUIDv7()
        assert.equal(
            (
                await context.controllerRequest('/internal/v1/certificates/' + invalid + '/issue', {
                    method: 'POST',
                    body: JSON.stringify(issueRequest(['undelegated.example.net'])),
                })
            ).status,
            202,
        )
        const failed = await waitIdle(invalid)
        assert.equal(failed.status, 'failed')
        assert.equal(failed.lastErrorCode, 'dns_delegation_invalid')
        assert.deepEqual(fixture.records, foreign)
    } finally {
        await reconnectCa()
    }
    context.passed('invalid delegation fails before contacting the isolated CA or writing TXT')

    const id = Bun.randomUUIDv7()
    const domains = ['*.delegated.example.net', 'delegated.example.net']
    const issued = await issue(id, domains)
    assert.ok(
        fixture.maxSimultaneousTxt >= 3,
        'Shared delegated owner never held both proofs beside foreign TXT',
    )
    await cleared()
    const assigned = context.snapshot([
        context.host(Bun.randomUUIDv7(), 'delegated.example.net', context.backend.port, id),
        context.host(Bun.randomUUIDv7(), 'proxy.delegated.example.net', context.backend.port, id),
    ])
    await context.apply(assigned)
    async function checkTraffic(): Promise<void> {
        for (const hostname of ['delegated.example.net', 'proxy.delegated.example.net']) {
            const response = await context.curl([
                '--fail',
                '--cacert',
                context.temp + '/issuance-root.pem',
                '--resolve',
                hostname + ':' + context.httpsPort + ':127.0.0.1',
                'https://' + hostname + ':' + context.httpsPort + '/delegated-dns',
            ])
            assert.match(response, /certificate-smoke-backend/u)
        }
    }
    await checkTraffic()
    assert.equal(fixture.cnames.get(source), terminal)
    context.passed(
        'real Pebble CNAME delegation issues apex/wildcard SANs outside the API zone and preserves foreign TXT',
    )

    await context.restartRuntime()
    await context.waitFor(
        async () => (await context.controllerRequest('/internal/v1/proxy/status')).status === 200,
        'delegated renewal restart',
    )
    assert.equal(
        (
            await context.controllerRequest('/internal/v1/certificates/' + id + '/renew', {
                method: 'POST',
                body: '{}',
            })
        ).status,
        202,
    )
    const renewed = await waitIdle(id)
    context.assertCertificateIssued(renewed)
    assert.notEqual(renewed.fingerprint, issued.fingerprint)
    await cleared()
    await checkTraffic()
    assert.equal(
        context.jsonObject(
            await (await context.controllerRequest('/internal/v1/proxy/status')).json(),
        ).activeRevision,
        assigned.revision,
    )
    context.passed(
        'delegated DNS renews unattended from the persisted connection after runtime restart',
    )

    const nsId = Bun.randomUUIDv7()
    const nsIssued = await issue(
        nsId,
        ['*.ns-delegated.example.net', 'ns-delegated.example.net'],
        nsZoneId,
    )
    await cleared()
    assert.deepEqual(fixture.nameservers.get(nsSource), ['ns.fixture.invalid'])
    context.passed(
        'real Pebble NS delegation uses the challenge-owner zone apex and retains its nameservers',
    )

    fixture.failCleanup = true
    try {
        assert.equal(
            (
                await context.controllerRequest('/internal/v1/certificates/' + id + '/renew', {
                    method: 'POST',
                    body: '{}',
                })
            ).status,
            202,
        )
        const pending = await waitIdle(id)
        context.assertCertificateIssued(pending)
        assert.equal(pending.dnsCleanupPending, true)
        assert.ok(fixture.records.length > foreign.length)
        // Drift must not redirect deletion to the newly advertised owner.
        fixture.cnames.set(source, '_acme-challenge.drift.example.com')
        await disconnectCa()
        try {
            fixture.failCleanup = false
            await context.restartRuntime()
            let recovered: Record<string, unknown> = {}
            await context.waitFor(
                async () => {
                    recovered = context.jsonObject(
                        await (
                            await context.controllerRequest('/internal/v1/certificates/' + id)
                        ).json(),
                    )
                    return recovered.operation === 'idle' && recovered.dnsCleanupPending === false
                },
                'literal delegated owner cleanup after restart',
                90_000,
            )
            assert.equal(recovered.fingerprint, pending.fingerprint)
            await cleared()
            await checkTraffic()
            assert.equal(fixture.cnames.get(source), '_acme-challenge.drift.example.com')
            assert.deepEqual(fixture.nameservers.get(nsSource), ['ns.fixture.invalid'])
            const nsRestored = context.jsonObject(
                await (await context.controllerRequest('/internal/v1/certificates/' + nsId)).json(),
            )
            assert.equal(nsRestored.fingerprint, nsIssued.fingerprint)
        } finally {
            await reconnectCa()
        }
    } finally {
        fixture.failCleanup = false
        fixture.cnames.delete(source)
        fixture.nameservers.delete('example.com')
        fixture.nameservers.delete(nsSource)
        fixture.zones.delete(nsZoneId)
        fixture.zones.delete(unrelatedZoneId)
        fixture.records.splice(0, fixture.records.length)
    }
    context.passed(
        'restart retries literal-owner delegated cleanup without another CA order despite CNAME drift',
    )
}
