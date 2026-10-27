// oxlint-disable no-await-in-loop -- Bounded smoke scenarios preserve sequential polling.
import assert from 'node:assert/strict'
import { restoreCertificateStateFixture } from './state-restore.ts'
import type { CertificateDnsAcmeContext } from './Types/scenarios.types.ts'
import type { ManualDnsPause, ManualDnsProof } from './Types/manual-dns.types.ts'

function action(input: ManualDnsPause): string {
    return JSON.stringify({ operationId: input.operationId, challengeSetId: input.challengeSetId })
}

function sameChallenge(actual: ManualDnsPause, expected: ManualDnsPause): void {
    assert.equal(actual.operationId, expected.operationId)
    assert.equal(actual.challengeSetId, expected.challengeSetId)
    assert.deepEqual(actual.records, expected.records)
}
export async function verifyCertificateManualDns(
    context: CertificateDnsAcmeContext,
): Promise<void> {
    assert.ok(context.dnsFixture)
    assert.ok(context.backend?.port)
    const fixture = context.dnsFixture
    assert.equal(fixture.records.length, 0)
    const id = Bun.randomUUIDv7()
    const endpoint = '/internal/v1/certificates/' + id
    const request = {
        domains: ['*.example.com', 'example.com'],
        environment: 'staging',
        acceptTerms: true,
        challengeType: 'dns-01',
        dnsMode: 'manual',
    }
    const metadata = async () =>
        context.jsonObject(await (await context.controllerRequest(endpoint)).json())
    function pause(value: Record<string, unknown>): ManualDnsPause | undefined {
        if (!value.currentOperation) return undefined
        const operation = context.jsonObject(value.currentOperation)
        assert.equal(operation.dnsMode, 'manual')
        if (!operation.manualDns) return undefined
        const manual = context.jsonObject(operation.manualDns)
        if (manual.status !== 'awaiting_input') return undefined
        assert.equal(operation.stage, 'awaiting_dns')
        assert.equal(typeof operation.id, 'string')
        assert.equal(typeof manual.challengeSetId, 'string')
        assert.equal(typeof manual.expiresAt, 'string')
        assert.ok(Date.parse(String(manual.expiresAt)) > Date.now())
        assert.ok(Array.isArray(manual.records))
        const records: ManualDnsProof[] = manual.records.map((input: unknown) => {
            const record = context.jsonObject(input)
            assert.equal(typeof record.identifier, 'string')
            assert.equal(typeof record.owner, 'string')
            assert.equal(typeof record.value, 'string')
            assert.equal(typeof record.expiresAt, 'string')
            assert.match(String(record.value), /^[A-Za-z0-9_-]{43}$/u)
            return {
                identifier: String(record.identifier),
                owner: String(record.owner),
                value: String(record.value),
                expiresAt: String(record.expiresAt),
            }
        })
        assert.equal(records.length, 2)
        assert.deepEqual(records.map((record) => record.identifier).toSorted(), [
            '*.example.com',
            'example.com',
        ])
        assert.deepEqual(
            [...new Set(records.map((record) => record.owner))],
            ['_acme-challenge.example.com'],
        )
        assert.equal(new Set(records.map((record) => record.value)).size, 2)
        return {
            operationId: String(operation.id),
            challengeSetId: String(manual.challengeSetId),
            expiresAt: String(manual.expiresAt),
            records,
            lastCheckedAt: manual.lastCheckedAt,
            lastErrorCode: manual.lastErrorCode,
        }
    }
    async function waitForPause(previousCheck?: unknown): Promise<ManualDnsPause> {
        let result: ManualDnsPause | undefined
        await context.waitFor(
            async () => {
                const current = await metadata()
                assert.notEqual(current.operation, 'idle', 'Manual order unexpectedly terminated')
                result = pause(current)
                return (
                    result !== undefined &&
                    (previousCheck === undefined || result.lastCheckedAt !== previousCheck)
                )
            },
            'manual DNS operator input',
            90_000,
            (error) => !(error instanceof assert.AssertionError),
        )
        assert.ok(result)
        return result
    }

    async function continueOrder(input: ManualDnsPause): Promise<void> {
        assert.equal(
            (
                await context.controllerRequest(endpoint + '/dns-01/continue', {
                    method: 'POST',
                    body: action(input),
                })
            ).status,
            202,
        )
    }

    async function storedOrderIdentity(): Promise<string> {
        const index = context.jsonObject(
            JSON.parse(
                await context.command([
                    'docker',
                    'exec',
                    context.runtimeContainer,
                    'cat',
                    '/var/lib/rentnerproxy/proxy/certificates/certificate-metadata.json',
                ]),
            ),
        )
        const entry = context.jsonObject(context.jsonObject(index.certificates)[id])
        const acme = context.jsonObject(entry.acme)
        assert.equal(acme.dnsMode, 'manual')
        assert.equal(acme.dnsProvider, null)
        const saved = context.jsonObject(acme.manualOrder)
        assert.equal(typeof saved.orderUrl, 'string')
        return String(saved.orderUrl)
    }
    assert.equal(
        (
            await context.controllerRequest(endpoint + '/issue', {
                method: 'POST',
                body: JSON.stringify(request),
            })
        ).status,
        202,
    )
    const initial = await waitForPause()
    const orderIdentity = await storedOrderIdentity()
    assert.equal(fixture.records.length, 0, 'Manual issuance wrote DNS records')
    context.passed('manual DNS exposes separate apex/wildcard TXT values at their shared owner')

    await continueOrder(initial)
    const missing = await waitForPause(initial.lastCheckedAt)
    sameChallenge(missing, initial)
    assert.equal(missing.lastErrorCode, 'manual_dns_not_propagated')
    // Operator changes only this isolated DNS server; no provider API is involved.
    const unrelated = {
        id: Bun.randomUUIDv7(),
        type: 'TXT' as const,
        name: initial.records[0]!.owner,
        content: 'unrelated-operator-managed-TXT',
    }
    fixture.records.push(unrelated)
    await continueOrder(missing)
    const wrong = await waitForPause(missing.lastCheckedAt)
    sameChallenge(wrong, initial)
    assert.equal(wrong.lastErrorCode, 'manual_dns_not_propagated')
    assert.equal(await storedOrderIdentity(), orderIdentity)
    context.passed(
        'missing and wrong manual TXT proofs remain retryable without failing the CA order',
    )

    await context.restartRuntime()
    const restarted = await waitForPause()
    sameChallenge(restarted, initial)
    assert.equal(await storedOrderIdentity(), orderIdentity)
    await restoreCertificateStateFixture(context.command, {
        container: context.runtimeContainer,
        volume: context.stateVolume,
        image: context.runtimeImage,
        requiredFiles: [
            'certificates/certificate-metadata.json',
            'certificates/acme-accounts/staging.json',
        ],
    })
    await context.restartRuntime()
    const restored = await waitForPause()
    sameChallenge(restored, initial)
    assert.equal(await storedOrderIdentity(), orderIdentity)
    context.passed(
        'pending manual DNS order, operation and challenge set survive restart and state archive restore',
    )

    const proofs = restored.records.map((record) => ({
        id: Bun.randomUUIDv7(),
        type: 'TXT' as const,
        name: record.owner,
        content: record.value,
    }))
    fixture.records.push(...proofs)
    await continueOrder(restored)
    let issued: Record<string, unknown> = {}
    await context.waitFor(
        async () => {
            issued = await metadata()
            return issued.operation === 'idle'
        },
        'real Pebble manual DNS certificate issuance',
        180_000,
    )
    context.assertCertificateIssued(issued)
    assert.deepEqual(issued.domains, request.domains)
    assert.equal(await storedOrderIdentity(), orderIdentity)
    assert.deepEqual(fixture.records, [unrelated, ...proofs])
    const activeSnapshot = context.snapshot([
        context.host(Bun.randomUUIDv7(), 'manual.example.com', context.backend.port, id),
        context.host(Bun.randomUUIDv7(), 'example.com', context.backend.port, id),
    ])
    await context.apply(activeSnapshot)
    async function checkTraffic(): Promise<void> {
        for (const hostname of ['manual.example.com', 'example.com']) {
            const response = await context.curl([
                '--fail',
                '--cacert',
                context.temp + '/issuance-root.pem',
                '--resolve',
                hostname + ':' + context.httpsPort + ':127.0.0.1',
                'https://' + hostname + ':' + context.httpsPort + '/manual-dns',
            ])
            assert.match(response, /certificate-smoke-backend/u)
        }
    }
    await checkTraffic()
    context.passed('real manual DNS ACME certificate activates HTTPS for apex and wildcard hosts')

    // Only the operator removes the TXT proofs after issuance.
    fixture.records.splice(0, fixture.records.length, unrelated)
    assert.equal(
        (
            await context.controllerRequest(endpoint + '/renew', {
                method: 'POST',
                body: '{}',
            })
        ).status,
        202,
    )
    const renewal = await waitForPause()
    assert.notEqual(renewal.operationId, initial.operationId)
    assert.notEqual(renewal.challengeSetId, initial.challengeSetId)
    const awaitingRenewal = await metadata()
    assert.equal(awaitingRenewal.status, 'valid')
    assert.equal(awaitingRenewal.fingerprint, issued.fingerprint)
    await checkTraffic()
    const stale = await context.controllerRequest(endpoint + '/dns-01/cancel', {
        method: 'POST',
        body: action(initial),
    })
    assert.equal(stale.status, 409)
    assert.equal(
        (
            await context.controllerRequest(endpoint + '/dns-01/cancel', {
                method: 'POST',
                body: action(renewal),
            })
        ).status,
        200,
    )
    const cancelled = await metadata()
    assert.equal(cancelled.operation, 'idle')
    assert.equal(cancelled.status, 'valid')
    assert.equal(cancelled.lastErrorCode, 'manual_dns_cancelled')
    assert.equal(cancelled.fingerprint, issued.fingerprint)
    assert.deepEqual(fixture.records, [unrelated])
    await checkTraffic()
    context.passed(
        'manual renewal waits with the active certificate live; cancellation rejects stale actions and preserves unrelated TXT',
    )
    fixture.records.splice(0, fixture.records.length)
}
