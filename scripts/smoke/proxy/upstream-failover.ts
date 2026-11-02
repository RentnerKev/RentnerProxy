// oxlint-disable no-await-in-loop -- Poll real asynchronous health transitions with bounded deadlines.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { ProxyHostUpstreamHealth } from '../../../web/src/lib/ProxyRuntime/Types/upstream-health.types.ts'
import type { UpstreamFailoverSmokeOptions } from './Types/upstream-failover.types.ts'

async function waitFor(check: () => Promise<boolean>, label: string): Promise<void> {
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
        if (await check()) return
        await Bun.sleep(150)
    }
    throw new Error('Timed out waiting for upstream failover smoke: ' + label)
}

export async function runUpstreamFailoverSmoke(
    options: UpstreamFailoverSmokeOptions,
): Promise<void> {
    const domain = 'pool-failover-' + randomUUID() + '.test'
    const states = [
        {
            message: 'failover-primary',
            healthStatus: 200,
            probes: 0,
            requests: 0,
            postBodies: [] as string[],
        },
        {
            message: 'failover-secondary',
            healthStatus: 200,
            probes: 0,
            requests: 0,
            postBodies: [] as string[],
        },
    ]
    const primary = states[0]!
    const secondary = states[1]!
    const startBackend = (state: (typeof states)[number], port = 0) =>
        Bun.serve({
            hostname: '0.0.0.0',
            port,
            async fetch(request) {
                // Closing each connection makes the later dead-primary POST a true
                // pre-connect failure rather than an ambiguous stale keepalive socket.
                const headers = { connection: 'close' }
                if (new URL(request.url).pathname === '/health') {
                    state.probes += 1
                    return new Response(null, { status: state.healthStatus, headers })
                }
                state.requests += 1
                if (request.method === 'POST') state.postBodies.push(await request.text())
                return Response.json({ message: state.message }, { headers })
            },
        })
    let first = startBackend(primary)
    let second: ReturnType<typeof startBackend> | undefined
    let hostId: string | undefined
    let runtimeStopped = false

    try {
        second = startBackend(secondary)
        const members = [
            { host: options.forwardHost, port: first.port! },
            { host: options.forwardHost, port: second.port! },
        ]
        const upstreamPool = {
            policy: 'first' as const,
            members,
            failover: {
                active: {
                    path: '/health',
                    intervalSeconds: 5,
                    timeoutSeconds: 1,
                    fails: 2,
                    passes: 2,
                    expectedStatus: 200,
                },
                passive: { failDurationSeconds: 3, maxFails: 1 },
                retries: { maxRetries: 2, tryDurationSeconds: 3, tryIntervalMilliseconds: 100 },
            },
        }
        const created = await options.createHost({
            domains: [domain],
            enabled: true,
            forwardScheme: 'http',
            forwardHost: options.forwardHost,
            forwardPort: first.port!,
            upstreamPool,
        })
        hostId = created.id
        assert.equal(created.runtimeStatus, 'applied')
        const snapshot = await options.readSnapshot()
        assert.equal(snapshot.version, 9)
        const initialStatus = await options.readRuntimeStatus()
        assert.equal(initialStatus?.activeRevision, snapshot.revision)
        assert.ok(initialStatus?.lastApplyAt)
        assert.deepEqual(
            snapshot.proxyHosts.find((host) => host.id === created.id)?.upstreamPool,
            upstreamPool,
        )

        const readHealth = async (): Promise<ProxyHostUpstreamHealth> => {
            const health = await options.readHealth(created.id)
            assert.equal(health.hostId, created.id)
            assert.deepEqual(
                health.members.map(({ index, host, port }) => ({ index, host, port })),
                members.map((member, index) => ({ index, host: member.host, port: member.port })),
            )
            if (health.state !== 'unknown') {
                assert.equal(health.revision, snapshot.revision)
                assert.ok(health.observedAt)
                assert.ok(Date.now() - Date.parse(health.observedAt) < 30_000)
            }
            return health
        }
        const waitHealth = (expected: readonly string[], state: ProxyHostUpstreamHealth['state']) =>
            waitFor(
                async () => {
                    const health = await readHealth()
                    return (
                        health.state === state &&
                        health.members.every((member, index) => member.state === expected[index])
                    )
                },
                state + ' / ' + expected.join(','),
            )
        const expectMessage = async (message: string): Promise<void> => {
            const response = await options.request(domain)
            assert.equal(response.status, 200)
            assert.equal((await response.json()).message, message)
        }
        const assertNoApply = async (): Promise<void> => {
            assert.equal((await options.readSnapshot()).revision, snapshot.revision)
            const status = await options.readRuntimeStatus()
            assert.equal(status?.activeRevision, snapshot.revision)
            assert.equal(status?.lastApplyAt, initialStatus.lastApplyAt)
        }

        await waitHealth(['available', 'available'], 'available')
        await expectMessage(primary.message)
        const firstFailureProbes = primary.probes
        primary.healthStatus = 503
        await waitHealth(['unavailable', 'available'], 'available')
        assert.ok(
            primary.probes >= firstFailureProbes + 2,
            'two failed active probes precede ejection',
        )
        await expectMessage(secondary.message)
        const recoveryProbes = primary.probes
        primary.healthStatus = 200
        await waitHealth(['available', 'available'], 'available')
        assert.ok(
            primary.probes >= recoveryProbes + 2,
            'two successful active probes precede recovery',
        )
        await expectMessage(primary.message)
        await assertNoApply()
        options.passed(
            'active pool failover and threshold recovery change real routing and authorized health without applying configuration',
        )

        const downProbeCounts = states.map((state) => state.probes)
        primary.healthStatus = 503
        secondary.healthStatus = 503
        await waitHealth(['unavailable', 'unavailable'], 'all_unavailable')
        for (const [index, state] of states.entries())
            assert.ok(state.probes >= downProbeCounts[index]! + 2)
        const requestCounts = states.map((state) => state.requests)
        const started = Date.now()
        const unavailable = await options.request(domain)
        assert.equal(unavailable.status, 503)
        await unavailable.body?.cancel()
        assert.ok(Date.now() - started < 4_000, 'all-down failure honors the finite retry budget')
        assert.deepEqual(
            states.map((state) => state.requests),
            requestCounts,
        )
        primary.healthStatus = 200
        secondary.healthStatus = 200
        await waitHealth(['available', 'available'], 'available')
        await expectMessage(primary.message)
        await assertNoApply()
        options.passed(
            'all-down pool reports all_unavailable, fails with bounded 503, and recovers without reconciliation',
        )

        const secondaryPosts = secondary.postBodies.length
        const primaryPosts = primary.postBodies.length
        const firstPort = first.port!
        await first.stop(true)
        const postBody = 'unsent dial retry ' + randomUUID()
        const post = await options.request(domain, { method: 'POST', body: postBody })
        assert.equal(post.status, 200)
        assert.equal((await post.json()).message, secondary.message)
        assert.equal(primary.postBodies.length, primaryPosts)
        assert.deepEqual(secondary.postBodies.slice(secondaryPosts), [postBody])
        first = startBackend(primary, firstPort)
        await waitHealth(['available', 'available'], 'available')
        await expectMessage(primary.message)
        await assertNoApply()
        options.passed(
            'a pre-connect failed primary delivers the unsent POST body to secondary exactly once',
        )

        const stored = (await options.readHosts()).find((host) => host.id === created.id)
        assert.deepEqual(stored?.upstreamPool, upstreamPool)
        const previous = await readHealth()
        await options.stopRuntime()
        runtimeStopped = true
        const offline = await readHealth()
        assert.equal(offline.state, 'unknown')
        assert.equal(offline.observedAt, null)
        assert.ok(offline.members.every((member) => member.state === 'unknown'))
        const restartedAt = Date.now()
        await options.startRuntime()
        runtimeStopped = false
        await waitFor(async () => {
            const status = await options.readRuntimeStatus()
            return status?.running === true && status.activeRevision === snapshot.revision
        }, 'persisted failover runtime restart')
        await waitHealth(['available', 'available'], 'available')
        const restarted = await readHealth()
        assert.ok(Date.parse(restarted.observedAt!) >= Math.floor(restartedAt / 1_000) * 1_000)
        assert.notEqual(restarted.observedAt, previous.observedAt)
        assert.equal((await options.readSnapshot()).revision, snapshot.revision)
        assert.deepEqual(
            (await options.readSnapshot()).proxyHosts.find((host) => host.id === created.id)
                ?.upstreamPool,
            upstreamPool,
        )
        await expectMessage(primary.message)
        options.passed(
            'failover settings persist across runtime restart; offline health is unknown and restarted observations are fresh',
        )
    } finally {
        // Restore the fixture before deleting its host, even after a failed assertion.
        try {
            if (runtimeStopped) await options.startRuntime()
            if (hostId) await options.deleteHost(hostId)
        } finally {
            await Promise.all([first.stop(true), second?.stop(true)])
        }
    }
}
