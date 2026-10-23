// oxlint-disable no-await-in-loop -- Appliance fixtures deliberately sequence offline state replacement and runtime assertions.
import assert from 'node:assert/strict'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { discoveryRegistrySchema } from '../../../../web/src/lib/DockerDiscovery/management.ts'
import {
    discoveryEndpointHash,
    discoverySourceKey,
} from '../../../../web/src/server/Admin/DockerDiscovery/discovery-plan.ts'
import { hostTagStateSchema } from '../../../../web/src/lib/HostTags/hostTags.ts'
import {
    createNotificationState,
    observeNotificationSignals,
} from '../../../../web/src/server/Notifications/incident-engine.ts'
import { notificationStateSchema } from '../../../../web/src/server/Notifications/notification-state.validation.ts'
import { storedNotificationConfigurationSchema } from '../../../../web/src/server/Notifications/notification-settings.validation.ts'
import {
    parseWebhookDestination,
    isWebhookAddressAllowed,
} from '../../../../web/src/server/Notifications/webhook-policy.ts'
import { postgresShutdownScript } from '../../../../scripts/backup/postgres-shutdown.ts'
import { psql, shellQuote, sqlQuote } from './appliance-storage.ts'
import { sqlJson } from './persistence/storage.ts'
import type { ApplianceCommand } from './Types/appliance-storage.types.ts'
import type { StoredNotificationConfiguration } from '../../../../web/src/server/Notifications/Types/notification-internal.types.ts'

const notificationKey = 'notification_configuration_v1'
const runtimeKey = 'notification_delivery_state_v1'
const discoveryKey = 'docker_discovery_management_v1'
const tagsKey = 'host_tags_proxy_v1'
const root = '/var/lib/rentnerproxy/proxy/'

function seal(key: string, plaintext: string, context: string) {
    const nonce = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'base64'), nonce)
    cipher.setAAD(Buffer.from(context))
    return {
        nonce,
        ciphertext: Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]),
    }
}
function open(key: string, nonce: Uint8Array, ciphertext: Uint8Array, context: string) {
    const bytes = Buffer.from(ciphertext)
    const cipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'base64'), nonce)
    cipher.setAAD(Buffer.from(context))
    cipher.setAuthTag(bytes.subarray(-16))
    return Buffer.concat([cipher.update(bytes.subarray(0, -16)), cipher.final()]).toString('utf8')
}

const setting = (key: string, value: unknown) =>
    `INSERT INTO rentnerproxy.system_settings (key,value) VALUES (${sqlQuote(key)},${sqlJson(value)}) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value;`
async function settings(command: ApplianceCommand, id: string) {
    const output = await psql(
        command,
        id,
        `SELECT json_object_agg(key,value) FROM rentnerproxy.system_settings WHERE key IN (${[notificationKey, runtimeKey, discoveryKey, tagsKey].map(sqlQuote).join(',')});`,
    )
    // psql renders a SQL NULL aggregate as an empty field, rather than JSON's null literal.
    return (output === '' ? {} : (JSON.parse(output) ?? {})) as Record<string, unknown>
}
async function offlineSql(command: ApplianceCommand, compose: string[], statement: string) {
    const script = [
        'set -Eeuo pipefail',
        postgresShutdownScript(),
        'install -d -m 0700 -o postgres -g postgres /var/run/postgresql',
        'gosu postgres postgres -D /var/lib/rentnerproxy/postgres-data -c listen_addresses= -c unix_socket_directories=/var/run/postgresql >&2 & postgres_pid=$!',
        'trap stop_postgres EXIT',
        'ready=false; for attempt in $(seq 1 60); do if gosu postgres pg_isready --host=/var/run/postgresql --username=postgres >/dev/null 2>&1; then ready=true; break; fi; kill -0 "$postgres_pid" 2>/dev/null || exit 1; sleep 0.1; done; "$ready"',
        'gosu postgres psql --no-psqlrc --no-password --quiet --set=ON_ERROR_STOP=1 --host=/var/run/postgresql --username=rentnerproxy --dbname=rentnerproxy --command=' +
            shellQuote(statement),
    ].join('\n')
    await command([
        ...compose,
        'run',
        '--rm',
        '--no-deps',
        '--entrypoint=bash',
        'rentnerproxy',
        '-c',
        script,
    ])
}

export function createBeta2AutomationFixture(runId: string) {
    assert.match(runId, /^[a-z0-9-]{6,64}$/u)
    const hostId = Bun.randomUUIDv7(),
        tagId = Bun.randomUUIDv7(),
        channelId = Bun.randomUUIDv7()
    const connectionId = Bun.randomUUIDv7(),
        targetId = Bun.randomUUIDv7()
    const zoneId = 'c'.repeat(32),
        domain = 'automation-' + runId + '.test'
    const sourceId = 'label:beta2-' + runId
    const token = 'synthetic-beta2-webhook-' + runId
    const dnsToken = 'synthetic-beta2-dns-' + runId
    let generation = 0,
        dockerRequests = 0
    const deliveries: { id: string; authorization: string | null }[] = []
    const streams = new Set<ReadableStreamDefaultController<Uint8Array>>()
    const containerId = () =>
        createHash('sha256')
            .update(runId + ':' + generation)
            .digest('hex')
    const labels = {
        'rentnerproxy.enable': 'true',
        'rentnerproxy.id': 'beta2-' + runId,
        'rentnerproxy.domains': domain,
        'rentnerproxy.port': '18087',
        'rentnerproxy.network': 'fixture',
    }
    const server = Bun.serve({
        hostname: '0.0.0.0',
        port: 0,
        maxRequestBodySize: 16_384,
        async fetch(request) {
            const url = new URL(request.url)
            const path = url.pathname
            if (path === '/notifications' && request.method === 'POST') {
                const payload = (await request.json()) as { id: string }
                deliveries.push({
                    id: payload.id,
                    authorization: request.headers.get('authorization'),
                })
                return new Response(null, { status: 204 })
            }
            dockerRequests += 1
            if (request.method !== 'GET') return new Response(null, { status: 405 })
            if (path === '/v1.47/containers/json') {
                if (
                    url.searchParams.size !== 2 ||
                    url.searchParams.get('all') !== '1' ||
                    url.searchParams.get('filters') !== '{"label":["rentnerproxy.enable=true"]}'
                )
                    return new Response(null, { status: 400 })
                return Response.json([{ Id: containerId(), Labels: labels }])
            }
            if (path === '/v1.47/containers/' + containerId() + '/json') {
                if (url.searchParams.size !== 0) return new Response(null, { status: 400 })
                return Response.json({
                    Id: containerId(),
                    Name: '/beta2-' + runId,
                    Config: {
                        Labels: { ...labels, 'rentnerproxy.port': String(18087 + generation) },
                    },
                    State: { Running: true, Paused: false, Restarting: false },
                    HostConfig: { NetworkMode: 'fixture' },
                    NetworkSettings: {
                        Networks: {
                            fixture: { IPAddress: '172.30.255.42', GlobalIPv6Address: '' },
                        },
                    },
                })
            }
            if (path === '/v1.47/events') {
                const since = url.searchParams.get('since') ?? ''
                const timestamp = Number(since)
                const now = Math.floor(Date.now() / 1_000)
                if (
                    url.searchParams.size !== 2 ||
                    !/^\d{1,12}$/u.test(since) ||
                    !Number.isSafeInteger(timestamp) ||
                    timestamp < now - 60 ||
                    timestamp > now + 5 ||
                    url.searchParams.get('filters') !==
                        '{"type":["container","network"],"event":["create","start","stop","die","destroy","rename","update","pause","unpause","connect","disconnect"]}'
                )
                    return new Response(null, { status: 400 })
                let current: ReadableStreamDefaultController<Uint8Array>
                const stream = new ReadableStream<Uint8Array>({
                    start(controller) {
                        current = controller
                        streams.add(controller)
                        controller.enqueue(new TextEncoder().encode('\n'))
                    },
                    cancel() {
                        streams.delete(current)
                    },
                })
                return new Response(stream, { headers: { 'content-type': 'application/json' } })
            }
            return new Response(null, { status: 404 })
        },
    })
    const endpoint = `http://host.docker.internal:${server.port}`
    let configuration: StoredNotificationConfiguration
    let armedDeliveryId = ''
    let actorId = '',
        applicationKey = '',
        originalDeliveryId = ''
    let tagState: ReturnType<typeof hostTagStateSchema.parse>
    let registry: ReturnType<typeof discoveryRegistrySchema.parse>
    const files: Record<string, unknown> = {}

    function queue(engineConfiguration: StoredNotificationConfiguration, future: boolean) {
        const now = Date.now()
        const engine = observeNotificationSignals(
            createNotificationState(),
            engineConfiguration,
            [
                {
                    category: 'ddns',
                    resourceId: targetId,
                    health: 'failing',
                    severity: 'error',
                    occurredAt: new Date(now).toISOString(),
                    evidence: 'synthetic-' + Bun.randomUUIDv7(),
                    failures: 1,
                    source: 'snapshot',
                },
            ],
            now,
            () => Bun.randomUUIDv7(),
        )
        assert.equal(engine.deliveries.length, 1)
        if (future) engine.deliveries[0]!.nextAttemptAt = now + 60 * 60_000
        notificationStateSchema.parse(engine)
        return { version: 1, engine, certificateCursor: null, collectionLease: null }
    }
    return {
        hostId,
        receiverPort: server.port,
        domain,
        originalDeliveryId: () => originalDeliveryId,
        counters: () => ({ dockerRequests, deliveries: deliveries.map(({ id }) => id) }),
        stop() {
            for (const stream of streams) {
                try {
                    stream.close()
                } catch {
                    /* The request may have closed during cleanup. */
                }
            }
            streams.clear()
            server.stop(true)
        },
        async seedDatabase(command: ApplianceCommand, id: string, ownerId: string, key: string) {
            actorId = ownerId
            applicationKey = key
            const addresses = JSON.parse(
                await command([
                    'docker',
                    'exec',
                    id,
                    'bun',
                    '-e',
                    "process.stdout.write(JSON.stringify(await (await import('node:dns/promises')).lookup('host.docker.internal',{all:true})))",
                ]),
            ) as { address: string; family: number }[]
            assert.ok(addresses.length > 0)
            const destination = {
                kind: 'webhook' as const,
                url: endpoint + '/notifications',
                authorizationToken: token,
                allowedPrivateCidrs: addresses.map(
                    ({ address, family }) => address + (family === 6 ? '/128' : '/32'),
                ),
            }
            parseWebhookDestination(destination as Parameters<typeof parseWebhookDestination>[0])
            assert.ok(
                addresses.every(({ address }) => isWebhookAddressAllowed(address, destination)),
            )
            const sealed = seal(
                key,
                JSON.stringify(destination),
                'rentnerproxy:notifications:v1:' + channelId,
            )
            configuration = storedNotificationConfigurationSchema.parse({
                version: 1,
                revision: 1,
                enabled: true,
                pausedAfterRestore: false,
                channels: [
                    {
                        id: channelId,
                        name: 'Synthetic Beta 2 receiver',
                        kind: 'webhook',
                        enabled: true,
                        events: ['ddns'],
                        minimumSeverity: 'warning',
                        thresholdSeconds: 0,
                        recovery: true,
                        revision: 1,
                        hasAuthorization: true,
                        destination: {
                            iv: sealed.nonce.toString('base64url'),
                            ciphertext: sealed.ciphertext.toString('base64url'),
                        },
                    },
                ],
            })
            const runtime = queue(configuration, true)
            originalDeliveryId = runtime.engine.deliveries[0]!.id
            const previous = await settings(command, id)
            const tags = previous[tagsKey]
                ? hostTagStateSchema.parse(previous[tagsKey])
                : { version: 1 as const, revision: 0, tags: [], assignments: {} }
            tagState = hostTagStateSchema.parse({
                ...tags,
                revision: tags.revision + 1,
                tags: [...tags.tags, { id: tagId, name: 'Beta 2 automation', color: '#14b8a6' }],
                assignments: { ...tags.assignments, [hostId]: [tagId] },
            })
            registry = discoveryRegistrySchema.parse({
                version: 1,
                revision: 1,
                enabled: true,
                actorUserId: ownerId,
                connectorRevision: 1,
                endpointHash: discoveryEndpointHash(endpoint),
                runtimeStatus: 'applied',
                error: null,
                owners: [
                    {
                        key: discoverySourceKey(endpoint, sourceId),
                        sourceId,
                        hostId,
                        containerId: containerId(),
                        domains: [domain],
                        state: 'managed',
                        error: null,
                    },
                ],
                results: [],
            })
            await psql(
                command,
                id,
                `BEGIN; INSERT INTO rentnerproxy.proxy_hosts(id,forward_scheme,forward_host,forward_port,enabled,force_https,verify_upstream_tls) VALUES (${sqlQuote(hostId)},'http','172.30.255.42',18087,false,false,true); INSERT INTO rentnerproxy.host_domains(proxy_host_id,domain) VALUES (${sqlQuote(hostId)},${sqlQuote(domain)}); ${setting(tagsKey, tagState)} ${setting(discoveryKey, registry)} ${setting(notificationKey, configuration)} ${setting(runtimeKey, runtime)} COMMIT;`,
            )
            const dns = seal(key, dnsToken, 'dns-connection:' + connectionId + ':v1')
            const now = new Date().toISOString()
            files['dns-connections.json'] = {
                version: 1,
                connections: [
                    {
                        metadata: {
                            id: connectionId,
                            provider: 'cloudflare',
                            ownership: 'instance',
                            name: 'Beta 2 preserved DNS',
                            createdByUserId: ownerId,
                            revision: 1,
                            zones: [{ id: zoneId, name: 'beta2.example.com' }],
                            references: [{ zoneId, consumer: { type: 'ddns', id: targetId } }],
                            createdAt: now,
                            updatedAt: now,
                        },
                        secret: {
                            version: 1,
                            nonce: [...dns.nonce],
                            ciphertext: [...dns.ciphertext],
                        },
                    },
                ],
            }
            files['docker-discovery.json'] = {
                version: 1,
                revision: 1,
                settings: { enabled: true, endpoint },
            }
            files['ddns-automation.json'] = {
                version: 1,
                configuration: {
                    revision: 1,
                    updatedByUserId: ownerId,
                    settings: {
                        enabled: true,
                        intervalSeconds: 300,
                        updateOnStart: true,
                        ipv4: true,
                        ipv6: false,
                        targets: [
                            {
                                id: targetId,
                                connectionId,
                                zoneId,
                                name: 'appliance.beta2.example.com',
                                recordType: 'A',
                                proxied: false,
                                enabled: true,
                                selection: { mode: 'create' },
                            },
                        ],
                    },
                },
                targets: [
                    {
                        targetId,
                        lastAttemptAt: null,
                        lastSuccessAt: null,
                        lastSuccessfulAddress: null,
                        lastSuccessfulProxied: null,
                        lastResult: null,
                        consecutiveFailures: 0,
                        permanentFailure: false,
                        connectionRevision: 1,
                        nextAttemptAt: Math.floor(Date.now() / 1_000) - 1,
                        retryNotBefore: null,
                    },
                ],
                inFlight: null,
                lastRun: null,
                providerNotBefore: null,
                providerPauseReason: null,
                manualNotBefore: null,
                restorePaused: false,
                events: [],
                eventSequence: 0,
            }
        },
        async seedStoppedController(command: ApplianceCommand, compose: string[]) {
            const script = `const files=${JSON.stringify(files)}; for(const name of ['ddns-restore-paused','docker-discovery-restore-paused']){if(await Bun.file(${JSON.stringify(root)}+name).exists())throw new Error('Source automation was already restore-paused');} for(const [name,value] of Object.entries(files)){await Bun.write(${JSON.stringify(root)}+name,JSON.stringify(value));await (await import('node:fs/promises')).chmod(${JSON.stringify(root)}+name,0o600);}`
            await command([
                ...compose,
                'run',
                '--rm',
                '--no-deps',
                '--user=10001:10001',
                '--entrypoint=bun',
                'rentnerproxy',
                '-e',
                script,
            ])
        },
        async pauseStoppedSource(command: ApplianceCommand, compose: string[]) {
            // The completed archive retains enabled and due DDNS; only the live source gets this fence.
            const script = `const path=${JSON.stringify(root + 'ddns-restore-paused')};await Bun.write(path,'Synthetic source pause after completed backup');await (await import('node:fs/promises')).chmod(path,0o600);`
            await command([
                ...compose,
                'run',
                '--rm',
                '--no-deps',
                '--user=10001:10001',
                '--entrypoint=bun',
                'rentnerproxy',
                '-e',
                script,
            ])
        },
        async assertRestored(
            command: ApplianceCommand,
            id: string,
            controllerCall: (
                id: string,
                path: string,
                method: string,
                body?: unknown,
            ) => Promise<{ status: number; body: string }>,
        ) {
            const state = await settings(command, id)
            const saved = storedNotificationConfigurationSchema.parse(state[notificationKey])
            assert.equal(saved.revision, configuration.revision + 1)
            assert.equal(saved.enabled, false)
            assert.equal(saved.pausedAfterRestore, true)
            assert.deepEqual(saved.channels, configuration.channels)
            assert.equal(state[runtimeKey], undefined)
            assert.ok(
                !deliveries.some(
                    (item) => item.id === originalDeliveryId || item.id === armedDeliveryId,
                ),
                'a pre-restore notification was replayed',
            )
            assert.deepEqual(discoveryRegistrySchema.parse(state[discoveryKey]), registry)
            assert.deepEqual(hostTagStateSchema.parse(state[tagsKey]), tagState)
            const channel = saved.channels[0]!
            assert.equal(
                JSON.parse(
                    open(
                        applicationKey,
                        Buffer.from(channel.destination.iv, 'base64url'),
                        Buffer.from(channel.destination.ciphertext, 'base64url'),
                        'rentnerproxy:notifications:v1:' + channelId,
                    ),
                ).authorizationToken,
                token,
            )
            for (const name of Object.keys(files)) {
                const value = JSON.parse(
                    await command(['docker', 'exec', '--user=10001:10001', id, 'cat', root + name]),
                )
                if (name === 'dns-connections.json') {
                    const secret = value.connections[0].secret
                    assert.deepEqual(value, files[name])
                    assert.equal(
                        open(
                            applicationKey,
                            Uint8Array.from(secret.nonce),
                            Uint8Array.from(secret.ciphertext),
                            'dns-connection:' + connectionId + ':v1',
                        ),
                        dnsToken,
                    )
                } else if (name === 'docker-discovery.json') assert.deepEqual(value, files[name])
                else {
                    assert.equal(value.restorePaused, true)
                    const original = files[name] as {
                        configuration: { revision: number; settings: Record<string, unknown> }
                        targets: Record<string, unknown>[]
                    }
                    assert.deepEqual(value.configuration, {
                        ...original.configuration,
                        revision: original.configuration.revision + 1,
                        settings: { ...original.configuration.settings, enabled: false },
                    })
                    assert.deepEqual(
                        value.targets,
                        original.targets.map((target) =>
                            Object.assign({}, target, { nextAttemptAt: null }),
                        ),
                    )
                    assert.equal(value.inFlight, null)
                    assert.equal(value.lastRun, null)
                    assert.equal(value.events.at(-1)?.outcome, 'restore_paused')
                }
            }
            const ddns = await controllerCall(id, '/internal/v1/ddns/status', 'GET')
            assert.equal(ddns.status, 200)
            const ddnsStatus = JSON.parse(ddns.body)
            assert.equal(ddnsStatus.restorePaused, true)
            assert.equal(ddnsStatus.configuration.settings.enabled, false)
            assert.equal(ddnsStatus.configuration.revision, 2)
            const discovery = await controllerCall(
                id,
                '/internal/v1/discovery/docker/status',
                'GET',
            )
            assert.equal(discovery.status, 200)
            assert.equal(JSON.parse(discovery.body).status, 'paused')
            assert.equal(
                Number(
                    await psql(
                        command,
                        id,
                        `SELECT forward_port FROM rentnerproxy.proxy_hosts WHERE id=${sqlQuote(hostId)};`,
                    ),
                ),
                18087,
            )
        },
        async armStoppedTarget(
            command: ApplianceCommand,
            id: string,
            compose: string[],
            controllerCall: (
                id: string,
                path: string,
                method: string,
                body?: unknown,
            ) => Promise<{ status: number; body: string }>,
        ) {
            const activation = await controllerCall(
                id,
                '/internal/v1/discovery/docker/config',
                'PUT',
                {
                    expectedRevision: 1,
                    actorUserId: actorId,
                    configuration: { enabled: true, endpoint },
                    acknowledgeRestore: true,
                },
            )
            assert.equal(activation.status, 200)
            const connectorRevision = JSON.parse(activation.body).configuration.revision
            await command([...compose, 'stop', '--timeout', '30', 'rentnerproxy'], 180_000)
            generation += 1
            const runtime = queue(configuration, false)
            armedDeliveryId = runtime.engine.deliveries[0]!.id
            await offlineSql(
                command,
                compose,
                setting(notificationKey, configuration) +
                    setting(runtimeKey, runtime) +
                    setting(discoveryKey, { ...registry, connectorRevision }),
            )
        },
        async resumeAndVerify(
            command: ApplianceCommand,
            id: string,
            controllerCall: (
                id: string,
                path: string,
                method: string,
                body?: unknown,
            ) => Promise<{ status: number; body: string }>,
            waitFor: (
                probe: () => Promise<boolean>,
                label: string,
                timeoutMs?: number,
            ) => Promise<void>,
        ) {
            const current = await settings(command, id)
            const saved = storedNotificationConfigurationSchema.parse(current[notificationKey])
            const resumed = {
                ...saved,
                enabled: true,
                pausedAfterRestore: false,
                revision: saved.revision + 1,
            }
            const runtime = queue(resumed, false),
                newId = runtime.engine.deliveries[0]!.id
            assert.notEqual(newId, originalDeliveryId)
            await psql(
                command,
                id,
                setting(notificationKey, resumed) + setting(runtimeKey, runtime),
            )
            await waitFor(
                async () => {
                    if (!deliveries.some((item) => item.id === newId)) return false
                    const state = await settings(command, id)
                    const stored = state[runtimeKey] as {
                        engine: { deliveries: { id: string; status: string }[] }
                    }
                    return stored.engine.deliveries.some(
                        (item) => item.id === newId && item.status === 'succeeded',
                    )
                },
                'new notification after explicit restore activation',
                45_000,
            )
            assert.ok(
                !deliveries.some(
                    (item) => item.id === originalDeliveryId || item.id === armedDeliveryId,
                ),
            )
            assert.equal(deliveries.filter((item) => item.id === newId).length, 1)
            assert.ok(deliveries.every((item) => item.authorization === 'Bearer ' + token))
            generation += 1
            const snapshot = await controllerCall(id, '/internal/v1/discovery/docker/status', 'GET')
            const revision = JSON.parse(snapshot.body).configuration.revision
            const result = await controllerCall(id, '/internal/v1/discovery/docker/config', 'PUT', {
                expectedRevision: revision,
                actorUserId: actorId,
                configuration: { enabled: true, endpoint },
                acknowledgeRestore: true,
            })
            assert.equal(result.status, 200)
            const connector = JSON.parse(result.body).configuration ?? JSON.parse(result.body)
            await psql(
                command,
                id,
                setting(discoveryKey, {
                    ...registry,
                    revision: registry.revision + 1,
                    connectorRevision: connector.revision,
                }),
            )
            await waitFor(
                async () => {
                    const state = await settings(command, id)
                    const currentRegistry = discoveryRegistrySchema.parse(state[discoveryKey])
                    if (
                        currentRegistry.runtimeStatus !== 'applied' ||
                        currentRegistry.owners.find((item) => item.hostId === hostId)
                            ?.containerId !== containerId()
                    )
                        return false
                    return (
                        Number(
                            await psql(
                                command,
                                id,
                                `SELECT forward_port FROM rentnerproxy.proxy_hosts WHERE id=${sqlQuote(hostId)};`,
                            ),
                        ) ===
                        18087 + generation
                    )
                },
                'discovery resumes and updates the same owned host',
                45_000,
            )
            const after = await settings(command, id)
            assert.deepEqual(hostTagStateSchema.parse(after[tagsKey]), tagState)
            const owner = discoveryRegistrySchema
                .parse(after[discoveryKey])
                .owners.find((item) => item.hostId === hostId)
            assert.equal(owner?.containerId, containerId())
            assert.equal(owner?.key, registry.owners[0]!.key)
        },
    }
}
