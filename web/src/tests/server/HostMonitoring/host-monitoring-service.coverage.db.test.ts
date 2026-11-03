import { randomUUID } from 'node:crypto'
import { afterEach, beforeAll, expect, mock, spyOn } from 'bun:test'
import { eq, inArray } from 'drizzle-orm'
import {
    HOST_MONITORING_DEFAULTS,
    HOST_MONITORING_WRITE_RATE_LIMIT,
} from '@/config/host-monitoring.config.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { hostCheckObservations, hostCheckPolicies, hostDomains, proxyHosts } from '@/db/schema.ts'
import { requirePermissionInTransaction } from '@/server/Auth/Access/rbac.service.ts'
import {
    createHostMonitoringService,
    hostMonitoringService,
} from '@/server/HostMonitoring/host-monitoring.service.ts'
import * as rateLimiter from '@/server/Valkey/rate-limiter.service.ts'
import {
    asBackendActor,
    backendCoverageEnabled,
    cleanupBackendCoverage,
    createBackendActor,
    database,
    initializeBackendRegistry,
    integrationTest,
} from '@/tests/Helpers/backendCoverageFixture.ts'
const ownedHosts: string[] = []
beforeAll(async () => {
    if (backendCoverageEnabled) await initializeBackendRegistry()
})
afterEach(async () => {
    mock.restore()
    if (!backendCoverageEnabled) return
    if (ownedHosts.length)
        await database.delete(proxyHosts).where(inArray(proxyHosts.id, ownedHosts.splice(0)))
    await cleanupBackendCoverage()
})
async function host() {
    const id = randomUUID()
    const domain = `coverage-${id}.example.test`
    await database
        .insert(proxyHosts)
        .values({ id, forwardScheme: 'http', forwardHost: '127.0.0.1', forwardPort: 8080 })
    await database.insert(hostDomains).values({ proxyHostId: id, domain })
    ownedHosts.push(id)
    return { id, domain }
}
function monitor(actorId: string) {
    return createHostMonitoringService({
        database: () => database,
        requireActor: async (permission) => {
            await database.transaction((transaction) =>
                requirePermissionInTransaction(transaction, actorId, permission),
            )
            return { id: actorId }
        },
        rateLimit: async () => undefined,
    })
}

integrationTest(
    'malformed monitoring reads and writes fail validation before authorization or database work',
    async () => {
        const authorize = mock(async () => ({ id: randomUUID() }))
        const accessDatabase = mock(() => database)
        const rateLimit = mock(async () => undefined)
        const service = createHostMonitoringService({
            database: accessDatabase,
            requireActor: authorize,
            rateLimit,
        })
        await expect(service.getSummary({ proxyHostIds: [] })).rejects.toMatchObject({
            code: 'invalid_input',
        })
        await expect(service.getPolicy({ proxyHostId: 'invalid' })).rejects.toMatchObject({
            code: 'invalid_input',
        })
        await expect(
            service.getHistory({
                proxyHostId: randomUUID(),
                before: { checkedAt: 'not-time', id: randomUUID() },
            }),
        ).rejects.toMatchObject({ code: 'invalid_input' })
        await expect(
            service.savePolicy({
                proxyHostId: randomUUID(),
                expectedVersion: null,
                settings: { ...HOST_MONITORING_DEFAULTS, domain: '*.example.com' },
            }),
        ).rejects.toMatchObject({ code: 'invalid_input' })
        expect(authorize).not.toHaveBeenCalled()
        expect(accessDatabase).not.toHaveBeenCalled()
        expect(rateLimit).not.toHaveBeenCalled()
    },
)

integrationTest(
    'history combines time and health filters without leaking old observations and rejects missing hosts',
    async () => {
        const actor = await createBackendActor([
            PERMISSIONS.PROXY_HOSTS_VIEW,
            PERMISSIONS.PROXY_HOSTS_UPDATE,
        ])
        const target = await host()
        const service = monitor(actor)
        const policy = await service.savePolicy({
            proxyHostId: target.id,
            expectedVersion: null,
            settings: { ...HOST_MONITORING_DEFAULTS, enabled: true, domain: target.domain },
        })
        const cutoff = new Date(Date.now() - 120000)
        const latest = randomUUID()
        await database.insert(hostCheckObservations).values([
            {
                id: randomUUID(),
                policyId: policy.id,
                policyVersion: policy.version,
                checkedAt: new Date(cutoff.getTime() - 1000),
                status: 'unhealthy',
                code: 'upstream_timeout',
            },
            {
                id: randomUUID(),
                policyId: policy.id,
                policyVersion: policy.version,
                checkedAt: new Date(cutoff.getTime() + 1000),
                status: 'healthy',
                code: 'expected_status',
            },
            {
                id: latest,
                policyId: policy.id,
                policyVersion: policy.version,
                checkedAt: new Date(cutoff.getTime() + 2000),
                status: 'unhealthy',
                code: 'upstream_timeout',
            },
        ])
        const history = await service.getHistory({
            proxyHostId: target.id,
            since: cutoff.toISOString(),
            status: 'unhealthy',
        })
        expect(history.observations.map((item) => item.id)).toEqual([latest])
        expect(history.nextCursor).toBeNull()
        expect(history.incidents).toEqual([])
        await expect(service.getPolicy({ proxyHostId: randomUUID() })).rejects.toMatchObject({
            code: 'host_not_found',
        })
        await expect(service.getHistory({ proxyHostId: randomUUID() })).rejects.toMatchObject({
            code: 'host_not_found',
        })
        expect(
            await database
                .select()
                .from(hostCheckObservations)
                .where(eq(hostCheckObservations.policyId, policy.id)),
        ).toHaveLength(3)
    },
)

integrationTest(
    'the canonical monitoring service fails closed before writes when its rate limiter is unavailable',
    async () => {
        const actor = await createBackendActor([
            PERMISSIONS.PROXY_HOSTS_VIEW,
            PERMISSIONS.PROXY_HOSTS_UPDATE,
        ])
        const target = await host()
        const limiter = spyOn(rateLimiter, 'consumeRateLimit').mockRejectedValue(
            new rateLimiter.RateLimitUnavailableError('request_failed'),
        )
        await expect(
            asBackendActor(actor, () =>
                hostMonitoringService.savePolicy({
                    proxyHostId: target.id,
                    expectedVersion: null,
                    settings: { ...HOST_MONITORING_DEFAULTS, enabled: true, domain: target.domain },
                }),
            ),
        ).rejects.toMatchObject({ code: 'RATE_LIMIT_UNAVAILABLE' })
        expect(limiter).toHaveBeenCalledWith({
            ...HOST_MONITORING_WRITE_RATE_LIMIT,
            identifier: actor,
        })
        expect(
            await database
                .select()
                .from(hostCheckPolicies)
                .where(eq(hostCheckPolicies.proxyHostId, target.id)),
        ).toHaveLength(0)
        expect(
            await asBackendActor(actor, () =>
                hostMonitoringService.getPolicy({ proxyHostId: target.id }),
            ),
        ).toBeNull()
    },
)
