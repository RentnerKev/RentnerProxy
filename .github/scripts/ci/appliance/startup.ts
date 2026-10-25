// oxlint-disable no-await-in-loop -- Bounded smoke scenarios preserve their sequential polling.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { buildHttp3Client } from '../../../../scripts/smoke/http3/client.ts'
import { sharedSmokeImage, verifySharedSmokeImage } from '../../../../scripts/smoke/images.ts'
import type { ApplianceStartupContext } from './Types/scenarios.types.ts'

export async function verifyApplianceStartup(context: ApplianceStartupContext) {
    await buildHttp3Client(context.http3Command, context.http3Image)
    if (sharedSmokeImage('appliance'))
        await verifySharedSmokeImage(context.http3Command, 'appliance')
    else
        await context.command(
            [
                'docker',
                'build',
                '--tag',
                context.imageTag,
                '--file',
                context.productionDockerfile,
                '.',
            ],
            900_000,
        )
    const rendered = JSON.parse(
        await context.command([...context.compose, 'config', '--format', 'json']),
    ) as {
        services: Record<
            string,
            {
                environment?: Record<string, string | null>
                image?: string
                ports?: Array<{ published: string; target: number; protocol: string }>
                volumes?: Array<{ source?: string; target: string }>
            }
        >
        volumes?: Record<string, unknown>
    }
    assert.deepEqual(Object.keys(rendered.services), ['rentnerproxy'])
    const service = rendered.services.rentnerproxy
    assert.ok(service)
    assert.equal(service.image, context.imageTag)
    assert.deepEqual(
        Object.keys(service.environment ?? {}).toSorted(),
        [
            ...context.smtpNames,
            'PROXY_TRUSTED_PROXY_CIDRS',
            'RENTNERPROXY_PROXY_PUBLIC_HTTPS_PORT',
            'PUBLIC_ORIGIN',
            'RENTNERPROXY_PROXY_TRUSTED_PROXY_CIDRS',
            'RENTNERPROXY_PUBLIC_ORIGIN',
        ].toSorted(),
    )
    assert.equal(service.environment?.PROXY_TRUSTED_PROXY_CIDRS, context.trustedProxyCidrs)
    assert.equal(service.environment?.PUBLIC_ORIGIN, context.publicOrigin)
    assert.equal(service.environment?.RENTNERPROXY_PROXY_TRUSTED_PROXY_CIDRS, null)
    assert.equal(service.environment?.RENTNERPROXY_PUBLIC_ORIGIN, null)
    assert.deepEqual(
        (service.ports ?? []).map(({ published, target, protocol }) => ({
            published,
            target,
            protocol,
        })),
        [
            { published: String(context.httpPort), target: 8080, protocol: 'tcp' },
            { published: String(context.managementPort), target: 3000, protocol: 'tcp' },
            { published: String(context.httpsPort), target: 8443, protocol: 'tcp' },
            { published: String(context.httpsPort), target: 8443, protocol: 'udp' },
        ],
    )
    assert.deepEqual(
        Object.keys(rendered.volumes ?? {}).toSorted(),
        [context.volumeName, context.inheritedVolumeName].toSorted(),
    )
    assert.deepEqual(
        (service.volumes ?? [])
            .map(({ source, target }) => ({ source, target }))
            .toSorted((a, b) => a.target.localeCompare(b.target)),
        [
            { source: context.inheritedVolumeName, target: '/var/lib/postgresql' },
            { source: context.volumeName, target: '/var/lib/rentnerproxy' },
        ],
    )
    context.passed('appliance Compose keeps private management and persistent storage')

    await context.commandFails(
        [...context.compose, 'down', '--volumes', '--remove-orphans'],
        180_000,
    )
    await context.command([...context.compose, 'up', '--detach'], 900_000)
    const id = await context.containerId(context.compose)
    await context.waitForHealthy(id)
    const mounts = JSON.parse(await context.inspect(id, '{{json .Mounts}}')) as Array<{
        Type: string
        Name: string
        Destination: string
    }>
    assert.deepEqual(
        mounts
            .map(({ Type, Name, Destination }) => ({ Type, Name, Destination }))
            .toSorted((a, b) => a.Destination.localeCompare(b.Destination)),
        [
            {
                Type: 'volume',
                Name: context.project + '_' + context.inheritedVolumeName,
                Destination: '/var/lib/postgresql',
            },
            {
                Type: 'volume',
                Name: context.project + '_' + context.volumeName,
                Destination: '/var/lib/rentnerproxy',
            },
        ],
        'every appliance volume must belong to this smoke; anonymous volumes cannot be recovered by run label',
    )
    context.passed('empty appliance volume builds and starts healthy')
    assert.match(
        await context.command([
            'docker',
            'exec',
            id,
            '/opt/rentnerproxy/valkey/bin/valkey-server',
            '--version',
        ]),
        /Valkey server v=9\.1\.2/u,
    )
    assert.equal(await context.valkeyCommand(id, ['PING']), 'PONG')
    assert.equal(await context.valkeyCommand(id, ['CONFIG', 'GET', 'bind']), 'bind\n127.0.0.1')
    assert.equal(await context.valkeyCommand(id, ['CONFIG', 'GET', 'appendonly']), 'appendonly\nno')
    assert.equal(await context.valkeyCommand(id, ['CONFIG', 'GET', 'save']), 'save')
    for (const [source, target] of [
        ['Valkey-LICENSE', 'LICENSE'],
        ['Valkey-NOTICE', 'NOTICE'],
    ] as const) {
        const targetPath = '/usr/share/licenses/valkey/' + target
        assert.equal(
            await context.command(['docker', 'exec', id, 'sha256sum', targetPath]),
            context.digest(
                await readFile(join(context.repositoryRoot, 'docker', 'licenses', source)),
            ) +
                '  ' +
                targetPath,
        )
    }
    context.passed('pinned Valkey runs on loopback without persistence and retains its licenses')
    const initialCrowdSecStatus = context.parseCrowdSecStatus(
        await context.controllerCall(id, '/internal/v1/crowdsec/status', 'GET'),
    )
    assert.deepEqual(initialCrowdSecStatus, {
        mode: 'disabled',
        state: 'disabled',
        credentialConfigured: false,
        enforcementActive: false,
        managedEngine: 'stopped',
        communityEnabled: false,
        communityState: 'disabled',
        consoleState: 'not_enrolled',
        failureBehavior: 'fail_open',
        clientIpSource: 'caddy',
    })
    const syntheticEnrollmentKey = 'a'.repeat(16)
    const disabledEnrollment = await context.controllerCall(
        id,
        '/internal/v1/crowdsec/console/enroll',
        'POST',
        { enrollmentKey: syntheticEnrollmentKey },
    )
    assert.equal(disabledEnrollment.status, 422)
    assert.ok(!disabledEnrollment.body.includes(syntheticEnrollmentKey))
    assert.equal(
        await context.command([
            'docker',
            'exec',
            id,
            'cat',
            '/run/rentnerproxy/crowdsec/desired-mode',
        ]),
        'stopped',
    )
    assert.deepEqual(await context.crowdSecEngineUids(id), [])
    const initialProcNet = await context.command([
        'docker',
        'exec',
        id,
        'sh',
        '-c',
        'cat /proc/net/tcp /proc/net/tcp6',
    ])
    assert.deepEqual(context.listenerAddresses(initialProcNet, 18080), [])
    assert.deepEqual(context.listenerAddresses(initialProcNet, 6060), [])
    context.passed('CrowdSec defaults to disabled without starting its managed engine or LAPI')

    const caddyModules = (
        await context.command(['docker', 'exec', id, '/usr/bin/caddy', 'list-modules'])
    )
        .split(/\r?\n/u)
        .filter(
            (module) =>
                module === 'crowdsec' ||
                module === 'admin.api.crowdsec' ||
                module === 'http.handlers.crowdsec',
        )
        .toSorted()
    assert.deepEqual(caddyModules, ['admin.api.crowdsec', 'crowdsec', 'http.handlers.crowdsec'])
    // Upstream ships optional registrations; verify they are not activated.
    const caddyConfig = JSON.parse(
        await context.command([
            'docker',
            'exec',
            id,
            'curl',
            '--silent',
            '--fail',
            '--unix-socket',
            '/var/lib/rentnerproxy/proxy/caddy-admin.sock',
            'http://localhost/config/',
        ]),
    ) as { apps?: { layer4?: unknown; http?: unknown } }
    assert.equal(caddyConfig.apps?.layer4, undefined)
    assert.doesNotMatch(
        JSON.stringify(caddyConfig.apps?.http ?? {}),
        /"(?:handler|wrapper)":"(?:appsec|layer4)"/u,
    )
    assert.match(
        await context.command(['docker', 'exec', id, '/usr/local/bin/crowdsec', '-version']),
        /version: v1\.8\.1-909b5157/u,
    )
    assert.equal(
        await context.command([
            'docker',
            'exec',
            id,
            'sha256sum',
            '/usr/share/licenses/caddy/LICENSE',
        ]),

        context.digest(
            await readFile(join(context.repositoryRoot, 'docker', 'licenses', 'Caddy-LICENSE')),
        ) + '  /usr/share/licenses/caddy/LICENSE',
    )
    assert.equal(
        await context.command([
            'docker',
            'exec',
            id,
            'sha256sum',
            '/usr/share/licenses/crowdsec/LICENSE',
        ]),
        context.digest(
            await readFile(join(context.repositoryRoot, 'docker', 'licenses', 'CrowdSec-LICENSE')),
        ) + '  /usr/share/licenses/crowdsec/LICENSE',
    )
    context.passed(
        'pinned CrowdSec runtime, minimal Caddy modules, and redistributed licenses match',
    )
    const roleState = await context.command([
        'docker',
        'exec',
        id,
        'gosu',
        'postgres',
        'psql',
        '--no-psqlrc',
        '--no-password',
        '--host=/var/run/postgresql',
        '--username=postgres',
        '--dbname=postgres',
        '--tuples-only',
        '--no-align',
        '--command',
        "SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls FROM pg_roles WHERE rolname = 'rentnerproxy'; SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = 'rentnerproxy'; SELECT rolpassword IS NULL FROM pg_authid WHERE rolname = 'postgres';",
    ])
    assert.deepEqual(roleState.split(/\r?\n/u), ['f|f|f|f|f', 'rentnerproxy', 't'])
    assert.equal(
        await context.command(['docker', 'exec', id, 'stat', '-c', '%a:%U', '/var/run/postgresql']),
        '700:postgres',
    )
    assert.ok(
        await context.commandFails([
            'docker',
            'exec',
            '--user',
            '10001:10001',
            id,
            'psql',
            '--no-psqlrc',
            '--no-password',
            '--host=/var/run/postgresql',
            '--username=postgres',
            '--dbname=postgres',
            '--command=SELECT 1',
        ]),
    )
    context.passed(
        'application database role has no administrative privileges and cannot use bootstrap socket',
    )
    assert.equal(
        await context.command([
            'docker',
            'exec',
            id,
            'stat',
            '-c',
            '%a:%U:%G',
            '/run/rentnerproxy/app-key/value',
        ]),
        '400:rentnerproxy-web:rentnerproxy-web',
    )
    assert.equal(
        await context.command([
            'docker',
            'exec',
            id,
            'stat',
            '-c',
            '%a:%U:%G',
            '/run/rentnerproxy/database-url/value',
        ]),
        '400:rentnerproxy-web:rentnerproxy-web',
    )
    assert.equal(
        await context.command([
            'docker',
            'exec',
            id,
            'stat',
            '-c',
            '%a:%U:%G',
            '/run/rentnerproxy/controller-token/value',
        ]),
        '440:rentnerproxy:rentnerproxy-web',
    )
    const controllerAppKey = '/run/rentnerproxy/controller-app-key/value'
    assert.equal(
        await context.command(['docker', 'exec', id, 'stat', '-c', '%a:%U:%G', controllerAppKey]),
        '400:rentnerproxy:rentnerproxy',
    )
    await context.command([
        'docker',
        'exec',
        id,
        'cmp',
        '--silent',
        '/run/rentnerproxy/app-key/value',
        controllerAppKey,
    ])
    await context.command([
        'docker',
        'exec',
        id,
        'gosu',
        'rentnerproxy',
        'test',
        '-r',
        controllerAppKey,
    ])
    assert.ok(
        await context.commandFails([
            'docker',
            'exec',
            id,
            'gosu',
            'rentnerproxy-web',
            'test',
            '-r',
            controllerAppKey,
        ]),
    )
    assert.ok(
        await context.commandFails([
            'docker',
            'exec',
            id,
            'gosu',
            'rentnerproxy',
            'test',
            '-r',
            '/run/rentnerproxy/database-url/value',
        ]),
    )
    context.passed('DNS credential encryption key is provisioned privately to the controller')
    const boundarySecret = '/var/lib/rentnerproxy/proxy/appliance-boundary-secret'
    await context.command([
        'docker',
        'exec',
        '--user',
        '10001:10001',
        id,
        'sh',
        '-c',
        `umask 077; printf boundary-secret > ${boundarySecret}`,
    ])
    assert.ok(
        await context.commandFails([
            'docker',
            'exec',
            id,
            'gosu',
            'rentnerproxy-web',
            'cat',
            boundarySecret,
        ]),
    )
    assert.ok(
        await context.commandFails([
            'docker',
            'exec',
            id,
            'gosu',
            'rentnerproxy-web',
            'curl',
            '--silent',
            '--fail',
            '--unix-socket',
            '/var/lib/rentnerproxy/proxy/caddy-admin.sock',
            'http://localhost/config/',
        ]),
    )
    context.passed(
        'web can read only its input secrets and cannot read proxy state or open Caddy admin',
    )
    return {
        id,
    }
}
