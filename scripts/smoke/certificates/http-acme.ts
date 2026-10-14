// oxlint-disable no-await-in-loop -- Bounded smoke scenarios preserve their sequential polling.
import assert from 'node:assert/strict'
import { assertHttp3Response } from '../http3/client.ts'
import type { CertificateHttpAcmeContext } from './Types/scenarios.types.ts'

export async function verifyCertificateHttpAcme(context: CertificateHttpAcmeContext) {
    const accountFile = '/var/lib/rentnerproxy/proxy/certificates/acme-accounts/staging.json'
    await context.command([
        'docker',
        'network',
        'disconnect',
        context.network,
        context.pebbleContainer,
    ])
    let pendingAccountDigest = ''
    for (let attempt = 0; attempt < 2; attempt += 1) {
        const interruptedId = Bun.randomUUIDv7()
        const interrupted = await context.controllerRequest(
            '/internal/v1/certificates/' + interruptedId + '/issue',
            {
                method: 'POST',
                body: JSON.stringify({
                    domains: ['acme.invalid'],
                    environment: 'staging',
                    acceptTerms: true,
                }),
            },
        )
        assert.equal(interrupted.status, 202)
        await context.waitFor(
            async () => {
                const metadata = context.jsonObject(
                    await (
                        await context.controllerRequest(
                            '/internal/v1/certificates/' + interruptedId,
                        )
                    ).json(),
                )
                return metadata.status === 'failed' && metadata.operation === 'idle'
            },
            'interrupted initial account registration',
            90_000,
        )
        const digest = await context.command([
            'docker',
            'exec',
            context.runtimeContainer,
            'sha256sum',
            accountFile,
        ])
        if (attempt === 0) {
            pendingAccountDigest = digest
            await context.restartRuntime()
            await context.waitFor(async () => {
                const response = await context.controllerRequest('/internal/v1/proxy/status')
                return (
                    response.status === 200 &&
                    context.jsonObject(await response.json()).running === true
                )
            }, 'restart before account registration recovery')
            assert.equal(
                await context.command([
                    'docker',
                    'exec',
                    context.runtimeContainer,
                    'sha256sum',
                    accountFile,
                ]),
                pendingAccountDigest,
            )
            context.passed(
                'private ACME registration key is persisted before network access and survives restart',
            )
        } else {
            assert.equal(digest, pendingAccountDigest)
            context.passed('failed account registration retries reuse the persisted private key')
        }
    }
    await context.command([
        'docker',
        'network',
        'connect',
        '--alias',
        'pebble',
        context.network,
        context.pebbleContainer,
    ])
    await context.waitForPebbleNetwork()

    const acmeIssue = await context.controllerRequest(
        '/internal/v1/certificates/' + context.acmeId + '/issue',
        {
            method: 'POST',
            body: JSON.stringify({
                domains: ['acme.invalid'],
                environment: 'staging',
                acceptTerms: true,
            }),
        },
    )
    assert.equal(acmeIssue.status, 202)
    const acceptedIssue = context.jsonObject(await acmeIssue.json())
    assert.equal(context.certificateOperation(acceptedIssue.currentOperation).kind, 'issue')
    assert.equal(context.certificateOperation(acceptedIssue.currentOperation).stage, 'queued')
    const issueOperationId = context.certificateOperation(acceptedIssue.currentOperation).id
    assert.match(
        issueOperationId,
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    )
    await context.waitFor(
        async () => {
            const metadata = context.jsonObject(
                await (
                    await context.controllerRequest('/internal/v1/certificates/' + context.acmeId)
                ).json(),
            )
            return metadata.operation === 'idle'
        },
        'Pebble ACME HTTP-01 issuance',
        90_000,
    )
    const acmeMetadata = context.jsonObject(
        await (
            await context.controllerRequest('/internal/v1/certificates/' + context.acmeId)
        ).json(),
    )
    context.assertCertificateIssued(acmeMetadata)
    assert.equal(acmeMetadata.source, 'acme')
    assert.equal(acmeMetadata.environment, 'staging')
    assert.equal(typeof acmeMetadata.fingerprint, 'string')
    assert.equal(context.certificateOperation(acmeMetadata.currentOperation).id, issueOperationId)
    assert.equal(context.certificateOperation(acmeMetadata.currentOperation).stage, 'applied')
    assert.equal(acmeMetadata.challengeType, 'http-01')
    assert.ok(typeof acmeMetadata.lastActivatedAt === 'string')
    assert.ok(Number.isFinite(Date.parse(acmeMetadata.lastActivatedAt)))
    async function readCertificateEvents() {
        const events: ReturnType<typeof context.certificateEvents> = []
        let after: string | null = null
        for (let page = 0; page < 100; page += 1) {
            const query = new URLSearchParams({ limit: '25' })
            if (after) query.set('after', after)
            const response = await context.controllerRequest(
                '/internal/v1/certificates/events?' + query.toString(),
            )
            assert.equal(response.status, 200)
            assert.equal(response.headers.get('cache-control'), 'no-store')
            const body = context.jsonObject(await response.json())
            assert.ok(Array.isArray(body.events) && body.events.length <= 25)
            events.push(...context.certificateEvents(body.events))
            if (!body.hasMore) {
                assert.equal(new Set(events.map((event) => event.id)).size, events.length)
                return events
            }
            assert.equal(typeof body.nextCursor, 'string')
            assert.notEqual(body.nextCursor, after)
            assert.ok(typeof body.nextCursor === 'string')
            after = body.nextCursor
        }
        throw new Error('Certificate event pagination exceeded its bound')
    }
    const issuedEvents = (await readCertificateEvents()).filter(
        (event) => event.operationId === issueOperationId,
    )
    assert.deepEqual(
        issuedEvents.map((event) => event.kind),
        ['accepted', 'started', 'issued', 'activated'],
    )
    assert.ok(issuedEvents.every((event) => event.certificateId === context.acmeId))
    assert.equal(
        context.upstreamRequests.some((request) =>
            request.includes('/.well-known/acme-challenge/'),
        ),
        false,
    )
    context.passed(
        'real Pebble account/order HTTP-01 issuance completes; challenge traffic does not reach the upstream',
    )
    const accountBeforeRenewal = await context.command([
        'docker',
        'exec',
        context.runtimeContainer,
        'sha256sum',
        accountFile,
    ])
    const failedAuthorizationId = Bun.randomUUIDv7()
    const failedAuthorization = await context.controllerRequest(
        '/internal/v1/certificates/' + failedAuthorizationId + '/issue',
        {
            method: 'POST',
            body: JSON.stringify({
                domains: ['failed.invalid'],
                environment: 'staging',
                acceptTerms: true,
            }),
        },
    )
    assert.equal(failedAuthorization.status, 202)
    await context.waitFor(
        async () => {
            const metadata = context.jsonObject(
                await (
                    await context.controllerRequest(
                        '/internal/v1/certificates/' + failedAuthorizationId,
                    )
                ).json(),
            )
            return metadata.operation === 'idle'
        },
        'failed Pebble authorization',
        90_000,
    )
    const failedAuthorizationMetadata = context.jsonObject(
        await (
            await context.controllerRequest('/internal/v1/certificates/' + failedAuthorizationId)
        ).json(),
    )
    assert.equal(failedAuthorizationMetadata.status, 'failed')
    assert.equal(failedAuthorizationMetadata.lastErrorCode, 'acme_failed')
    context.passed('unroutable authorization fails with the safe acme_failed code')
    await context.apply(
        await context.snapshot([
            { ...context.one },
            { ...context.acmeHost, certificateId: context.acmeId, forceHttps: true },
        ]),
    )
    const acmeHttps = await context.curl([
        '--cacert',
        context.temp + '/issuance-root.pem',
        '--resolve',
        'acme.invalid:' + context.httpsPort + ':127.0.0.1',
        'https://acme.invalid:' + context.httpsPort + '/issued',
    ])
    assert.match(acmeHttps, /certificate-smoke-backend/u)
    context.passed(
        'issued Pebble certificate is installed and verified through the fetched issuance root',
    )

    const issuedFingerprint = acmeMetadata.fingerprint
    await context.command(
        ['docker', 'network', 'disconnect', context.network, context.pebbleContainer],
        {
            timeoutMs: 30_000,
        },
    )
    const failedRenew = await context.controllerRequest(
        '/internal/v1/certificates/' + context.acmeId + '/renew',
        { method: 'POST', body: '{}' },
    )
    assert.equal(failedRenew.status, 202)
    await context.waitFor(
        async () => {
            const metadata = context.jsonObject(
                await (
                    await context.controllerRequest('/internal/v1/certificates/' + context.acmeId)
                ).json(),
            )
            return metadata.operation === 'idle'
        },
        'bounded failed renewal recovery',
        90_000,
    )
    const afterFailedRenew = context.jsonObject(
        await (
            await context.controllerRequest('/internal/v1/certificates/' + context.acmeId)
        ).json(),
    )
    assert.equal(afterFailedRenew.status, 'valid')
    assert.equal(afterFailedRenew.lastErrorCode, 'acme_failed')
    assert.equal(afterFailedRenew.fingerprint, issuedFingerprint)
    const afterFailedRenewTraffic = await context.curl([
        '--cacert',
        context.temp + '/issuance-root.pem',
        '--resolve',
        'acme.invalid:' + context.httpsPort + ':127.0.0.1',
        'https://acme.invalid:' + context.httpsPort + '/renewal-failure',
    ])
    assert.match(afterFailedRenewTraffic, /certificate-smoke-backend/u)
    context.passed(
        'failed ACME renewal preserves the previous certificate and HTTPS traffic, then returns to idle',
    )

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
    assert.equal(
        (
            await context.controllerRequest(
                '/internal/v1/certificates/' + context.acmeId + '/renew',
                {
                    method: 'POST',
                    body: '{}',
                },
            )
        ).status,
        409,
    )
    assert.ok(typeof afterFailedRenew.nextAttemptAt === 'string')
    assert.ok(Date.parse(afterFailedRenew.nextAttemptAt) > Date.now())
    await context.restartRuntime()
    await context.waitFor(
        async () => (await context.controllerRequest('/internal/v1/proxy/status')).status === 200,
        'restart with persisted HTTP renewal retry',
    )
    assert.equal(
        (
            await context.controllerRequest(
                '/internal/v1/certificates/' + context.acmeId + '/renew',
                {
                    method: 'POST',
                    body: '{}',
                },
            )
        ).status,
        409,
    )
    context.passed('manual retry respects the persisted HTTP renewal backoff across restart')
    await context.expireRetryFixture(context.acmeId)
    const successfulRenew = await context.controllerRequest(
        '/internal/v1/certificates/' + context.acmeId + '/renew',
        { method: 'POST', body: '{}' },
    )
    assert.equal(successfulRenew.status, 202)
    await context.waitFor(
        async () => {
            const metadata = context.jsonObject(
                await (
                    await context.controllerRequest('/internal/v1/certificates/' + context.acmeId)
                ).json(),
            )
            return metadata.operation === 'idle'
        },
        'successful ACME renewal',
        90_000,
    )
    const afterRenew = context.jsonObject(
        await (
            await context.controllerRequest('/internal/v1/certificates/' + context.acmeId)
        ).json(),
    )
    context.assertCertificateIssued(afterRenew)
    assert.notEqual(afterRenew.fingerprint, issuedFingerprint)
    assert.equal(
        await context.command([
            'docker',
            'exec',
            context.runtimeContainer,
            'sha256sum',
            accountFile,
        ]),
        accountBeforeRenewal,
    )
    const renewedTraffic = await context.curl([
        '--cacert',
        context.temp + '/issuance-root.pem',
        '--resolve',
        'acme.invalid:' + context.httpsPort + ':127.0.0.1',
        'https://acme.invalid:' + context.httpsPort + '/renewed',
    ])
    assert.match(renewedTraffic, /certificate-smoke-backend/u)
    context.passed(
        'ACME renewal reuses the persisted account and installs new certificate material after recovery',
    )
    const renewalOperationId = context.certificateOperation(afterRenew.currentOperation).id
    assert.notEqual(renewalOperationId, issueOperationId)
    const renewalEvents = (await readCertificateEvents()).filter(
        (event) => event.operationId === renewalOperationId,
    )
    assert.deepEqual(
        renewalEvents.map((event) => event.kind),
        ['accepted', 'started', 'issued', 'activated', 'renewed'],
    )
    await context.restartRuntime()
    await context.waitFor(async () => {
        const status = await context.controllerRequest('/internal/v1/proxy/status')
        return status.status === 200 && context.jsonObject(await status.json()).running === true
    }, 'controller restart with persisted certificate state')
    assert.deepEqual(
        (await readCertificateEvents()).filter((event) => event.operationId === renewalOperationId),
        renewalEvents,
    )
    context.passed(
        'operation and event IDs survive controller restart with bounded duplicate-free event replay',
    )
    assert.equal(
        context.jsonObject(
            await (
                await context.controllerRequest('/internal/v1/certificates/' + context.acmeId)
            ).json(),
        ).fingerprint,
        afterRenew.fingerprint,
    )
    assert.equal(
        await context.command([
            'docker',
            'exec',
            context.runtimeContainer,
            'sha256sum',
            accountFile,
        ]),
        accountBeforeRenewal,
    )
    assert.match(
        await context.curl([
            '--cacert',
            context.temp + '/issuance-root.pem',
            '--resolve',
            'acme.invalid:' + context.httpsPort + ':127.0.0.1',
            'https://acme.invalid:' + context.httpsPort + '/restart',
        ]),
        /certificate-smoke-backend/u,
    )
    context.passed('controller restart preserves account, metadata and live HTTPS configuration')
    const restartedQuic = await context.quic({
        hostname: 'acme.invalid',
        caFile: context.temp + '/issuance-root.pem',
    })
    assertHttp3Response(restartedQuic, 200, context.httpsPort)
    assert.equal(restartedQuic.fingerprint, afterRenew.fingerprint)
    context.passed('HTTP/3 preserves the renewed certificate after controller and Caddy restart')
    return {
        readCertificateEvents,
        afterRenew,
    }
}
