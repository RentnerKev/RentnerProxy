// oxlint-disable no-await-in-loop -- Each phase asserts the state committed by the preceding real operation.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { drainConcurrent, runBoundedTasks } from '../../../../scripts/runtime-scale/control.ts'
import { waitForSmoke } from '../../../../scripts/smoke/wait.ts'
import { verifyConcurrentTraffic } from '../../../../scripts/runtime-scale/traffic.ts'
import type { ScaleResult } from '../../../../scripts/runtime-scale/Types/control.types.ts'
import type { DdnsDraft } from '../../../../web/src/lib/Ddns/Types/ddns.types.ts'
import type { UpdateNotificationConfigurationInput } from '../../../../web/src/lib/Notifications/Types/validation.types.ts'
import {
    getDdnsStatusService,
    applyDdnsService,
    previewDdnsService,
    syncDdnsService,
} from '../../../../web/src/server/Admin/Ddns/ddns.service.ts'
import {
    saveDnsConnectionService,
    getDnsConnectionsService,
} from '../../../../web/src/server/Admin/DnsConnections/dns-connections.service.ts'
import {
    getDiscoveryOverviewService,
    connectDiscoveryService,
    changeDiscoveryService,
} from '../../../../web/src/server/Admin/DockerDiscovery/discovery-management.service.ts'
import { dockerDiscoveryWorker } from '../../../../web/src/server/Admin/DockerDiscovery/discovery-worker.ts'
import { readDiscoveryRegistry } from '../../../../web/src/server/Admin/DockerDiscovery/discovery-storage.server.ts'
import {
    createProxyHostService,
    updateProxyHostService,
    getProxyHostsService,
} from '../../../../web/src/server/Admin/ProxyHostManagement/proxy-hosts.service.ts'
import { bulkHostServices } from '../../../../web/src/server/Admin/HostBulkActions/bulk-hosts.storage.server.ts'
import {
    getHostTagCatalogService,
    mutateHostTagService,
} from '../../../../web/src/server/Admin/HostTags/host-tags.service.ts'
import {
    getNotificationConfigurationService,
    getNotificationStatusService,
    updateNotificationConfigurationService,
} from '../../../../web/src/server/Admin/Notifications/notifications.service.ts'
import { notificationWorker } from '../../../../web/src/server/Notifications/notification-worker.server.ts'
import { openNotificationDestination } from '../../../../web/src/server/Notifications/notification-settings.ts'
import { getProxyRuntimeStatus } from '../../../../web/src/server/Controller/proxy.server.ts'
import { readNotificationConfiguration } from '../../../../web/src/server/Notifications/notification-storage.ts'
import {
    getProxyRuntimeSnapshotService,
    reconcileProxyConfigurationService,
} from '../../../../web/src/server/ProxyRuntime/proxy-runtime.service.ts'
import { waitForBeta2 } from './wait.ts'
import type { Beta2JourneyInput } from './Types/journeys.types.ts'

const backendSchema = z.object({ backend: z.enum(['a', 'b', 'tls']) })

async function synchronized() {
    assert.equal(await reconcileProxyConfigurationService(), 'applied')
    const snapshot = await getProxyRuntimeSnapshotService()
    const status = await getProxyRuntimeStatus()
    assert.ok(status?.running)
    assert.equal(
        status.activeRevision,
        snapshot.revision,
        'real controller applied the exact DB snapshot',
    )
    return snapshot.revision
}

async function notify() {
    await notificationWorker.runOnce()
    await notificationWorker.runOnce()
}

export async function runBeta2Journeys(input: Beta2JourneyInput) {
    const { context, receivers, httpPort, stateDirectory, restartController } = input
    const { authorized, database } = context
    const checks: string[] = []
    const passed = (label: string) => {
        checks.push(label)
        console.log('PASS Beta 2: ' + label)
    }
    const hosts = () => authorized(getProxyHostsService)
    const ddns = () => authorized(getDdnsStatusService)
    const discovery = () => authorized(getDiscoveryOverviewService)
    async function http(domain = 'h0.beta2.test') {
        const response = await fetch(`http://127.0.0.1:${httpPort}/`, {
            headers: { host: domain },
            signal: AbortSignal.timeout(8_000),
            redirect: 'manual',
        })
        const body: { backend?: 'a' | 'b' | 'tls' } =
            response.status === 200 ? backendSchema.parse(await response.json()) : {}
        return { status: response.status, body, headers: response.headers }
    }
    async function traffic(trafficRoutes: ScaleResult['traffic']) {
        await verifyConcurrentTraffic(
            {
                http,
                recordTrafficFailure: (index, status) =>
                    console.error('Beta 2 traffic failure', {
                        domain: index === null ? null : trafficRoutes[index]?.domain,
                        status,
                    }),
            },
            trafficRoutes,
            4,
        )
    }
    async function fresh() {
        const [dns, docker, notification] = await Promise.all([
            ddns(),
            discovery(),
            authorized(getNotificationConfigurationService),
        ])
        assert.equal(dns.configuration, null)
        assert.equal(docker.management.enabled, false)
        assert.equal(docker.snapshot?.configuration.settings.enabled, false)
        assert.equal(notification.enabled, false)
        await notificationWorker.runOnce()
        await dockerDiscoveryWorker.trigger()
        assert.deepEqual(
            receivers.counters,
            {
                ipv4Reads: 0,
                ipv6Reads: 0,
                providerReads: 0,
                providerWrites: 0,
                dockerReads: 0,
                webhooks: 0,
                smtpMessages: 0,
                unexpectedRequests: 0,
                deniedMutations: 0,
            },
            'fresh disabled workers make no provider, Docker or receiver calls',
        )
    }

    await fresh()
    await restartController()
    await fresh()
    passed('fresh install and restart keep external automation off, with zero receiver calls')

    const connection = await authorized(() =>
        saveDnsConnectionService({
            expectedRevision: 0,
            name: 'Standalone DDNS replacement',
            apiToken: 'beta2-fixture-provider-token',
            zoneIds: ['a'.repeat(32)],
        }),
    )
    const targetId = Bun.randomUUIDv7()
    const draft: DdnsDraft = {
        intervalSeconds: 86_400,
        updateOnStart: false,
        ipv4: true,
        ipv6: false,
        targets: [
            {
                id: targetId,
                connectionId: connection.id,
                zoneId: 'a'.repeat(32),
                name: 'app.beta2.test',
                recordType: 'A',
                proxied: false,
                enabled: true,
                selection: { mode: 'inspect' },
            },
        ],
    }
    const saved = await authorized(() =>
        applyDdnsService({ expectedRevision: 0, draft, enabled: false }),
    )
    assert.ok(saved.configuration)
    const preview = await authorized(() =>
        previewDdnsService({
            expectedRevision: saved.configuration!.revision,
            draft,
            intent: 'enable',
        }),
    )
    assert.equal(preview.batch.targets[0]?.status, 'adoption_required')
    assert.equal(receivers.counters.providerWrites, 0, 'saving and inspecting never mutate DNS')
    const enabled = await authorized(() =>
        applyDdnsService({
            expectedRevision: saved.configuration!.revision,
            draft,
            enabled: true,
        }),
    )
    assert.equal(enabled.configuration?.settings.targets[0]?.selection.mode, 'adopt')
    assert.ok(enabled.configuration)
    await authorized(() => syncDdnsService({ expectedRevision: enabled.configuration!.revision }))
    await waitForBeta2(
        async () => (await ddns()).targets[0]?.lastSuccessfulAddress === '8.8.4.4',
        'DDNS adopts the standalone record',
    )
    assert.equal(receivers.counters.providerWrites, 1, 'exactly one adopted record updated')
    assert.equal(receivers.counters.ipv6Reads, 0, 'disabled family never queried')
    const providerRecords = await fetch(
        receivers.providerUrl +
            'zones/' +
            'a'.repeat(32) +
            '/dns_records?name=app.beta2.test&per_page=100&page=1',
        {
            headers: { authorization: 'Bearer beta2-fixture-provider-token' },
        },
    ).then((response) => response.json())
    const records = z
        .object({
            result: z.array(
                z.object({
                    id: z.string(),
                    content: z.string(),
                    ttl: z.number(),
                    comment: z.string(),
                    tags: z.array(z.string()),
                }),
            ),
        })
        .parse(providerRecords).result
    assert.equal(records.length, 1)
    assert.equal(records[0]?.id, 'b'.repeat(32))
    assert.equal(records[0]?.content, '8.8.4.4')
    assert.equal(records[0]?.ttl, 300)
    assert.ok(
        records[0]?.comment && records[0].tags.length > 0,
        'unrelated provider metadata retained',
    )
    const connections = await authorized(getDnsConnectionsService)
    assert.ok(
        connections[0]?.references.some(
            (reference) => reference.consumer.type === 'ddns' && reference.consumer.id === targetId,
        ),
    )
    assert.ok(
        !(await readFile(join(stateDirectory, 'dns-connections.json'), 'utf8')).includes(
            'beta2-fixture-provider-token',
        ),
        'saved provider credential is encrypted',
    )
    passed(
        'Web management replaces standalone DDNS through DB audit, real controller and counted provider writes',
    )

    await authorized(() =>
        connectDiscoveryService({
            expectedRevision: 0,
            connectorRevision: 0,
            endpoint: receivers.url,
            acknowledgeRestore: false,
        }),
    )
    await waitForBeta2(
        async () => (await discovery()).snapshot?.status === 'ready',
        'Docker inventory ready',
    )
    assert.ok(
        !(await hosts()).some((host) => host.domains.includes('discovered.beta2.test')),
        'connecting alone does not adopt a host',
    )
    const reviewed = await discovery()
    await authorized(() =>
        changeDiscoveryService({
            action: 'enable',
            expectedRevision: reviewed.management.revision,
            previewToken: reviewed.previewToken,
        }),
    )
    dockerDiscoveryWorker.start()
    await waitForBeta2(
        async () => (await hosts()).some((host) => host.domains.includes('discovered.beta2.test')),
        'reviewed Docker host persisted',
    )
    const discovered = (await hosts()).find((host) =>
        host.domains.includes('discovered.beta2.test'),
    )
    assert.ok(discovered)
    const discoveredId = discovered.id
    const catalog = await authorized(() => getHostTagCatalogService('proxy'))
    const tags = await authorized(() =>
        mutateHostTagService({
            kind: 'proxy',
            action: 'create',
            expectedRevision: catalog.revision,
            name: 'Beta 2 retained',
        }),
    )
    const tagId = tags.tags[0]?.id
    assert.ok(tagId)
    await authorized(() =>
        mutateHostTagService({
            kind: 'proxy',
            action: 'assign',
            expectedRevision: tags.revision,
            hostId: discovered.id,
            expectedTagIds: [],
            tagIds: [tagId],
        }),
    )
    await synchronized()
    assert.equal((await http('discovered.beta2.test')).body.backend, 'a')
    const beforeDockerOutage = (await getProxyRuntimeSnapshotService()).revision
    receivers.setDockerUnavailable(true)
    await waitForBeta2(
        async () => (await discovery()).snapshot?.status === 'unavailable',
        'Docker outage reported',
    )
    await dockerDiscoveryWorker.trigger()
    assert.equal(
        (await getProxyRuntimeSnapshotService()).revision,
        beforeDockerOutage,
        'stale Docker inventory cannot replace valid desired state',
    )
    assert.equal(
        (await http('discovered.beta2.test')).body.backend,
        'a',
        'Docker outage preserves last good proxy traffic',
    )
    receivers.setDockerUnavailable(false)
    await waitForBeta2(
        async () => (await discovery()).snapshot?.status === 'ready',
        'Docker connector recovers with bounded backoff',
    )
    passed('Docker outage preserves the last valid host and traffic, then recovers automatically')

    assert.ok(receivers.smtpPort, 'controlled SMTP receiver is required')
    const channels: UpdateNotificationConfigurationInput['channels'] = [
        {
            id: crypto.randomUUID(),
            name: 'Counted webhook',
            kind: 'webhook' as const,
            enabled: true,
            events: ['ddns'],
            minimumSeverity: 'warning' as const,
            thresholdSeconds: 0,
            recovery: true,
            destination: {
                kind: 'webhook' as const,
                url: receivers.url + '/webhook',
                authorizationToken: 'beta2-fixture-webhook-token',
                allowedPrivateCidrs: ['127.0.0.1/32'],
            },
        },
        {
            id: crypto.randomUUID(),
            name: 'Counted SMTP',
            kind: 'email' as const,
            enabled: true,
            events: ['ddns'],
            minimumSeverity: 'warning' as const,
            thresholdSeconds: 0,
            recovery: true,
            destination: { kind: 'email' as const, recipients: ['fixture@beta2.invalid'] },
        },
    ]
    await authorized(() =>
        updateNotificationConfigurationService({ expectedRevision: 0, enabled: true, channels }),
    )
    const stored = await database.transaction(readNotificationConfiguration)
    assert.ok(!JSON.stringify(stored).includes('beta2-fixture-webhook-token'))
    assert.equal((await openNotificationDestination(stored.channels[0]!)).kind, 'webhook')

    async function admission() {
        await waitForBeta2(
            async () => {
                const snapshot = await ddns()
                const now = Math.floor(Date.now() / 1000)
                return (
                    !snapshot.inFlight &&
                    Math.max(
                        snapshot.manualNotBefore ?? 0,
                        snapshot.providerNotBefore ?? 0,
                        ...snapshot.targets.map((target) => target.retryNotBefore ?? 0),
                    ) <= now
                )
            },
            'bounded DDNS retry admission',
            45_000,
        )
    }
    await admission()
    receivers.setProviderUnavailable(true)
    const failure = await authorized(async () =>
        syncDdnsService({ expectedRevision: (await ddns()).configuration!.revision }),
    )
    assert.equal(failure.targets[0]?.error, 'provider_unavailable')
    receivers.setWebhookUnavailable(true)
    await notificationWorker.runOnce()
    await notificationWorker.runOnce()
    const queued = await authorized(getNotificationStatusService)
    assert.equal(receivers.counters.webhooks, 1, 'one controlled failing webhook attempt')
    assert.equal(receivers.counters.smtpMessages, 1, 'real STARTTLS email received')
    assert.ok(
        queued.deliveries.some(
            (delivery) => delivery.status === 'pending' && delivery.attempts === 1,
        ),
        'failed delivery is durably pending',
    )
    await notificationWorker.runOnce()
    assert.equal(receivers.counters.webhooks, 1, 'retry deadline prevents a hot resend loop')
    receivers.setProviderUnavailable(false)
    receivers.setWebhookUnavailable(false)
    passed(
        'provider outage creates real encrypted-channel deliveries, bounded webhook retry and verified STARTTLS mail',
    )

    await runBoundedTasks(
        Array.from({ length: 100 }, (_, index) => index),
        4,
        async (index) =>
            authorized(() =>
                createProxyHostService({
                    domains: [`h${index}.beta2.test`],
                    enabled: true,
                    forwardScheme: 'http',
                    forwardHost: receivers.dockerAddress,
                    forwardPort: receivers.primaryPort,
                }),
            ),
    )
    const scaleHosts = (await hosts()).filter((host) =>
        host.domains.some((domain) => /^h\d+\.beta2\.test$/u.test(domain)),
    )
    assert.equal(scaleHosts.length, 100)
    const routes: ScaleResult['traffic'] = scaleHosts.map((host) => ({
        domain: host.domains[0]!,
        status: 200,
        backend: 'a',
    }))
    await synchronized()
    async function settledTraffic(round?: number) {
        const currentHosts = new Map((await hosts()).map((host) => [host.id, host]))
        await runBoundedTasks(scaleHosts, 4, async (host, index) => {
            const expected = round === undefined || index < 8 || round % 2 ? 'a' : 'b'
            const current = currentHosts.get(host.id)
            assert.ok(current?.enabled, 'each workload host remains enabled')
            assert.equal(
                current.forwardPort,
                expected === 'a' ? receivers.primaryPort : receivers.secondaryPort,
            )
            const response = await http(host.domains[0]!)
            assert.equal(response.status, 200, 'every settled route must exist')
            assert.equal(
                response.body.backend,
                expected,
                'every settled route reaches its exact expected upstream',
            )
        })
    }
    await settledTraffic()

    async function bulk(enabledHosts: boolean) {
        const action = { type: enabledHosts ? ('enable' as const) : ('disable' as const) }
        const selected = scaleHosts.slice(0, 8)
        const result = await authorized(() =>
            bulkHostServices.preview({
                kind: 'proxy',
                action,
                hostIds: selected.map((host) => host.id),
            }),
        )
        assert.ok(result.rows.every((row) => row.status === 'ready' && row.version))
        const applied = await authorized(() =>
            bulkHostServices.apply({
                kind: 'proxy',
                action,
                hosts: result.rows.map((row) => ({ id: row.id, version: row.version! })),
            }),
        )
        assert.ok(applied.rows.every((row) => row.status === 'applied'))
    }
    async function recreate() {
        const before = (await database.transaction(readDiscoveryRegistry)).owners.find(
            (owner) => owner.hostId === discoveredId,
        )
        assert.ok(before)
        receivers.recreateContainer()
        await waitForBeta2(async () => {
            await dockerDiscoveryWorker.trigger()
            const registry = await database.transaction(readDiscoveryRegistry)
            return registry.owners.some(
                (owner) =>
                    owner.hostId === discoveredId &&
                    owner.containerId !== before.containerId &&
                    owner.state === 'managed',
            )
        }, 'container recreate retains the managed host identity')
        const host = (await hosts()).find((entry) => entry.id === discoveredId)
        assert.ok(host)
        assert.ok(
            host.tags?.some((tag) => tag.id === tagId),
            'recreate retains assigned tags',
        )
        assert.equal(
            (await hosts()).filter((entry) => entry.domains.includes('discovered.beta2.test'))
                .length,
            1,
            'recreate never duplicates a host',
        )
        await waitForBeta2(async () => {
            const response = await http('discovered.beta2.test')
            return (
                response.status === 200 &&
                response.body.backend === (host.forwardPort === receivers.primaryPort ? 'a' : 'b')
            )
        }, 'automatic event-driven recreate reaches the new real upstream')
    }
    await input.withPausedDdnsScheduler(async () => {
        for (let round = 0; round < 3; round += 1) {
            await admission()
            receivers.setAddress(`8.8.4.${5 + round}`)
            const before = { ...receivers.counters }
            const progress = { done: false }
            let samples = 0
            const actions = Promise.allSettled([
                (async () => {
                    await bulk(false)
                    await bulk(true)
                })(),
                authorized(async () =>
                    syncDdnsService({ expectedRevision: (await ddns()).configuration!.revision }),
                ),
                recreate(),
                notify(),
                runBoundedTasks(scaleHosts.slice(8), 4, async (host) =>
                    authorized(() =>
                        updateProxyHostService({
                            proxyHostId: host.id,
                            domains: host.domains,
                            enabled: true,
                            forwardScheme: 'http',
                            forwardHost: receivers.dockerAddress,
                            forwardPort:
                                round % 2 ? receivers.primaryPort : receivers.secondaryPort,
                        }),
                    ),
                ),
            ]).finally(() => {
                progress.done = true
            })
            const trafficRun = (async () => {
                while (!progress.done || samples < 3) {
                    await traffic(routes)
                    samples += 1
                    await new Promise((resolve) => setTimeout(resolve, 5))
                }
            })()
            const [operations] = await drainConcurrent([actions, trafficRun] as const)
            for (const result of operations) {
                if (result.status === 'rejected') throw result.reason
            }
            await notify()
            assert.ok(
                receivers.counters.providerWrites > before.providerWrites,
                'round performs a real DDNS write',
            )
            assert.ok(
                receivers.counters.dockerReads > before.dockerReads,
                'round uses the real Docker connector',
            )
            assert.equal((await ddns()).targets[0]?.lastSuccessfulAddress, `8.8.4.${5 + round}`)
            await synchronized()
            await settledTraffic(round)
            passed(
                `100-host concurrent round ${round + 1}: DDNS, Docker recreate, bulk, notifications and strict traffic`,
            )
        }
    })
    let delivered = await authorized(getNotificationStatusService)
    const deliveryDiagnostic = () =>
        JSON.stringify({
            pendingCount: delivered.pendingCount,
            deliveries: delivered.deliveries.map((delivery) => ({
                kind:
                    channels.find((channel) => channel.id === delivery.channelId)?.kind ??
                    'unknown',
                type: delivery.type,
                status: delivery.status,
                code: delivery.error,
                attempts: delivery.attempts,
            })),
        })
    const assertNoTerminalFailure = () =>
        assert.ok(
            delivered.deliveries.every(
                (delivery) => delivery.status !== 'failed' && delivery.status !== 'cancelled',
            ),
            'notification delivery terminated before recovery completed; ' + deliveryDiagnostic(),
        )
    // Ticks collect and deliver concurrently; a completed tick does not prove that
    // every newly admitted delivery ran or that a durable retry deadline elapsed.
    // Poll the real worker without changing attempts, leases or retry deadlines.
    await waitForSmoke(
        async () => {
            assertNoTerminalFailure()
            await notify()
            delivered = await authorized(getNotificationStatusService)
            assertNoTerminalFailure()
            return delivered.pendingCount === 0 && delivered.deliveries.length >= 4
        },
        {
            timeoutMs: 90_000,
            intervalMs: 1_000,
            probeFirst: true,
            retryOnError: () => false,
            timeoutError: () =>
                new Error('notification queue did not drain; ' + deliveryDiagnostic()),
        },
    )
    assert.equal(
        delivered.deliveries.length,
        4,
        'one incident and recovery per channel; ' + deliveryDiagnostic(),
    )
    const incidents = delivered.incidents.filter(
        (incident) => incident.category === 'ddns' && incident.resourceId === targetId,
    )
    assert.equal(incidents.length, 1, 'one DDNS outage incident; ' + deliveryDiagnostic())
    const incident = incidents[0]!
    assert.notEqual(incident.recoveredAt, null, 'DDNS incident recovered')
    for (const channel of channels) {
        assert.ok(
            delivered.deliveries
                .filter((delivery) => delivery.channelId === channel.id)
                .every(
                    (delivery) =>
                        delivery.incidentId === incident.id &&
                        delivery.category === 'ddns' &&
                        delivery.resourceId === targetId,
                ),
            'both channel deliveries belong to the same DDNS incident; ' + deliveryDiagnostic(),
        )
        assert.deepEqual(
            delivered.deliveries
                .filter((delivery) => delivery.channelId === channel.id)
                .map((delivery) => delivery.type)
                .toSorted(),
            ['incident', 'recovery'],
            'each configured channel receives incident and recovery; ' + deliveryDiagnostic(),
        )
    }
    assert.equal(
        receivers.counters.webhooks,
        3,
        'failed webhook retry and recovery reach the controlled receiver; ' + deliveryDiagnostic(),
    )
    assert.equal(
        receivers.counters.smtpMessages,
        2,
        'incident and recovery each sent once by verified SMTP; ' + deliveryDiagnostic(),
    )
    assert.ok(
        delivered.deliveries.every((delivery) => delivery.status === 'succeeded'),
        'notification queue fully drains after recovery; ' + deliveryDiagnostic(),
    )
    const previousIds = (await hosts()).map((host) => host.id).toSorted()
    const beforeRestart = { ...receivers.counters }
    await restartController()
    await synchronized()
    assert.deepEqual((await hosts()).map((host) => host.id).toSorted(), previousIds)
    assert.equal(
        receivers.counters.providerWrites,
        beforeRestart.providerWrites,
        'restart does not replay a successful DNS mutation',
    )
    await notify()
    assert.equal(
        receivers.counters.smtpMessages,
        beforeRestart.smtpMessages,
        'restart does not duplicate mail',
    )
    assert.equal(
        receivers.counters.webhooks,
        beforeRestart.webhooks,
        'restart does not duplicate webhooks',
    )
    await settledTraffic(2)
    assert.equal(receivers.counters.unexpectedRequests, 0)
    assert.equal(receivers.counters.deniedMutations, 0)
    passed(
        'controller restart preserves all 100 exact routes, host identity and DNS state without duplicate deliveries',
    )
    return { checks, counters: { ...receivers.counters } }
}
