// oxlint-disable no-await-in-loop -- Bounded smoke scenarios preserve their sequential polling.
import assert from 'node:assert/strict'
import { requestHttp3Client } from '../../../../scripts/smoke/http3/client.ts'
import type { ApplianceCrowdsecContext } from './Types/scenarios.types.ts'

export async function verifyApplianceCrowdsec(context: ApplianceCrowdsecContext) {
    const internalHttpStatus = async (path = '/appliance-real-path'): Promise<number> =>
        Number(
            await context.command([
                'docker',
                'exec',
                context.recreatedId,
                'curl',
                '--silent',
                '--show-error',
                '--noproxy',
                '*',
                '--output',
                '/dev/null',
                '--write-out',
                '%{http_code}',
                '--header',
                'Host: ' + context.hostDomain,
                'http://127.0.0.1:8080' + path,
            ]),
        )
    const requestPublishedProtocol = async (
        protocol: '--http1.1' | '--http2' | '--http3-only',
        expectedStatus: number,
    ) => {
        const response = await requestHttp3Client(context.http3Command, {
            image: context.http3Image,
            caFile: context.http3CaFile,
            hostname: context.hostDomain,
            port: context.httpsPort,
            path: '/appliance-real-path',
            protocol,
        })
        assert.equal(response.status, expectedStatus)
        assert.equal(
            response.protocol,
            protocol === '--http1.1' ? '1.1' : protocol === '--http2' ? '2' : '3',
        )
        return response
    }

    const managedStatus = await context.applyCrowdSecMode(context.recreatedId, 'managed')
    assert.deepEqual(managedStatus, {
        mode: 'managed',
        state: 'connected',
        credentialConfigured: false,
        enforcementActive: true,
        managedEngine: 'ready',
        communityEnabled: false,
        communityState: 'disabled',
        consoleState: 'not_enrolled',
        failureBehavior: 'fail_open',
        clientIpSource: 'caddy',
    })
    await context.persistCrowdSecMode(context.recreatedId, 'managed', true)
    const onlineOptIn = await context.controllerCall(
        context.recreatedId,
        '/internal/v1/crowdsec/config',
        'PUT',
        {
            mode: 'managed',
            communityEnabled: true,
        },
    )
    assert.equal(onlineOptIn.status, 200)
    await context.waitForCrowdSec(
        context.recreatedId,
        (status) =>
            status.mode === 'managed' &&
            status.communityEnabled &&
            status.state === 'connected' &&
            status.managedEngine === 'ready',
        'managed CrowdSec local enforcement during community opt-in',
    )
    assert.equal(
        await context.command([
            'docker',
            'exec',
            context.recreatedId,
            'cat',
            '/run/rentnerproxy/crowdsec/desired-mode',
        ]),
        'managed-online',
    )
    await context.applyCrowdSecMode(context.recreatedId, 'managed')
    await context.waitForCrowdSec(
        context.recreatedId,
        (status) => status.communityState === 'disabled' && status.managedEngine === 'ready',
        'managed CrowdSec offline after community opt-out',
    )
    context.passed('managed community opt-in and opt-out retain local enforcement')
    assert.deepEqual(await context.crowdSecEngineUids(context.recreatedId), ['10003'])
    const managedProcNet = await context.command([
        'docker',
        'exec',
        context.recreatedId,
        'sh',
        '-c',
        'cat /proc/net/tcp /proc/net/tcp6',
    ])
    context.assertLoopbackListeners(managedProcNet, 18080)
    context.assertLoopbackListeners(managedProcNet, 6060)
    assert.equal(
        await context.command([
            'docker',
            'exec',
            context.recreatedId,
            'stat',
            '-c',
            '%a:%u:%g',
            '/var/lib/rentnerproxy/proxy',
        ]),
        '710:10001:10003',
    )
    assert.equal(
        await context.command([
            'docker',
            'exec',
            context.recreatedId,
            'stat',
            '-c',
            '%a:%u:%g',
            '/var/lib/rentnerproxy/proxy/logs',
        ]),
        '2750:10001:10003',
    )
    assert.equal(
        await context.command([
            'docker',
            'exec',
            context.recreatedId,
            'stat',
            '-c',
            '%a:%u',
            '/var/lib/rentnerproxy/proxy/caddy',
        ]),
        '700:10001',
    )
    assert.equal(
        await context.command([
            'docker',
            'exec',
            context.recreatedId,
            'stat',
            '-c',
            '%a:%u:%g',
            context.accessLogPath,
        ]),
        '640:10001:10003',
    )
    await context.command([
        'docker',
        'exec',
        '--user',
        '10003:10003',
        context.recreatedId,
        'test',
        '-r',
        context.accessLogPath,
    ])
    assert.equal(
        await context.command([
            'docker',
            'exec',
            context.recreatedId,
            'stat',
            '-c',
            '%a:%U:%G',
            '/var/lib/rentnerproxy/crowdsec/bouncer/caddy-bouncer-key',
        ]),
        '440:root:rentnerproxy',
    )
    assert.equal(
        await context.command([
            'docker',
            'exec',
            context.recreatedId,
            'stat',
            '-c',
            '%U:%G',
            '/var/lib/rentnerproxy/crowdsec/data/crowdsec.db',
        ]),
        'crowdsec:crowdsec',
    )
    const acquisitionProbe = {
        httpStatus: -1,
        metricsReachable: false,
        accessLogHits: 0,
        allFileHits: 0,
        caddyParserHits: 0,
        allParserHits: 0,
    }
    try {
        await context.waitFor(
            async () => {
                acquisitionProbe.httpStatus = await internalHttpStatus()
                if (acquisitionProbe.httpStatus !== 200) return false
                acquisitionProbe.metricsReachable = false
                const metrics = await context.command([
                    'docker',
                    'exec',
                    context.recreatedId,
                    'curl',
                    '--fail',
                    '--silent',
                    '--show-error',
                    '--max-time',
                    '2',
                    'http://127.0.0.1:6060/metrics',
                ])
                acquisitionProbe.metricsReachable = true
                const fileHits =
                    /^cs_filesource_hits_total\{[^}\n]*source="[^"]*\/var\/lib\/rentnerproxy\/proxy\/logs\/access\.log"[^}\n]*\}\s+(\d+(?:\.\d+)?)/mu.exec(
                        metrics,
                    )
                const parserHits =
                    /^cs_node_hits_ok_total\{[^}\n]*name="crowdsecurity\/caddy-logs"[^}\n]*\}\s+(\d+(?:\.\d+)?)/mu.exec(
                        metrics,
                    )
                acquisitionProbe.accessLogHits = Number(fileHits?.[1] ?? 0)
                acquisitionProbe.caddyParserHits = Number(parserHits?.[1] ?? 0)
                acquisitionProbe.allFileHits = [
                    ...metrics.matchAll(
                        /^cs_filesource_hits_total\{[^}\n]*\}\s+(\d+(?:\.\d+)?)/gmu,
                    ),
                ].reduce((total, match) => total + Number(match[1]), 0)
                acquisitionProbe.allParserHits = [
                    ...metrics.matchAll(/^cs_node_hits_ok_total\{[^}\n]*\}\s+(\d+(?:\.\d+)?)/gmu),
                ].reduce((total, match) => total + Number(match[1]), 0)
                return acquisitionProbe.accessLogHits > 0 && acquisitionProbe.caddyParserHits > 0
            },
            'managed CrowdSec acquisition and Caddy parsing',
            30_000,
        )
    } catch (error) {
        const accessLogBytes = await context
            .command([
                'docker',
                'exec',
                context.recreatedId,
                'stat',
                '-c',
                '%s',
                context.accessLogPath,
            ])
            .catch(() => '-1')
        const accessLogMode = await context
            .command([
                'docker',
                'exec',
                context.recreatedId,
                'stat',
                '-c',
                '%a:%u:%g',
                context.accessLogPath,
            ])
            .catch(() => 'unknown')
        const accessLogReadable = !(await context.commandFails([
            'docker',
            'exec',
            '--user',
            '10003:10003',
            context.recreatedId,
            'test',
            '-r',
            context.accessLogPath,
        ]))
        console.error(
            'Managed CrowdSec acquisition probe: ' +
                JSON.stringify({
                    ...acquisitionProbe,
                    accessLogBytes: Number(accessLogBytes),
                    accessLogMode,
                    accessLogReadable,
                }),
        )
        throw error
    }
    const bouncerKeyDigest = await context.command([
        'docker',
        'exec',
        context.recreatedId,
        'sha256sum',
        '/var/lib/rentnerproxy/crowdsec/bouncer/caddy-bouncer-key',
    ])
    for (const protocol of ['--http1.1', '--http2', '--http3-only'] as const) {
        const response = await requestPublishedProtocol(protocol, 200)
        assert.ok(response.output.includes(context.trafficMarker))
    }
    context.passed(
        'managed CrowdSec runs unprivileged, acquires Caddy logs, stays private, and allows HTTP/1.1, HTTP/2, and HTTP/3',
    )

    await context.command([
        'docker',
        'exec',
        context.recreatedId,
        'gosu',
        'crowdsec',
        'cscli',
        '-c',
        '/usr/share/rentnerproxy/crowdsec/config.yaml',
        'decisions',
        'add',
        '--range',
        '0.0.0.0/0',
        '--duration',
        '5m',
        '--reason',
        'rentnerproxy-appliance-smoke',
    ])
    await context.waitFor(
        async () => (await internalHttpStatus()) === 403,
        'managed CrowdSec decision propagation',
    )
    for (const protocol of ['--http1.1', '--http2', '--http3-only'] as const) {
        await requestPublishedProtocol(protocol, 403)
    }
    assert.notEqual(await internalHttpStatus('/.well-known/acme-challenge/not-present'), 403)

    const forceHttpsConfig = {
        ...context.realConfig,
        proxyHosts: context.realConfig.proxyHosts.map((host) => ({ ...host, forceHttps: true })),
    }
    await context.applyRealConfiguration(
        forceHttpsConfig,
        'CrowdSec with Force HTTPS configuration',
    )
    assert.equal(await internalHttpStatus(), 403)
    await context.command([
        'docker',
        'exec',
        context.recreatedId,
        'gosu',
        'crowdsec',
        'cscli',
        '-c',
        '/usr/share/rentnerproxy/crowdsec/config.yaml',
        'decisions',
        'delete',
        '--all',
    ])
    await context.waitFor(
        async () => (await internalHttpStatus()) === 308,
        'Force HTTPS after CrowdSec decision removal',
    )
    await context.applyRealConfiguration(context.realConfig, 'restore non-redirecting real traffic')
    await context.waitFor(
        async () => (await internalHttpStatus()) === 200,
        'managed CrowdSec allow',
    )
    context.passed(
        'real managed decisions deny every HTTP protocol before Force HTTPS while ACME remains reachable',
    )

    await context.command([
        'docker',
        'exec',
        context.recreatedId,
        'sh',
        '-c',
        'for status_file in /proc/[0-9]*/status; do if grep -q "^Name:[[:space:]]*crowdsec$" "$status_file"; then pid=${status_file#/proc/}; pid=${pid%/status}; kill -TERM "$pid"; fi; done',
    ])
    await context.waitFor(async () => {
        const status = JSON.parse(
            await context.command([
                'docker',
                'exec',
                context.recreatedId,
                'cat',
                '/run/rentnerproxy/crowdsec/status.json',
            ]),
        ) as { state?: string; restarts?: number }
        return status.state !== 'ready' || (status.restarts ?? 0) > 0
    }, 'managed CrowdSec restart state')
    assert.equal(await internalHttpStatus(), 200)
    await context.waitForCrowdSec(
        context.recreatedId,
        (status) =>
            status.mode === 'managed' &&
            status.state === 'connected' &&
            status.managedEngine === 'ready',
        'managed CrowdSec recovery',
    )
    const recoveredSupervisor = JSON.parse(
        await context.command([
            'docker',
            'exec',
            context.recreatedId,
            'cat',
            '/run/rentnerproxy/crowdsec/status.json',
        ]),
    ) as { restarts?: number }
    assert.ok((recoveredSupervisor.restarts ?? 0) >= 1)
    assert.equal(
        await context.command([
            'docker',
            'exec',
            context.recreatedId,
            'sha256sum',
            '/var/lib/rentnerproxy/crowdsec/bouncer/caddy-bouncer-key',
        ]),
        bouncerKeyDigest,
    )
    context.passed('managed LAPI failure stays fail-open and the supervised engine recovers')

    await context.applyCrowdSecMode(context.recreatedId, 'disabled')
    assert.deepEqual(await context.crowdSecEngineUids(context.recreatedId), [])
    await context.command([
        'docker',
        'exec',
        context.recreatedId,
        'test',
        '-s',
        '/var/lib/rentnerproxy/crowdsec/data/crowdsec.db',
    ])
    assert.equal(
        await context.command([
            'docker',
            'exec',
            context.recreatedId,
            'sha256sum',
            '/var/lib/rentnerproxy/crowdsec/bouncer/caddy-bouncer-key',
        ]),
        bouncerKeyDigest,
    )
    await context.applyCrowdSecMode(context.recreatedId, 'managed')
    const reactivatedKeyDigest = await context.command([
        'docker',
        'exec',
        context.recreatedId,
        'sha256sum',
        '/var/lib/rentnerproxy/crowdsec/bouncer/caddy-bouncer-key',
    ])
    assert.notEqual(reactivatedKeyDigest, bouncerKeyDigest)
    context.passed('mode switches retain managed state and rotate the internal bouncer credential')

    const transientCacheKey = 'rentnerproxy:appliance-smoke:' + context.runId
    assert.equal(
        await context.valkeyCommand(context.recreatedId, ['SET', transientCacheKey, context.runId]),
        'OK',
    )
    await context.command([...context.compose, 'restart', 'rentnerproxy'])
    await context.waitForHealthy(context.recreatedId)
    assert.equal(await context.valkeyCommand(context.recreatedId, ['GET', transientCacheKey]), '')
    context.passed('appliance restart discards transient Valkey state')
    await context.waitForCrowdSec(
        context.recreatedId,
        (status) =>
            status.mode === 'managed' &&
            status.state === 'connected' &&
            status.managedEngine === 'ready',
        'managed CrowdSec after appliance restart',
    )
    assert.notEqual(
        await context.command([
            'docker',
            'exec',
            context.recreatedId,
            'sha256sum',
            '/var/lib/rentnerproxy/crowdsec/bouncer/caddy-bouncer-key',
        ]),
        reactivatedKeyDigest,
    )
    await context.assertRealTraffic(
        context.recreatedId,
        'real HTTP and HTTPS traffic survives appliance restart',
    )
    await context.assertPublishedQuic()
    context.passed('verified HTTP/3 survives production appliance restart')
    return {}
}
