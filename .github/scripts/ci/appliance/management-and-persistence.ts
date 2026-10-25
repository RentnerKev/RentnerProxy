// oxlint-disable no-await-in-loop -- Bounded smoke scenarios preserve their sequential polling.
import assert from 'node:assert/strict'
import { request as httpRequest } from 'node:http'
import type { ApplianceManagementAndPersistenceContext } from './Types/scenarios.types.ts'

export async function verifyApplianceManagementAndPersistence(
    context: ApplianceManagementAndPersistenceContext,
) {
    const setup = await context.httpStatus('http://127.0.0.1:' + context.managementPort + '/setup')
    assert.equal(setup.status, 200)
    assert.match(setup.body, /setup|RentnerProxy/iu)
    const entryAsset = setup.body.match(/<script[^>]+src="([^"]+\.js)"/iu)?.[1]
    assert.ok(entryAsset)
    const entryAssetResponse = await context.httpStatus(
        'http://127.0.0.1:' + context.managementPort + entryAsset,
    )
    assert.equal(entryAssetResponse.status, 200)
    context.passed('SSR setup entry module is served for client hydration')
    const stylesheetAssets = Array.from(
        setup.body.matchAll(/<link\b(?=[^>]*\brel="stylesheet")[^>]*\bhref="([^"]+)"/giu),
        (match) => match[1]!,
    )
    assert.ok(stylesheetAssets.length > 0)
    for (const stylesheetAsset of new Set(stylesheetAssets)) {
        assert.ok(stylesheetAsset.startsWith('/assets/'))
        const response = await fetch(
            'http://127.0.0.1:' + context.managementPort + stylesheetAsset,
            {
                signal: AbortSignal.timeout(5_000),
            },
        )
        assert.equal(response.status, 200)
        assert.match(response.headers.get('content-type') ?? '', /^text\/css\b/iu)
        assert.ok((await response.text()).length > 0)
    }
    context.passed('every SSR stylesheet resolves to packaged production CSS')
    const live = await context.httpStatus(
        'http://127.0.0.1:' + context.managementPort + '/health/live',
    )
    assert.equal(live.status, 200)
    assert.deepEqual(JSON.parse(live.body), { status: 'ok' })
    const ready = await context.httpStatus(
        'http://127.0.0.1:' + context.managementPort + '/health/ready',
    )
    assert.equal(ready.status, 200)
    assert.deepEqual(JSON.parse(ready.body), { status: 'ready' })
    const proxy = await context.httpStatus('http://127.0.0.1:' + context.httpPort + '/')
    assert.ok(proxy.status >= 200 && proxy.status < 500)
    context.passed('setup, liveness, readiness, and proxy HTTP endpoints respond')

    const oversizedStatus = await new Promise<number | undefined>((resolveStatus, reject) => {
        const request = httpRequest(
            'http://127.0.0.1:' + context.managementPort + '/health/live',
            {
                method: 'POST',
                headers: { 'Content-Length': String(12 * 1024 * 1024 + 1) },
            },
            (response) => {
                response.resume()
                resolveStatus(response.statusCode)
            },
        )
        request.on('error', reject)
        request.setTimeout(5_000, () => request.destroy(new Error('body-limit probe timed out')))
        request.end()
    })
    assert.equal(oversizedStatus, 413)
    context.passed('web listener rejects oversized request bodies before application processing')

    const portBindings = JSON.parse(
        await context.inspect(context.id, '{{json .HostConfig.PortBindings}}'),
    ) as Record<string, unknown> | null
    assert.deepEqual(Object.keys(portBindings ?? {}).toSorted(), [
        '3000/tcp',
        '8080/tcp',
        '8443/tcp',
        '8443/udp',
    ])
    const procNet = await context.command([
        'docker',
        'exec',
        context.id,
        'sh',
        '-c',
        'cat /proc/net/tcp /proc/net/tcp6',
    ])
    context.assertLoopbackListeners(procNet, 5432)
    context.assertLoopbackListeners(procNet, 6379)
    context.assertLoopbackListeners(procNet, 8081)
    context.passed('database, Valkey, and controller are unpublished and loopback-only')

    const environment = JSON.parse(
        await context.inspect(context.id, '{{json .Config.Env}}'),
    ) as string[]
    assert.ok(environment.includes('PROXY_TRUSTED_PROXY_CIDRS=' + context.trustedProxyCidrs))
    for (const name of context.smtpNames) {
        assert.ok(
            environment.includes(
                `${name}=${context.smtpEnvironment[name as keyof typeof context.smtpEnvironment]}`,
            ),
        )
    }
    context.passed('dummy SMTP configuration reaches the appliance container')

    const generatedSecrets = JSON.parse(
        await context.command([
            'docker',
            'exec',
            context.id,
            'bun',
            '-e',
            'const state = await Bun.file("/var/lib/rentnerproxy/bootstrap/secrets-v1.json").json(); process.stdout.write(JSON.stringify(state));',
        ]),
    ) as Record<string, string>
    const secretNames = ['appEncryptionKey', 'controllerToken', 'databaseUrl', 'postgresPassword']
    for (const name of secretNames) assert.equal(typeof generatedSecrets[name], 'string')
    assert.match(generatedSecrets.postgresPassword!, /^[a-f0-9]{64}$/u)
    assert.match(generatedSecrets.controllerToken!, /^[a-f0-9]{64}$/u)
    assert.match(generatedSecrets.appEncryptionKey!, /^[A-Za-z0-9+/]{43}=$/u)
    const generatedSecretDigests = Object.fromEntries(
        secretNames.map((name) => [name, context.digest(generatedSecrets[name]!)]),
    )
    const image = await context.inspect(context.id, '{{.Image}}')
    const imageHistory = await context.command([
        'docker',
        'history',
        '--no-trunc',
        '--format',
        '{{.CreatedBy}}',
        image,
    ])
    const stackLogs = await context.command([...context.compose, 'logs', '--no-color'])
    for (const name of secretNames) {
        const secret = generatedSecrets[name]!
        assert.equal(imageHistory.includes(secret), false, name + ' leaked into image history')
        assert.equal(
            environment.some((entry) => entry.includes(secret)),
            false,
            name + ' leaked into container environment',
        )
        assert.equal(stackLogs.includes(secret), false, name + ' leaked into container logs')
    }
    context.passed('generated secrets stay out of image history, container env, and logs')

    const marker = 'appliance-smoke-' + context.runId
    await context.command([
        'docker',
        'exec',
        context.id,
        'sh',
        '-c',
        `printf %s ${marker} > /var/lib/rentnerproxy/appliance-smoke-marker; PGPASSWORD="$(cat /run/rentnerproxy/postgres/value)" gosu postgres psql --host=127.0.0.1 --username=rentnerproxy --dbname=rentnerproxy --command="CREATE TABLE IF NOT EXISTS appliance_compose_smoke (marker text PRIMARY KEY); INSERT INTO appliance_compose_smoke (marker) VALUES ('${marker}') ON CONFLICT DO NOTHING;" >/dev/null`,
    ])
    const markerDigest = await context.command([
        'docker',
        'exec',
        context.id,
        'sha256sum',
        '/var/lib/rentnerproxy/appliance-smoke-marker',
    ])
    await context.command([
        'docker',
        'exec',
        context.id,
        'chgrp',
        'rentnerproxy',
        context.accessLogPath,
    ])
    assert.equal(
        await context.command([
            'docker',
            'exec',
            context.id,
            'stat',
            '-c',
            '%a:%u:%g',
            context.accessLogPath,
        ]),
        '640:10001:10001',
    )
    await context.command([...context.compose, 'up', '--force-recreate', '--detach'])
    let recreatedId = await context.containerId(context.compose)
    await context.waitForHealthy(recreatedId)
    const recreatedSecrets = JSON.parse(
        await context.command([
            'docker',
            'exec',
            recreatedId,
            'bun',
            '-e',
            'const state = await Bun.file("/var/lib/rentnerproxy/bootstrap/secrets-v1.json").json(); process.stdout.write(JSON.stringify(state));',
        ]),
    ) as Record<string, string>
    assert.deepEqual(
        Object.fromEntries(
            secretNames.map((name) => [name, context.digest(recreatedSecrets[name]!)]),
        ),
        generatedSecretDigests,
    )
    assert.equal(
        await context.command([
            'docker',
            'exec',
            recreatedId,
            'sha256sum',
            '/var/lib/rentnerproxy/appliance-smoke-marker',
        ]),
        markerDigest,
    )
    const restoredMarker = await context.command([
        'docker',
        'exec',
        recreatedId,
        'sh',
        '-c',
        `PGPASSWORD="$(cat /run/rentnerproxy/postgres/value)" gosu postgres psql --host=127.0.0.1 --username=rentnerproxy --dbname=rentnerproxy --tuples-only --no-align --command="SELECT marker FROM appliance_compose_smoke WHERE marker = '${marker}';"`,
    ])
    assert.equal(restoredMarker, marker)
    context.passed(
        'container recreation preserves generated secrets, volume state, and database state',
    )
    return {
        generatedSecrets,
        marker,
        get recreatedId() {
            return recreatedId
        },
        set recreatedId(value: typeof recreatedId) {
            recreatedId = value
        },
    }
}
