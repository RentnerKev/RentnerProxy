import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import type { DiscoverySmokeDependencies } from './Types/discovery-smoke.types.ts'
import type { DiscoveryRegistry } from '../../../web/src/lib/DockerDiscovery/Types/management.types.ts'
import type { ProxyHostSummary } from '../../../web/src/lib/Admin/ProxyHostManagement/Types/proxy-hosts.types.ts'
import { dockerDiscoverySnapshotSchema } from '../../../web/src/lib/DockerDiscovery/validation.ts'
import { createDiscoveryPlan } from '../../../web/src/server/Admin/DockerDiscovery/discovery-plan.ts'
import { createProxyRuntimeSnapshot } from '../../../web/src/server/ProxyRuntime/proxy-runtime-snapshot.ts'

/** Exercises discovery/recreate plans against the real controller and Caddy on an isolated network. */
export async function runDiscoverySmoke(deps: DiscoverySmokeDependencies): Promise<void> {
    const engine = deps.backend + '-engine'
    const oldBackend = deps.backend + '-old'
    const directory = join(deps.directory, 'discovery')
    const bun =
        'mirror.gcr.io/oven/bun:1.4.3@sha256:ec06c3b6cea04192ae6770c434f668ca41d343ad19fa6472216c7b48be39c598'
    const actorUserId = Bun.randomUUIDv7()
    const registry: DiscoveryRegistry = {
        version: 1,
        revision: 0,
        enabled: false,
        actorUserId: null,
        connectorRevision: null,
        endpointHash: null,
        error: null,
        runtimeStatus: 'idle',
        owners: [],
        results: [],
    }
    let managed: ProxyHostSummary | null = null
    async function exportFixture() {
        const [container] = z
            .array(
                z.object({
                    Id: z.string(),
                    Name: z.string(),
                    State: z.object({
                        Running: z.boolean(),
                        Paused: z.boolean(),
                        Restarting: z.boolean(),
                    }),
                    HostConfig: z.object({ NetworkMode: z.string() }),
                    NetworkSettings: z.object({
                        Networks: z.record(
                            z.string(),
                            z.object({ IPAddress: z.string(), GlobalIPv6Address: z.string() }),
                        ),
                    }),
                }),
            )
            .parse(JSON.parse(await deps.command(['docker', 'inspect', deps.backend])))
        assert.ok(container)
        await Bun.write(
            join(directory, 'containers.json'),
            JSON.stringify([
                {
                    ...container,
                    Config: {
                        Labels: {
                            'rentnerproxy.enable': 'true',
                            'rentnerproxy.domains': 'discovered-upstream.test',
                            'rentnerproxy.id': 'smoke-service',
                            'rentnerproxy.network': deps.network,
                            'rentnerproxy.port': '8080',
                        },
                        ExposedPorts: {},
                    },
                },
            ]),
        )
        return container.Id
    }
    async function status() {
        const { httpStatus, ...value } = await deps.controller(
            '/internal/v1/discovery/docker/status',
        )
        assert.equal(httpStatus, 200)
        return dockerDiscoverySnapshotSchema.parse(value)
    }
    async function applyPlan() {
        const snapshot = await status()
        const current = managed
        const plan = createDiscoveryPlan(snapshot, registry, {
            hosts: current ? [current] : [],
            domains: current
                ? current.domains.map((domain) => ({ domain, proxyHostId: current.id }))
                : [],
        })
        const change = plan.changes[0]
        assert.equal(plan.changes.length, 1)
        assert.ok(change)
        const hostId = managed?.id ?? Bun.randomUUIDv7()
        const host: ProxyHostSummary = {
            ...change.input,
            id: hostId,
            domains: [...change.input.domains],
            accessPolicyId: null,
            certificateId: null,
            forceHttps: false,
            verifyUpstreamTls: true,
            upstreamTlsServerName: null,
            trustedCaId: null,
            createdAt: new Date(),
            updatedAt: new Date(),
        }
        const owner = {
            key: change.key,
            sourceId: change.candidate.sourceId ?? '',
            hostId,
            containerId: change.candidate.containerId,
            domains: [...host.domains],
            state: 'managed' as const,
            error: null,
        }
        registry.owners = [owner]
        managed = host
        const desired = createProxyRuntimeSnapshot([
            {
                id: host.id,
                domains: host.domains,
                enabled: host.enabled,
                forwardHost: host.forwardHost,
                forwardPort: host.forwardPort,
                forwardScheme: host.forwardScheme,
            },
        ])
        const result = await deps.apply(desired)
        assert.equal(result.httpStatus, 200)
        assert.equal(result.activeRevision, desired.revision)
        await deps.waitForBody(
            'discovered-upstream.test',
            200,
            /backend-http-ok/u,
            'discovered HTTP route',
        )
        return { desired, hostId, host, owner, target: change.input.forwardHost }
    }
    try {
        await mkdir(directory, { recursive: true })
        const firstId = await exportFixture()
        await Bun.write(
            join(directory, 'engine.ts'),
            `
            const load = () => Bun.file('/fixture/containers.json').json()
            Bun.serve({ hostname: '0.0.0.0', port: 2375, async fetch(request) {
                const path = new URL(request.url).pathname
                if (request.method !== 'GET') return new Response(null, { status: 403 })
                if (path === '/v1.47/events') {
                    let timer
                    return new Response(new ReadableStream({ start(controller) {
                        controller.enqueue(new TextEncoder().encode('\\n'))
                        timer = setInterval(() => controller.enqueue(new TextEncoder().encode(JSON.stringify({
                            Type: 'container', Action: 'update', Actor: { ID: 'a'.repeat(64) }, timeNano: Date.now() * 1000000,
                        }) + '\\n')), 500)
                    }, cancel() { clearInterval(timer) } }), { headers: { 'content-type': 'application/json' } })
                }
                const containers = await load()
                if (path === '/v1.47/containers/json') return Response.json(containers.map(value => ({ Id: value.Id, Labels: value.Config.Labels })))
                const value = containers.find(value => path === '/v1.47/containers/' + value.Id + '/json')
                return value ? Response.json(value) : new Response(null, { status: 404 })
            } })
        `,
        )
        await deps.command([
            'docker',
            'run',
            '--detach',
            '--name',
            engine,
            '--network',
            deps.network,
            '--mount',
            `type=bind,source=${directory},target=/fixture,readonly`,
            bun,
            'bun',
            '--no-env-file',
            '/fixture/engine.ts',
        ])
        const saved = await deps.controller('/internal/v1/discovery/docker/config', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                actorUserId,
                expectedRevision: 0,
                configuration: { enabled: true, endpoint: `http://${engine}:2375` },
                acknowledgeRestore: false,
            }),
        })
        assert.equal(saved.httpStatus, 200)
        await deps.waitFor(async () => {
            const value = await status()
            return !value.stale && value.candidates[0]?.containerId === firstId
        }, 'initial Docker inventory')
        const initial = await applyPlan()
        await deps.command(['docker', 'rename', deps.backend, oldBackend])
        await deps.startBackend()
        const recreatedId = await exportFixture()
        assert.notEqual(firstId, recreatedId)
        await deps.waitFor(
            async () => (await status()).candidates[0]?.containerId === recreatedId,
            'Docker recreate event',
        )
        const recreated = await applyPlan()
        assert.equal(initial.hostId, recreated.hostId)
        assert.notEqual(
            initial.target,
            recreated.target,
            'the old container reserves its address during recreation',
        )
        const unchanged = await deps.apply(recreated.desired)
        assert.equal(unchanged.status, 'unchanged')
        const inventory = {
            hosts: [recreated.host],
            domains: recreated.host.domains.map((domain) => ({
                domain,
                proxyHostId: recreated.host.id,
            })),
        }
        assert.equal(createDiscoveryPlan(await status(), registry, inventory).changes.length, 0)
        await Bun.write(join(directory, 'containers.json'), '[]')
        await deps.waitFor(
            async () => (await status()).candidates.length === 0,
            'confirmed source removal',
        )
        const orphaned = createDiscoveryPlan(await status(), registry, inventory)
        assert.equal(orphaned.rows[0]?.state, 'orphaned')
        assert.equal(orphaned.changes.length, 0)
        await deps.waitForBody(
            'discovered-upstream.test',
            200,
            /backend-http-ok/u,
            'retained orphaned host',
        )
        await deps.command(['docker', 'stop', engine])
        await deps.waitFor(
            async () => (await status()).status === 'unavailable',
            'Docker endpoint outage',
        )
        assert.equal(createDiscoveryPlan(await status(), registry, inventory).changes.length, 0)
        await deps.waitForBody(
            'discovered-upstream.test',
            200,
            /backend-http-ok/u,
            'retained host during Docker outage',
        )
    } finally {
        await deps.command(['docker', 'rm', '--force', engine, oldBackend]).catch(() => undefined)
    }
}
