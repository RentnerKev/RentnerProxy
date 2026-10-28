import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/db/index.ts'
import {
    hostCheckIncidents,
    hostCheckObservations,
    hostCheckPolicies,
    hostDomains,
    proxyHosts,
    users,
} from '@/db/schema.ts'
import { HOST_MONITORING_DEFAULTS } from '@/config/host-monitoring.config.ts'
import type {
    HostMonitoringContext,
    HostMonitoringOutcome,
    HostMonitoringSettings,
} from '@/lib/HostMonitoring/Types/host-monitoring.types.ts'
import { getDatabaseUrl } from '@/server/env.server.ts'
import { lockProxyRuntimeSettings } from '@/server/ProxyRuntime/proxy-runtime-settings.ts'
import {
    claimDueHostMonitoringPolicy,
    completeHostMonitoringClaim as completeStoredClaim,
    lockHostMonitoringPolicy,
    pruneHostMonitoringHistory,
    readHostMonitoringHistory,
    releaseHostMonitoringClaim,
    saveHostMonitoringPolicy,
} from '@/server/HostMonitoring/host-monitoring.repository.ts'
import type {
    HostMonitoringClaim,
    HostMonitoringContextMatches,
    HostMonitoringPolicy,
} from '@/server/HostMonitoring/Types/host-monitoring.repository.types.ts'

const databaseUrl = getDatabaseUrl()
const isolated =
    process.env.RENTNERPROXY_DATABASE_INTEGRATION === '1' &&
    databaseUrl !== null &&
    new URL(databaseUrl).hostname === '127.0.0.1' &&
    new URL(databaseUrl).pathname === '/rentnerproxy_upstream_test'
const integrationTest = isolated ? test : test.skip
const hostIds: string[] = []
let actorId: string | undefined
const fixtureContext: HostMonitoringContext = {
    proof: 'sha256:' + 'a'.repeat(64),
    revision: 'sha256:' + 'b'.repeat(64),
}

function complete(
    claimed: HostMonitoringClaim,
    outcome: HostMonitoringOutcome,
    matches: HostMonitoringContextMatches,
    context = fixtureContext,
) {
    return completeStoredClaim(claimed, outcome, matches, context)
}
const healthy: HostMonitoringOutcome = {
    status: 'healthy',
    code: 'expected_status',
    durationMs: 4,
    httpStatus: 200,
}
const unhealthy: HostMonitoringOutcome = {
    status: 'unhealthy',
    code: 'upstream_timeout',
    durationMs: 3_000,
    httpStatus: null,
}
const unknown: HostMonitoringOutcome = {
    status: 'unknown',
    code: 'runtime_unavailable',
    durationMs: null,
    httpStatus: null,
}

async function fixture(
    settings: Partial<HostMonitoringSettings> = {},
): Promise<HostMonitoringPolicy> {
    const id = randomUUID()
    hostIds.push(id)
    const domain = `monitor-${id}.example.test`
    await db
        .insert(proxyHosts)
        .values({ id, forwardScheme: 'http', forwardHost: '127.0.0.1', forwardPort: 8080 })
    await db.insert(hostDomains).values({ proxyHostId: id, domain })
    if (!actorId) throw new Error('Monitoring fixture actor is unavailable.')
    return db.transaction(async (transaction) => {
        await lockProxyRuntimeSettings(transaction)
        return saveHostMonitoringPolicy(transaction, {
            proxyHostId: id,
            configuredBy: actorId!,
            existing: null,
            settings: { ...HOST_MONITORING_DEFAULTS, domain, enabled: true, ...settings },
        })
    })
}

async function claim(policy: HostMonitoringPolicy): Promise<HostMonitoringClaim> {
    await db
        .update(hostCheckPolicies)
        .set({ nextCheckAt: new Date(0) })
        .where(eq(hostCheckPolicies.id, policy.id))
    const claimed = await claimDueHostMonitoringPolicy()
    if (!claimed || claimed.policy.id !== policy.id)
        throw new Error('Owned monitoring policy was not claimed.')
    return claimed
}

async function row(policy: HostMonitoringPolicy) {
    const [current] = await db
        .select()
        .from(hostCheckPolicies)
        .where(eq(hostCheckPolicies.id, policy.id))
    if (!current) throw new Error('Owned monitoring policy disappeared.')
    return current
}

async function finish(policy: HostMonitoringPolicy, outcome: HostMonitoringOutcome) {
    return complete(await claim(policy), outcome, async () => true)
}

describe('durable scheduled monitoring repository', () => {
    beforeEach(async () => {
        if (!isolated) return
        // Global claim/retention behavior needs a database containing only this test's monitoring fixtures.
        const [existing] = await db
            .select({ count: sql<number>`count(*)::integer` })
            .from(hostCheckPolicies)
        expect(existing?.count).toBe(0)
        actorId = randomUUID()
        await db.insert(users).values({
            id: actorId,
            displayName: 'Monitoring fixture',
            email: `${actorId}@monitoring-fixture.invalid`,
        })
    })

    afterEach(async () => {
        if (!isolated) return
        if (hostIds.length)
            await db.delete(proxyHosts).where(inArray(proxyHosts.id, hostIds.splice(0)))
        if (actorId) await db.delete(users).where(eq(users.id, actorId))
        actorId = undefined
    })

    integrationTest(
        'concurrent claimers enforce the global lease cap and exclude already claimed policies',
        async () => {
            await Promise.all([fixture(), fixture(), fixture()])
            const claims = await Promise.all([
                claimDueHostMonitoringPolicy(),
                claimDueHostMonitoringPolicy(),
                claimDueHostMonitoringPolicy(),
                claimDueHostMonitoringPolicy(),
            ])
            const active = claims.filter((value) => value !== null)
            expect(active).toHaveLength(2)
            expect(new Set(active.map((value) => value.policy.id)).size).toBe(2)
            expect(active.every((value) => value.leaseToken === value.policy.leaseToken)).toBe(true)
            expect(await releaseHostMonitoringClaim(active[0]!)).toBe(true)
            expect((await row(active[0]!.policy)).nextCheckAt.getTime()).toBeGreaterThan(Date.now())
            expect(await claimDueHostMonitoringPolicy()).not.toBeNull()
        },
    )

    integrationTest(
        'claims require an enabled host, an enabled policy, and the selected attached domain',
        async () => {
            const policy = await fixture({ enabled: false })
            expect(await claimDueHostMonitoringPolicy()).toBeNull()
            await db
                .update(hostCheckPolicies)
                .set({ enabled: true })
                .where(eq(hostCheckPolicies.id, policy.id))
            await db
                .update(proxyHosts)
                .set({ enabled: false })
                .where(eq(proxyHosts.id, policy.proxyHostId))
            expect(await claimDueHostMonitoringPolicy()).toBeNull()
            await db
                .update(proxyHosts)
                .set({ enabled: true })
                .where(eq(proxyHosts.id, policy.proxyHostId))
            await db.delete(hostDomains).where(eq(hostDomains.proxyHostId, policy.proxyHostId))
            expect(await claimDueHostMonitoringPolicy()).toBeNull()
        },
    )

    integrationTest(
        'SQL bounds, lease pairs, and the single open incident invariant survive direct writes',
        async () => {
            const policy = await fixture({ failureThreshold: 1 })
            for (const changes of [
                { intervalSeconds: 29 },
                { timeoutMs: 10_001 },
                { expectedStatus: 99 },
                { failureThreshold: 0 },
                { recoveryThreshold: 21 },
                { retentionDays: 31 },
                { sampleLimit: 9 },
                { incidentLimit: 0 },
                { failureCount: 1 },
                { leaseToken: randomUUID() },
                { contextProof: fixtureContext.proof },
            ]) {
                // oxlint-disable-next-line no-await-in-loop -- Check each rejected write on the same owned row before the next constraint.
                await expect(
                    db
                        .update(hostCheckPolicies)
                        .set(changes)
                        .where(eq(hostCheckPolicies.id, policy.id))
                        .execute(),
                ).rejects.toThrow()
            }
            await finish(policy, unhealthy)
            await expect(
                db
                    .insert(hostCheckIncidents)
                    .values({
                        policyId: policy.id,
                        startedAt: new Date(),
                        detectedAt: new Date(),
                        failureCode: 'upstream_timeout',
                    })
                    .execute(),
            ).rejects.toThrow()
            await db.delete(users).where(eq(users.id, actorId!))
            actorId = undefined
            expect((await row(policy)).configuredBy).toBeNull()
            expect(await finish(policy, unhealthy)).toBe(true)
            await db.delete(proxyHosts).where(eq(proxyHosts.id, policy.proxyHostId))
            expect(
                await db
                    .select()
                    .from(hostCheckPolicies)
                    .where(eq(hostCheckPolicies.id, policy.id)),
            ).toHaveLength(0)
            expect(
                await db
                    .select()
                    .from(hostCheckObservations)
                    .where(eq(hostCheckObservations.policyId, policy.id)),
            ).toHaveLength(0)
            expect(
                await db
                    .select()
                    .from(hostCheckIncidents)
                    .where(eq(hostCheckIncidents.policyId, policy.id)),
            ).toHaveLength(0)
        },
    )

    integrationTest(
        'token, version, expiry, and changed context fence stale outcomes without observations',
        async () => {
            const policy = await fixture()
            const first = await claim(policy)
            expect(
                await complete({ ...first, leaseToken: randomUUID() }, unhealthy, async () => true),
            ).toBe(false)
            expect(
                await complete(
                    { ...first, policy: { ...first.policy, version: randomUUID() } },
                    unhealthy,
                    async () => true,
                ),
            ).toBe(false)
            await db
                .update(hostCheckPolicies)
                .set({ leaseExpiresAt: new Date(0) })
                .where(eq(hostCheckPolicies.id, policy.id))
            expect(await complete(first, unhealthy, async () => true)).toBe(false)
            const second = await claim(policy)
            expect(second.leaseToken).not.toBe(first.leaseToken)
            expect(await complete(first, unhealthy, async () => true)).toBe(false)
            expect(await complete(second, unhealthy, async () => false)).toBe(false)
            expect((await row(policy)).leaseToken).toBeNull()
            expect(
                await db
                    .select()
                    .from(hostCheckObservations)
                    .where(eq(hostCheckObservations.policyId, policy.id)),
            ).toHaveLength(0)
        },
    )

    integrationTest(
        'a final expired-lease fence rolls back observations and incidents atomically',
        async () => {
            const policy = await fixture({ failureThreshold: 1 })
            const admitted = await claim(policy)
            const before = await row(policy)
            const completed = await complete(admitted, unhealthy, async (transaction, current) => {
                // Deterministically expire the admitted row after the initial fence; the cached lease is still future-dated.
                await transaction
                    .update(hostCheckPolicies)
                    .set({
                        leaseExpiresAt: sql`clock_timestamp() - interval '1 millisecond'`,
                    })
                    .where(eq(hostCheckPolicies.id, current.id))
                return true
            })
            expect(completed).toBe(false)
            expect(
                await db
                    .select()
                    .from(hostCheckObservations)
                    .where(eq(hostCheckObservations.policyId, policy.id)),
            ).toHaveLength(0)
            expect(
                await db
                    .select()
                    .from(hostCheckIncidents)
                    .where(eq(hostCheckIncidents.policyId, policy.id)),
            ).toHaveLength(0)
            const after = await row(policy)
            expect(after.leaseToken).toBe(before.leaseToken)
            expect(after.leaseExpiresAt).toEqual(before.leaseExpiresAt)
            expect(after.nextCheckAt).toEqual(before.nextCheckAt)
            expect(after.state).toBe('unknown')
            expect(after.contextProof).toBeNull()
        },
    )

    integrationTest(
        'failure and recovery thresholds preserve first observations and unknown interrupts streaks',
        async () => {
            const policy = await fixture({ failureThreshold: 2, recoveryThreshold: 2 })
            expect(await finish(policy, unhealthy)).toBe(true)
            expect((await row(policy)).failureCount).toBe(1)
            expect(await finish(policy, unknown)).toBe(true)
            expect((await row(policy)).failureCount).toBe(0)
            expect(await finish(policy, unhealthy)).toBe(true)
            const firstFailure = (await row(policy)).failureStartedAt
            expect(await finish(policy, unhealthy)).toBe(true)
            expect((await row(policy)).state).toBe('unhealthy')
            const [incident] = await db
                .select()
                .from(hostCheckIncidents)
                .where(eq(hostCheckIncidents.policyId, policy.id))
            expect(incident?.startedAt.getTime()).toBe(firstFailure?.getTime())
            expect(incident?.closedReason).toBeNull()
            expect(await finish(policy, healthy)).toBe(true)
            const firstRecovery = (await row(policy)).recoveryStartedAt
            expect(await finish(policy, healthy)).toBe(true)
            const [recovered] = await db
                .select()
                .from(hostCheckIncidents)
                .where(eq(hostCheckIncidents.policyId, policy.id))
            expect(recovered?.recoveryStartedAt).toEqual(firstRecovery)
            expect(recovered?.closedReason).toBe('recovered')
            expect((await row(policy)).state).toBe('healthy')
            expect(await complete(await claim(policy), healthy, async () => true)).toBe(true)
            expect(
                await db
                    .select()
                    .from(hostCheckIncidents)
                    .where(eq(hostCheckIncidents.policyId, policy.id)),
            ).toHaveLength(1)
        },
    )

    integrationTest(
        'policy edits close an outage, rotate the fence, and disable future checks atomically',
        async () => {
            const policy = await fixture({ failureThreshold: 1 })
            await finish(policy, unhealthy)
            const stale = await claim(policy)
            const saved = await db.transaction(async (transaction) => {
                await lockProxyRuntimeSettings(transaction)
                const existing = await lockHostMonitoringPolicy(transaction, policy.proxyHostId)
                return saveHostMonitoringPolicy(transaction, {
                    proxyHostId: policy.proxyHostId,
                    configuredBy: actorId!,
                    existing,
                    settings: {
                        ...HOST_MONITORING_DEFAULTS,
                        domain: policy.domain,
                        enabled: false,
                    },
                })
            })
            expect(saved.version).not.toBe(policy.version)
            expect(saved.state).toBe('unknown')
            expect(saved.leaseToken).toBeNull()
            expect(await complete(stale, unhealthy, async () => true)).toBe(false)
            const [incident] = await db
                .select()
                .from(hostCheckIncidents)
                .where(eq(hostCheckIncidents.policyId, policy.id))
            expect(incident?.closedReason).toBe('monitoring_disabled')
            expect(await claimDueHostMonitoringPolicy()).toBeNull()
        },
    )

    integrationTest(
        'a new runtime context cannot inherit old failure or recovery streaks',
        async () => {
            const policy = await fixture({ failureThreshold: 2, recoveryThreshold: 2 })
            await finish(policy, unhealthy)
            const secondContext = { ...fixtureContext, proof: 'sha256:' + 'c'.repeat(64) }
            await complete(await claim(policy), unhealthy, async () => true, secondContext)
            expect((await row(policy)).state).toBe('unknown')
            expect((await row(policy)).failureCount).toBe(1)
            expect(
                await db
                    .select()
                    .from(hostCheckIncidents)
                    .where(eq(hostCheckIncidents.policyId, policy.id)),
            ).toHaveLength(0)
            await complete(await claim(policy), unhealthy, async () => true, secondContext)
            expect((await row(policy)).state).toBe('unhealthy')
            await complete(await claim(policy), healthy, async () => true, secondContext)
            expect((await row(policy)).recoveryCount).toBe(1)
            const thirdContext = { ...secondContext, revision: 'sha256:' + 'd'.repeat(64) }
            await complete(await claim(policy), healthy, async () => true, thirdContext)
            const [incident] = await db
                .select()
                .from(hostCheckIncidents)
                .where(eq(hostCheckIncidents.policyId, policy.id))
            expect(incident?.closedReason).toBe('policy_changed')
            expect(incident?.recoveredAt).toBeNull()
            expect((await row(policy)).state).toBe('healthy')
            expect((await row(policy)).recoveryCount).toBe(0)
        },
    )

    integrationTest(
        'retention prunes disabled history by age and count while preserving an open incident',
        async () => {
            const policy = await fixture({
                sampleLimit: 10,
                incidentLimit: 1,
                retentionDays: 1,
                failureThreshold: 1,
            })
            await finish(policy, unhealthy)
            await db
                .update(hostCheckPolicies)
                .set({ enabled: false })
                .where(eq(hostCheckPolicies.id, policy.id))
            const old = new Date(Date.now() - 3 * 86_400_000)
            const now = new Date()
            await db.insert(hostCheckObservations).values(
                Array.from({ length: 15 }, (_, index) => ({
                    policyId: policy.id,
                    policyVersion: policy.version,
                    status: 'healthy' as const,
                    code: 'expected_status' as const,
                    checkedAt: index === 0 ? old : new Date(now.getTime() - index),
                })),
            )
            await db.insert(hostCheckIncidents).values({
                policyId: policy.id,
                startedAt: old,
                detectedAt: old,
                failureCode: 'upstream_timeout',
                closedReason: 'policy_changed',
                closedAt: old,
            })
            await db
                .update(hostCheckIncidents)
                .set({ startedAt: old, detectedAt: old })
                .where(
                    and(
                        eq(hostCheckIncidents.policyId, policy.id),
                        sql`${hostCheckIncidents.closedReason} is null`,
                    ),
                )
            await pruneHostMonitoringHistory()
            const observations = await db
                .select()
                .from(hostCheckObservations)
                .where(eq(hostCheckObservations.policyId, policy.id))
            expect(observations).toHaveLength(10)
            expect(observations.every((observation) => observation.checkedAt > old)).toBe(true)
            const incidents = await db
                .select()
                .from(hostCheckIncidents)
                .where(eq(hostCheckIncidents.policyId, policy.id))
            expect(incidents).toHaveLength(1)
            expect(incidents[0]?.closedReason).toBeNull()
        },
    )

    integrationTest(
        'completion trims only its own policy while the periodic sweep reconciles other history',
        async () => {
            const settings = {
                sampleLimit: 10,
                incidentLimit: 2,
                retentionDays: 1,
                failureThreshold: 1,
            }
            const current = await fixture(settings)
            const other = await fixture({ ...settings, enabled: false })
            await finish(current, unhealthy)
            const old = new Date(Date.now() - 3 * 86_400_000)
            const now = new Date()
            await db.insert(hostCheckObservations).values(
                [current, other].flatMap((policy) =>
                    Array.from({ length: 15 }, (_, index) => ({
                        policyId: policy.id,
                        policyVersion: policy.version,
                        status: 'healthy' as const,
                        code: 'expected_status' as const,
                        checkedAt: index === 0 ? old : new Date(now.getTime() - index),
                    })),
                ),
            )
            await db.insert(hostCheckIncidents).values(
                [current, other].flatMap((policy) =>
                    Array.from({ length: 3 }, (_, index) => ({
                        policyId: policy.id,
                        startedAt: old,
                        detectedAt: old,
                        failureCode: 'upstream_timeout' as const,
                        closedReason: 'policy_changed' as const,
                        closedAt: index === 0 ? old : new Date(now.getTime() - index),
                    })),
                ),
            )
            const [otherOpen] = await db
                .insert(hostCheckIncidents)
                .values({
                    policyId: other.id,
                    startedAt: old,
                    detectedAt: old,
                    failureCode: 'upstream_timeout',
                })
                .returning({ id: hostCheckIncidents.id })
            const otherObservations = await db
                .select()
                .from(hostCheckObservations)
                .where(eq(hostCheckObservations.policyId, other.id))
            const otherIncidents = await db
                .select()
                .from(hostCheckIncidents)
                .where(eq(hostCheckIncidents.policyId, other.id))
            await finish(current, unknown)
            const currentObservations = await db
                .select()
                .from(hostCheckObservations)
                .where(eq(hostCheckObservations.policyId, current.id))
            const currentIncidents = await db
                .select()
                .from(hostCheckIncidents)
                .where(eq(hostCheckIncidents.policyId, current.id))
            expect(currentObservations).toHaveLength(10)
            expect(currentObservations.every((observation) => observation.checkedAt > old)).toBe(
                true,
            )
            expect(currentIncidents).toHaveLength(2)
            expect(currentIncidents.some((incident) => incident.closedReason === null)).toBe(true)
            expect(
                await db
                    .select()
                    .from(hostCheckObservations)
                    .where(eq(hostCheckObservations.policyId, other.id)),
            ).toEqual(otherObservations)
            expect(
                await db
                    .select()
                    .from(hostCheckIncidents)
                    .where(eq(hostCheckIncidents.policyId, other.id)),
            ).toEqual(otherIncidents)
            await pruneHostMonitoringHistory()
            expect(
                await db
                    .select()
                    .from(hostCheckObservations)
                    .where(eq(hostCheckObservations.policyId, other.id)),
            ).toHaveLength(10)
            const sweptIncidents = await db
                .select()
                .from(hostCheckIncidents)
                .where(eq(hostCheckIncidents.policyId, other.id))
            expect(sweptIncidents).toHaveLength(2)
            expect(
                sweptIncidents.some(
                    (incident) => incident.id === otherOpen?.id && incident.closedReason === null,
                ),
            ).toBe(true)
        },
    )

    integrationTest(
        'a long outage remains in history for the retention period after recovery',
        async () => {
            const policy = await fixture({
                failureThreshold: 1,
                recoveryThreshold: 1,
                retentionDays: 1,
            })
            await finish(policy, unhealthy)
            const old = new Date(Date.now() - 3 * 86_400_000)
            await db
                .update(hostCheckIncidents)
                .set({ startedAt: old, detectedAt: old })
                .where(eq(hostCheckIncidents.policyId, policy.id))
            await finish(policy, healthy)
            await pruneHostMonitoringHistory()
            const [incident] = await db
                .select()
                .from(hostCheckIncidents)
                .where(eq(hostCheckIncidents.policyId, policy.id))
            expect(incident?.startedAt.getTime()).toBe(old.getTime())
            expect(incident?.closedReason).toBe('recovered')
            expect(incident?.closedAt).toEqual(incident?.recoveredAt)
            expect(incident?.closedAt?.getTime()).toBeGreaterThan(Date.now() - 60_000)
        },
    )

    integrationTest(
        'history pagination uses timestamp and id so equal check times do not lose samples',
        async () => {
            const policy = await fixture()
            const checkedAt = new Date()
            await db.insert(hostCheckObservations).values(
                Array.from({ length: 5 }, () => ({
                    policyId: policy.id,
                    policyVersion: policy.version,
                    status: 'healthy' as const,
                    code: 'expected_status' as const,
                    checkedAt,
                })),
            )
            const first = await db.transaction((transaction) =>
                readHostMonitoringHistory(transaction, policy.id, { limit: 3 }),
            )
            expect(first.hasMore).toBe(true)
            const last = first.observations.at(-1)!
            const second = await db.transaction((transaction) =>
                readHostMonitoringHistory(transaction, policy.id, {
                    limit: 3,
                    before: { checkedAt: last.checkedAt, id: last.id },
                }),
            )
            expect(second.hasMore).toBe(false)
            expect(
                new Set(
                    [...first.observations, ...second.observations].map(
                        (observation) => observation.id,
                    ),
                ).size,
            ).toBe(5)
        },
    )

    integrationTest(
        'global history caps bound overflow across policies and preserve every open outage',
        async () => {
            const policies = await Promise.all(
                Array.from({ length: 11 }, () =>
                    fixture({
                        sampleLimit: 10_000,
                        incidentLimit: 1_000,
                        failureThreshold: 1,
                    }),
                ),
            )
            // These sequential checks install one open outage per owned policy before bulk history seeding.
            for (const policy of policies) {
                // oxlint-disable-next-line no-await-in-loop -- A global claim must complete before advancing another owned policy.
                await finish(policy, unhealthy)
            }
            const ownedIds = sql.join(
                policies.map((policy) => sql`${policy.id}::uuid`),
                sql`, `,
            )
            await db.execute(sql`
            insert into "rentnerproxy"."host_check_observations"
                (policy_id, policy_version, checked_at, status, code)
            select p.id, p.version, statement_timestamp(), 'healthy', 'expected_status'
            from "rentnerproxy"."host_check_policies" p
            cross join generate_series(1, 10000)
            where p.id in (${ownedIds})
        `)
            await db.execute(sql`
            insert into "rentnerproxy"."host_check_incidents"
                (policy_id, started_at, detected_at, failure_code, closed_reason, closed_at)
            select p.id, statement_timestamp(), statement_timestamp(), 'upstream_timeout', 'policy_changed', statement_timestamp()
            from "rentnerproxy"."host_check_policies" p
            cross join generate_series(1, 1000)
            where p.id in (${ownedIds})
        `)
            await pruneHostMonitoringHistory()
            const [counts] = await db.execute<{
                observations: number
                incidents: number
                open: number
                max_samples: number
                max_incidents: number
            }>(sql`
            select
                (select count(*)::integer from "rentnerproxy"."host_check_observations") as observations,
                (select count(*)::integer from "rentnerproxy"."host_check_incidents") as incidents,
                (select count(*)::integer from "rentnerproxy"."host_check_incidents" where closed_reason is null) as open,
                (select max(total)::integer from (select count(*) total from "rentnerproxy"."host_check_observations" group by policy_id) counts) as max_samples,
                (select max(total)::integer from (select count(*) total from "rentnerproxy"."host_check_incidents" group by policy_id) counts) as max_incidents
        `)
            expect(counts?.observations).toBeLessThanOrEqual(100_000)
            expect(counts?.incidents).toBeLessThanOrEqual(10_000)
            expect(counts?.open).toBe(11)
            expect(counts?.max_samples).toBeLessThanOrEqual(10_000)
            expect(counts?.max_incidents).toBeLessThanOrEqual(1_000)
            expect(counts?.observations).toBeGreaterThan(90_000)
            expect(counts?.incidents).toBeGreaterThan(9_000)
        },
        20_000,
    )

    integrationTest(
        'the policy installation cap is enforced inside the serialized save transaction',
        async () => {
            const ids = Array.from({ length: 1_001 }, () => randomUUID())
            hostIds.push(...ids)
            await db.insert(proxyHosts).values(
                ids.map((id) => ({
                    id,
                    forwardScheme: 'http' as const,
                    forwardHost: '127.0.0.1',
                    forwardPort: 8080,
                })),
            )
            await db.insert(hostCheckPolicies).values(
                ids.slice(0, 1_000).map((proxyHostId) => ({
                    proxyHostId,
                    domain: `cap-${proxyHostId}.example.test`,
                    configuredBy: actorId,
                })),
            )
            const last = ids.at(-1)!
            await expect(
                db.transaction(async (transaction) => {
                    await lockProxyRuntimeSettings(transaction)
                    return saveHostMonitoringPolicy(transaction, {
                        proxyHostId: last,
                        configuredBy: actorId!,
                        existing: null,
                        settings: {
                            ...HOST_MONITORING_DEFAULTS,
                            domain: `cap-${last}.example.test`,
                        },
                    })
                }),
            ).rejects.toThrow('The monitoring policy limit has been reached.')
            const [count] = await db
                .select({ count: sql<number>`count(*)::integer` })
                .from(hostCheckPolicies)
            expect(count?.count).toBe(1_000)
        },
        10_000,
    )
})
