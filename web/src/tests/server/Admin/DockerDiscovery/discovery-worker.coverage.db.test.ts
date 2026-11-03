import { afterAll, afterEach, beforeAll, beforeEach, expect, jest, mock, spyOn } from 'bun:test'
import { eq, inArray } from 'drizzle-orm'
import { proxyHosts, systemSettings } from '@/db/schema.ts'
import {
    discoveryCandidate,
    discoveryRegistry,
    discoverySnapshot,
} from '@/tests/Helpers/discoveryFixture.ts'
import { dockerDiscoveryController } from '@/server/Controller/docker-discovery.server.ts'
import * as runtime from '@/server/ProxyRuntime/proxy-runtime.service.ts'
import {
    lockProxyRuntimeSettings,
    PROXY_RUNTIME_SETTINGS_KEY,
} from '@/server/ProxyRuntime/proxy-runtime-settings.ts'
import {
    readDiscoveryRegistry,
    writeDiscoveryRegistry,
} from '@/server/Admin/DockerDiscovery/discovery-storage.server.ts'
import { discoveryEndpointHash } from '@/server/Admin/DockerDiscovery/discovery-plan.ts'
import {
    createDiscoveryWorker,
    dockerDiscoveryWorker,
} from '@/server/Admin/DockerDiscovery/discovery-worker.ts'
import {
    backendCoverageEnabled,
    cleanupBackendCoverage,
    createBackendActor,
    database,
    initializeBackendRegistry,
    integrationTest,
} from '@/tests/Helpers/backendCoverageFixture.ts'
const registryKey = 'docker_discovery_management_v1'
const savedSettings: (typeof systemSettings.$inferSelect)[] = []
const ownedHosts: string[] = []
beforeAll(async () => {
    if (backendCoverageEnabled) await initializeBackendRegistry()
})
beforeEach(async () => {
    if (backendCoverageEnabled)
        savedSettings.push(
            ...(await database
                .select()
                .from(systemSettings)
                .where(inArray(systemSettings.key, [registryKey, PROXY_RUNTIME_SETTINGS_KEY]))),
        )
})
afterEach(async () => {
    jest.useRealTimers()
    mock.restore()
    if (!backendCoverageEnabled) return
    if (ownedHosts.length)
        await database.delete(proxyHosts).where(inArray(proxyHosts.id, ownedHosts.splice(0)))
    await database
        .delete(systemSettings)
        .where(inArray(systemSettings.key, [registryKey, PROXY_RUNTIME_SETTINGS_KEY]))
    if (savedSettings.length) await database.insert(systemSettings).values(savedSettings.splice(0))
    await cleanupBackendCoverage()
})
afterAll(async () => {
    await dockerDiscoveryWorker.stop()
})
async function registry() {
    return database.transaction(readDiscoveryRegistry)
}
async function configure(
    actorUserId: string,
    overrides: Partial<ReturnType<typeof discoveryRegistry>> = {},
) {
    await database.transaction(async (transaction) => {
        await lockProxyRuntimeSettings(transaction)
        await writeDiscoveryRegistry(
            transaction,
            discoveryRegistry({
                enabled: true,
                actorUserId,
                connectorRevision: 1,
                endpointHash: discoveryEndpointHash('http://docker-proxy:2375'),
                ...overrides,
            }),
        )
    })
}

integrationTest(
    'discovery worker remains dormant when disabled and reconciles a real managed host exactly once',
    async () => {
        const actor = await createBackendActor()
        const status = spyOn(dockerDiscoveryController, 'status').mockResolvedValue(
            discoverySnapshot([discoveryCandidate({ domains: [`worker-${actor}.example.com`] })]),
        )
        const reconcile = spyOn(runtime, 'reconcileProxyConfigurationService').mockResolvedValue(
            'applied',
        )
        await configure(actor, { enabled: false })
        await dockerDiscoveryWorker.trigger()
        expect(status).not.toHaveBeenCalled()
        await configure(actor)
        await dockerDiscoveryWorker.trigger()
        const managed = await registry()
        ownedHosts.push(...managed.owners.map((owner) => owner.hostId))
        expect(managed.owners).toHaveLength(1)
        expect(managed.runtimeStatus).toBe('applied')
        expect(managed.error).toBeNull()
        const host = await database
            .select()
            .from(proxyHosts)
            .where(eq(proxyHosts.id, managed.owners[0]!.hostId))
        expect(host).toMatchObject([
            { forwardHost: '172.22.0.5', forwardPort: 8080, enabled: true },
        ])
        expect(reconcile).toHaveBeenCalledTimes(1)
        await dockerDiscoveryWorker.trigger()
        expect((await registry()).owners).toHaveLength(1)
        expect(reconcile).toHaveBeenCalledTimes(1)
    },
)

integrationTest(
    'discovery failures persist one outage transition and recover without exposing provider error details',
    async () => {
        const actor = await createBackendActor()
        await configure(actor)
        const warning = spyOn(console, 'warn').mockImplementation(() => undefined)
        const status = spyOn(dockerDiscoveryController, 'status').mockRejectedValue(
            new Error('private controller transport detail'),
        )
        await dockerDiscoveryWorker.trigger()
        const failed = await registry()
        expect(failed.error).toBe('reconcile_failed')
        await dockerDiscoveryWorker.trigger()
        expect((await registry()).revision).toBe(failed.revision)
        expect(warning).toHaveBeenCalledTimes(1)
        expect(JSON.stringify(warning.mock.calls)).not.toContain('private')
        status.mockResolvedValue(discoverySnapshot([]))
        await dockerDiscoveryWorker.trigger()
        expect((await registry()).error).toBeNull()
    },
)

integrationTest(
    'pending discovery reconciliation cannot overwrite a newer registry revision',
    async () => {
        const actor = await createBackendActor()
        await configure(actor, { runtimeStatus: 'pending' })
        spyOn(dockerDiscoveryController, 'status').mockResolvedValue(discoverySnapshot([]))
        const originalReconciler = runtime.reconcileProxyConfigurationService
        const reconcile = spyOn(runtime, 'reconcileProxyConfigurationService').mockImplementation(
            Object.assign(
                async (): Promise<'applied'> => {
                    await database.transaction(async (transaction) => {
                        await lockProxyRuntimeSettings(transaction)
                        const current = await readDiscoveryRegistry(transaction)
                        current.revision += 1
                        current.enabled = false
                        await writeDiscoveryRegistry(transaction, current)
                    })
                    return 'applied'
                },
                {
                    start: originalReconciler.start,
                    stop: originalReconciler.stop,
                    checkDrift: originalReconciler.checkDrift,
                },
            ),
        )
        await dockerDiscoveryWorker.trigger()
        const latest = await registry()
        expect(latest.enabled).toBe(false)
        expect(latest.runtimeStatus).toBe('pending')
        expect(reconcile).toHaveBeenCalledTimes(1)
    },
)

integrationTest(
    'discovery start installs one interval and stop prevents all later work',
    async () => {
        jest.useFakeTimers()
        const step = mock(async () => undefined)
        const worker = createDiscoveryWorker(step, 2000)
        try {
            worker.start()
            worker.start()
            await Promise.resolve()
            await Promise.resolve()
            await Promise.resolve()
            expect(step).toHaveBeenCalledTimes(1)
            jest.advanceTimersByTime(2000)
            await Promise.resolve()
            await Promise.resolve()
            await Promise.resolve()
            expect(step).toHaveBeenCalledTimes(2)
            await worker.stop()
            jest.advanceTimersByTime(6000)
            await worker.trigger()
            expect(step).toHaveBeenCalledTimes(2)
            worker.start()
            expect(step).toHaveBeenCalledTimes(2)
        } finally {
            await worker.stop()
            jest.useRealTimers()
        }
    },
)
