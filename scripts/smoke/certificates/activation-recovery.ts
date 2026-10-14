import assert from 'node:assert/strict'
import { restoreCertificateStateFixture } from './state-restore.ts'
import type { CertificateActivationRecoveryContext } from './Types/scenarios.types.ts'

export async function verifyCertificateActivationRecovery(
    context: CertificateActivationRecoveryContext,
) {
    const adminSocketPath = '/var/lib/rentnerproxy/proxy/caddy-admin.sock'
    await context.command([
        'docker',
        'exec',
        context.runtimeContainer,
        'test',
        '-S',
        adminSocketPath,
    ])
    await context.command(['docker', 'exec', context.runtimeContainer, 'rm', '--', adminSocketPath])
    const failedActivationRenew = await context.controllerRequest(
        '/internal/v1/certificates/' + context.acmeId + '/renew',
        { method: 'POST', body: '{}' },
    )
    assert.equal(failedActivationRenew.status, 202)
    let failedActivation: Record<string, unknown> = {}
    await context.waitFor(
        async () => {
            failedActivation = context.jsonObject(
                await (
                    await context.controllerRequest('/internal/v1/certificates/' + context.acmeId)
                ).json(),
            )
            return (
                failedActivation.operation === 'idle' &&
                failedActivation.candidate !== null &&
                failedActivation.fingerprint === context.afterRenew.fingerprint
            )
        },
        'Caddy apply failure with a persisted ACME candidate',
        120_000,
    )
    assert.equal(failedActivation.status, 'valid')
    assert.equal(failedActivation.lastErrorCode, 'runtime_apply_failed')
    assert.notEqual(
        context.certificateCandidate(failedActivation.candidate).fingerprint,
        context.afterRenew.fingerprint,
    )
    assert.equal(
        await context.servedCertificateFingerprint(
            'acme.invalid',
            context.temp + '/served-acme-caddy-failure.pem',
        ),
        context.afterRenew.fingerprint,
    )
    context.passed(
        'Caddy apply failure keeps the old served certificate while the issued candidate is durable',
    )

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
            'certificates/' + context.acmeId + '/candidate.json',
        ],
    })
    context.passed(
        'production archive restores active material, issued candidate, operation journal and ACME account',
    )
    await context.restartRuntime()
    let restartedCandidate: Record<string, unknown> = {}
    await context.waitFor(async () => {
        restartedCandidate = context.jsonObject(
            await (
                await context.controllerRequest('/internal/v1/certificates/' + context.acmeId)
            ).json(),
        )
        return (
            restartedCandidate.operation === 'idle' &&
            restartedCandidate.candidate !== null &&
            restartedCandidate.fingerprint === context.afterRenew.fingerprint
        )
    }, 'candidate recovery after Caddy restart')
    const candidateFingerprint = context.certificateCandidate(
        restartedCandidate.candidate,
    ).fingerprint
    assert.equal(
        context.certificateOperation(restartedCandidate.currentOperation).id,
        context.certificateOperation(failedActivation.currentOperation).id,
    )
    const candidateRetry = await context.controllerRequest(
        '/internal/v1/certificates/' + context.acmeId + '/renew',
        { method: 'POST', body: '{}' },
    )
    assert.equal(candidateRetry.status, 202)
    let activatedCandidate: Record<string, unknown> = {}
    await context.waitFor(
        async () => {
            activatedCandidate = context.jsonObject(
                await (
                    await context.controllerRequest('/internal/v1/certificates/' + context.acmeId)
                ).json(),
            )
            return (
                activatedCandidate.operation === 'idle' &&
                activatedCandidate.candidate === null &&
                activatedCandidate.fingerprint === candidateFingerprint
            )
        },
        'candidate activation with Pebble offline',
        120_000,
    )
    assert.equal(activatedCandidate.lastErrorCode, null)
    assert.equal(
        context.certificateOperation(activatedCandidate.currentOperation).id,
        context.certificateOperation(failedActivation.currentOperation).id,
    )
    assert.equal(context.certificateOperation(activatedCandidate.currentOperation).stage, 'applied')
    const activationEvents = (await context.readCertificateEvents()).filter(
        (event) =>
            event.operationId ===
            context.certificateOperation(activatedCandidate.currentOperation).id,
    )
    assert.equal(activationEvents.filter((event) => event.kind === 'issued').length, 1)
    assert.equal(activationEvents.filter((event) => event.kind === 'activated').length, 1)
    assert.ok(activationEvents.some((event) => event.kind === 'retry_scheduled'))
    assert.equal(
        await context.servedCertificateFingerprint(
            'acme.invalid',
            context.temp + '/served-acme-candidate-retry.pem',
        ),
        candidateFingerprint,
    )
    assert.match(
        await context.curl([
            '--cacert',
            context.temp + '/issuance-root.pem',
            '--resolve',
            'acme.invalid:' + context.httpsPort + ':127.0.0.1',
            'https://acme.invalid:' + context.httpsPort + '/candidate-retry',
        ]),
        /certificate-smoke-backend/u,
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
    context.passed(
        'restarted runtime activates the same candidate with Pebble offline and serves its new TLS fingerprint',
    )
    return {}
}
