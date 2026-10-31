// oxlint-disable-next-line import/no-unassigned-import -- Keeps durable monitoring operations on the server.
import '@tanstack/react-start/server-only'

import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { HOST_MONITORING_LIMITS } from '@/config/host-monitoring.config.ts'
import {
    hostCheckIncidents,
    hostCheckObservations,
    hostCheckPolicies,
    hostDomains,
    proxyHosts,
} from '@/db/schema.ts'
import { advanceHostMonitoringState } from '@/lib/HostMonitoring/state.ts'
import type {
    HostMonitoringContext,
    HostMonitoringOutcome,
} from '@/lib/HostMonitoring/Types/host-monitoring.types.ts'
import { getAuthDatabase } from '@/server/Auth/Core/database.server.ts'
import { AuthDomainError } from '@/server/Auth/Core/errors.server.ts'
import type { AuthTransaction } from '@/server/Auth/Core/Types/database.types.ts'
import { lockProxyRuntimeSettings } from '@/server/ProxyRuntime/proxy-runtime-settings.ts'
import {
    cancelHostAvailabilityForHostsInTransaction,
    recordHostAvailabilityTransitionInTransaction,
} from '@/server/Notifications/host-availability.repository.ts'
import type { HostAvailabilityIncidentSource } from '@/server/Notifications/Types/notification-internal.types.ts'
import type {
    HostMonitoringClaim,
    HostMonitoringContextMatches,
    HostMonitoringHistory,
    HostMonitoringHistoryOptions,
    HostMonitoringPolicy,
    SaveHostMonitoringPolicyInput,
} from './Types/host-monitoring.repository.types.ts'

class ExpiredHostMonitoringClaim extends Error {}

async function lockMonitoring(transaction: AuthTransaction): Promise<void> {
    await transaction.execute(
        sql`select pg_advisory_xact_lock(${HOST_MONITORING_LIMITS.advisoryLockId})`,
    )
}

async function prepareWorkerTransaction(transaction: AuthTransaction): Promise<void> {
    const timeout = `${HOST_MONITORING_LIMITS.transactionTimeoutMs}ms`
    await transaction.execute(
        sql`select set_config('lock_timeout', ${timeout}, true), set_config('statement_timeout', ${timeout}, true), set_config('transaction_timeout', ${timeout}, true)`,
    )
    await lockProxyRuntimeSettings(transaction)
    await lockMonitoring(transaction)
}

async function databaseNow(transaction: AuthTransaction): Promise<Date> {
    const [row] = await transaction.execute<{ now: string }>(
        sql`select clock_timestamp()::text as now`,
    )
    if (!row) throw new Error('Monitoring transaction clock is unavailable.')
    return new Date(row.now)
}

export async function readHostMonitoringPolicy(
    transaction: AuthTransaction,
    proxyHostId: string,
): Promise<HostMonitoringPolicy | null> {
    const [policy] = await transaction
        .select()
        .from(hostCheckPolicies)
        .where(eq(hostCheckPolicies.proxyHostId, proxyHostId))
        .limit(1)
    return policy ?? null
}

export async function readHostMonitoringSummaries(
    transaction: AuthTransaction,
    proxyHostIds: readonly string[],
) {
    if (!proxyHostIds.length) return []
    return transaction
        .select({
            proxyHostId: proxyHosts.id,
            enabled: proxyHosts.enabled,
            policy: hostCheckPolicies,
            domain: hostDomains.domain,
        })
        .from(proxyHosts)
        .leftJoin(hostCheckPolicies, eq(hostCheckPolicies.proxyHostId, proxyHosts.id))
        .leftJoin(
            hostDomains,
            and(
                eq(hostDomains.proxyHostId, proxyHosts.id),
                eq(hostDomains.domain, hostCheckPolicies.domain),
            ),
        )
        .where(inArray(proxyHosts.id, [...proxyHostIds]))
        .orderBy(asc(proxyHosts.id))
}

// The caller holds the runtime-settings lock before taking this lock.
export async function lockHostMonitoringPolicy(
    transaction: AuthTransaction,
    proxyHostId: string,
): Promise<HostMonitoringPolicy | null> {
    await lockMonitoring(transaction)
    const [policy] = await transaction
        .select()
        .from(hostCheckPolicies)
        .where(eq(hostCheckPolicies.proxyHostId, proxyHostId))
        .for('update')
    return policy ?? null
}

// The caller holds the runtime-settings lock, before monitoring and notification locks.
export async function invalidateHostMonitoringForHostsInTransaction(
    transaction: AuthTransaction,
    proxyHostIds: readonly string[],
    reason: 'policy_changed' | 'monitoring_disabled' = 'policy_changed',
): Promise<void> {
    if (proxyHostIds.length === 0) return
    await lockMonitoring(transaction)
    const policies = await transaction
        .update(hostCheckPolicies)
        .set({
            version: sql`uuidv7()`,
            state: 'unknown',
            failureCount: 0,
            recoveryCount: 0,
            failureStartedAt: null,
            recoveryStartedAt: null,
            contextProof: null,
            contextRevision: null,
            leaseToken: null,
            leaseExpiresAt: null,
            lastCheckedAt: null,
            lastOutcome: null,
            lastCode: null,
            lastDurationMs: null,
            lastHttpStatus: null,
            nextCheckAt: sql`clock_timestamp()`,
            updatedAt: sql`clock_timestamp()`,
        })
        .where(inArray(hostCheckPolicies.proxyHostId, [...proxyHostIds]))
        .returning({ id: hostCheckPolicies.id })
    if (policies.length > 0)
        await transaction
            .update(hostCheckIncidents)
            .set({
                closedReason: reason,
                closedAt: sql`clock_timestamp()`,
                recoveryStartedAt: null,
            })
            .where(
                and(
                    inArray(
                        hostCheckIncidents.policyId,
                        policies.map((policy) => policy.id),
                    ),
                    isNull(hostCheckIncidents.closedReason),
                ),
            )
    await cancelHostAvailabilityForHostsInTransaction(transaction, proxyHostIds)
}

export async function saveHostMonitoringPolicy(
    transaction: AuthTransaction,
    input: SaveHostMonitoringPolicyInput,
): Promise<HostMonitoringPolicy> {
    await lockMonitoring(transaction)
    if (input.existing === null) {
        const [count] = await transaction
            .select({ count: sql<number>`count(*)::integer` })
            .from(hostCheckPolicies)
        if ((count?.count ?? 0) >= HOST_MONITORING_LIMITS.maxPolicies)
            throw new AuthDomainError(
                'invalid_input',
                'The monitoring policy limit has been reached.',
            )
    } else {
        await transaction
            .update(hostCheckIncidents)
            .set({
                closedReason: input.settings.enabled ? 'policy_changed' : 'monitoring_disabled',
                closedAt: sql`clock_timestamp()`,
                recoveryStartedAt: null,
            })
            .where(
                and(
                    eq(hostCheckIncidents.policyId, input.existing.id),
                    isNull(hostCheckIncidents.closedReason),
                ),
            )
    }
    const changes = {
        ...input.settings,
        version: randomUUID(),
        contextProof: null,
        contextRevision: null,
        configuredBy: input.configuredBy,
        state: 'unknown' as const,
        failureCount: 0,
        recoveryCount: 0,
        failureStartedAt: null,
        recoveryStartedAt: null,
        lastCheckedAt: null,
        lastOutcome: null,
        lastCode: null,
        lastDurationMs: null,
        lastHttpStatus: null,
        leaseToken: null,
        leaseExpiresAt: null,
        nextCheckAt: sql`clock_timestamp()`,
        updatedAt: sql`clock_timestamp()`,
    }
    const rows = input.existing
        ? await transaction
              .update(hostCheckPolicies)
              .set(changes)
              .where(eq(hostCheckPolicies.id, input.existing.id))
              .returning()
        : await transaction
              .insert(hostCheckPolicies)
              .values({ proxyHostId: input.proxyHostId, ...changes })
              .returning()
    const policy = rows.at(0)
    if (!policy) throw new Error('Monitoring policy could not be saved.')
    await pruneHistoryInTransaction(transaction)
    return policy
}

export async function claimDueHostMonitoringPolicy(): Promise<HostMonitoringClaim | null> {
    return getAuthDatabase().transaction(async (transaction) => {
        await prepareWorkerTransaction(transaction)
        const [active] = await transaction
            .select({ count: sql<number>`count(*)::integer` })
            .from(hostCheckPolicies)
            .where(gt(hostCheckPolicies.leaseExpiresAt, sql`clock_timestamp()`))
        if ((active?.count ?? 0) >= HOST_MONITORING_LIMITS.maxActiveClaims) return null
        // PostgreSQL's locking OF clause requires an unqualified relation name.
        const candidatePolicy = alias(hostCheckPolicies, 'monitoring_policy')
        const [candidate] = await transaction
            .select({ policy: candidatePolicy })
            .from(candidatePolicy)
            .innerJoin(proxyHosts, eq(proxyHosts.id, candidatePolicy.proxyHostId))
            .innerJoin(
                hostDomains,
                and(
                    eq(hostDomains.proxyHostId, candidatePolicy.proxyHostId),
                    eq(hostDomains.domain, candidatePolicy.domain),
                ),
            )
            .where(
                and(
                    eq(candidatePolicy.enabled, true),
                    eq(proxyHosts.enabled, true),
                    lte(candidatePolicy.nextCheckAt, sql`clock_timestamp()`),
                    or(
                        isNull(candidatePolicy.leaseExpiresAt),
                        lte(candidatePolicy.leaseExpiresAt, sql`clock_timestamp()`),
                    ),
                ),
            )
            .orderBy(asc(candidatePolicy.nextCheckAt), asc(candidatePolicy.id))
            .limit(1)
            .for('update', { of: candidatePolicy, skipLocked: true })
        if (!candidate) return null
        const leaseToken = randomUUID()
        const [policy] = await transaction
            .update(hostCheckPolicies)
            .set({
                leaseToken,
                leaseExpiresAt: sql`clock_timestamp() + ${HOST_MONITORING_LIMITS.leaseMs} * interval '1 millisecond'`,
            })
            .where(eq(hostCheckPolicies.id, candidate.policy.id))
            .returning()
        return policy ? { policy, leaseToken } : null
    })
}

async function currentClaim(
    transaction: AuthTransaction,
    claim: HostMonitoringClaim,
): Promise<HostMonitoringPolicy | null> {
    const [policy] = await transaction
        .select()
        .from(hostCheckPolicies)
        .where(
            and(
                eq(hostCheckPolicies.id, claim.policy.id),
                eq(hostCheckPolicies.version, claim.policy.version),
                eq(hostCheckPolicies.leaseToken, claim.leaseToken),
                gt(hostCheckPolicies.leaseExpiresAt, sql`clock_timestamp()`),
            ),
        )
        .for('update')
    return policy ?? null
}

async function clearLease(
    transaction: AuthTransaction,
    policy: HostMonitoringPolicy,
): Promise<void> {
    await transaction
        .update(hostCheckPolicies)
        .set({
            leaseToken: null,
            leaseExpiresAt: null,
            nextCheckAt: sql`clock_timestamp() + ${policy.intervalSeconds} * interval '1 second'`,
            updatedAt: sql`clock_timestamp()`,
        })
        .where(eq(hostCheckPolicies.id, policy.id))
}

export async function releaseHostMonitoringClaim(claim: HostMonitoringClaim): Promise<boolean> {
    return getAuthDatabase().transaction(async (transaction) => {
        await prepareWorkerTransaction(transaction)
        const policy = await currentClaim(transaction, claim)
        if (!policy) return false
        await clearLease(transaction, policy)
        return true
    })
}

export async function completeHostMonitoringClaim(
    claim: HostMonitoringClaim,
    outcome: HostMonitoringOutcome,
    contextMatches: HostMonitoringContextMatches,
    context: HostMonitoringContext,
): Promise<boolean> {
    return getAuthDatabase()
        .transaction(async (transaction) => {
            await prepareWorkerTransaction(transaction)
            const policy = await currentClaim(transaction, claim)
            if (!policy) return false
            const [eligible] = await transaction
                .select({ id: proxyHosts.id })
                .from(proxyHosts)
                .innerJoin(
                    hostDomains,
                    and(
                        eq(hostDomains.proxyHostId, proxyHosts.id),
                        eq(hostDomains.domain, policy.domain),
                    ),
                )
                .where(and(eq(proxyHosts.id, policy.proxyHostId), eq(proxyHosts.enabled, true)))
                .limit(1)
            // Context comparison is local database work under the runtime configuration lock.
            if (!policy.enabled || !eligible || !(await contextMatches(transaction, policy))) {
                await clearLease(transaction, policy)
                return false
            }
            const now = await databaseNow(transaction)
            // Recheck expiry after the callback as well as before it.
            if (!policy.leaseExpiresAt || policy.leaseExpiresAt <= now) return false
            const contextChanged =
                policy.contextProof !== context.proof || policy.contextRevision !== context.revision
            if (contextChanged) {
                await transaction
                    .update(hostCheckIncidents)
                    .set({
                        closedReason: 'policy_changed',
                        closedAt: now,
                        recoveryStartedAt: null,
                    })
                    .where(
                        and(
                            eq(hostCheckIncidents.policyId, policy.id),
                            isNull(hostCheckIncidents.closedReason),
                        ),
                    )
            }
            const previous = contextChanged
                ? {
                      state: 'unknown' as const,
                      failureCount: 0,
                      recoveryCount: 0,
                      failureStartedAt: null,
                      recoveryStartedAt: null,
                  }
                : policy
            const change = advanceHostMonitoringState(previous, outcome, policy, now)
            await transaction.insert(hostCheckObservations).values({
                policyId: policy.id,
                policyVersion: policy.version,
                checkedAt: now,
                status: outcome.status,
                code: outcome.code,
                durationMs: outcome.durationMs,
                httpStatus: outcome.httpStatus,
            })
            let notificationIncident: HostAvailabilityIncidentSource | undefined
            if (change.transition?.kind === 'outage') {
                const [incident] = await transaction
                    .insert(hostCheckIncidents)
                    .values({
                        policyId: policy.id,
                        startedAt: change.transition.firstObservedAt,
                        detectedAt: change.transition.confirmedAt,
                        failureCode: change.transition.code,
                    })
                    .returning()
                notificationIncident = incident
            } else if (change.transition?.kind === 'recovery') {
                const [incident] = await transaction
                    .update(hostCheckIncidents)
                    .set({
                        recoveryStartedAt: change.transition.firstObservedAt,
                        recoveredAt: change.transition.confirmedAt,
                        recoveryCode: change.transition.code,
                        closedReason: 'recovered',
                        closedAt: change.transition.confirmedAt,
                    })
                    .where(
                        and(
                            eq(hostCheckIncidents.policyId, policy.id),
                            isNull(hostCheckIncidents.closedReason),
                        ),
                    )
                    .returning()
                notificationIncident = incident
            } else if (previous.state === 'unhealthy') {
                await transaction
                    .update(hostCheckIncidents)
                    .set({
                        recoveryStartedAt: change.snapshot.recoveryStartedAt,
                    })
                    .where(
                        and(
                            eq(hostCheckIncidents.policyId, policy.id),
                            isNull(hostCheckIncidents.closedReason),
                        ),
                    )
            }
            await prunePolicyHistoryInTransaction(transaction, policy)
            const updated = await transaction
                .update(hostCheckPolicies)
                .set({
                    ...change.snapshot,
                    contextProof: context.proof,
                    contextRevision: context.revision,
                    lastCheckedAt: now,
                    lastOutcome: outcome.status,
                    lastCode: outcome.code,
                    lastDurationMs: outcome.durationMs,
                    lastHttpStatus: outcome.httpStatus,
                    leaseToken: null,
                    leaseExpiresAt: null,
                    nextCheckAt: sql`clock_timestamp() + ${policy.intervalSeconds} * interval '1 second'`,
                    updatedAt: sql`clock_timestamp()`,
                })
                .where(
                    and(
                        eq(hostCheckPolicies.id, policy.id),
                        eq(hostCheckPolicies.version, claim.policy.version),
                        eq(hostCheckPolicies.leaseToken, claim.leaseToken),
                        gt(hostCheckPolicies.leaseExpiresAt, sql`clock_timestamp()`),
                    ),
                )
                .returning({ id: hostCheckPolicies.id })
            if (updated.length === 0) throw new ExpiredHostMonitoringClaim()
            if (notificationIncident && change.transition)
                await recordHostAvailabilityTransitionInTransaction(
                    transaction,
                    policy,
                    context,
                    notificationIncident,
                    change.transition.kind,
                )
            return true
        })
        .catch((error: unknown) => {
            if (error instanceof ExpiredHostMonitoringClaim) return false
            throw error
        })
}

async function prunePolicyHistoryInTransaction(
    transaction: AuthTransaction,
    policy: HostMonitoringPolicy,
): Promise<void> {
    await transaction.execute(sql`
        delete from "rentnerproxy"."host_check_observations" as observation
        using (
            select id from "rentnerproxy"."host_check_observations"
            where policy_id = ${policy.id}::uuid
                and checked_at < clock_timestamp() - ${policy.retentionDays} * interval '1 day'
            union
            (select id from "rentnerproxy"."host_check_observations"
             where policy_id = ${policy.id}::uuid
             order by checked_at desc, id desc offset ${policy.sampleLimit})
        ) expired where observation.id = expired.id
    `)
    await transaction.execute(sql`
        delete from "rentnerproxy"."host_check_incidents" as incident
        using (
            select id from "rentnerproxy"."host_check_incidents"
            where policy_id = ${policy.id}::uuid and closed_reason is not null
                and closed_at < clock_timestamp() - ${policy.retentionDays} * interval '1 day'
            union
            (select id from "rentnerproxy"."host_check_incidents"
             where policy_id = ${policy.id}::uuid and closed_reason is not null
             order by closed_at desc, id desc
             offset greatest(${policy.incidentLimit} - (
                 select count(*) from "rentnerproxy"."host_check_incidents"
                 where policy_id = ${policy.id}::uuid and closed_reason is null
             ), 0))
        ) expired where incident.id = expired.id
    `)
}

// The periodic sweep and policy edits reconcile global retention targets.
async function pruneHistoryInTransaction(transaction: AuthTransaction): Promise<void> {
    await transaction.execute(sql`
        delete from "rentnerproxy"."host_check_observations" as observation
        using (
            select id from (
                select o.id, o.checked_at, p.retention_days, p.sample_limit,
                    row_number() over (partition by o.policy_id order by o.checked_at desc, o.id desc) as policy_rank,
                    row_number() over (order by o.checked_at desc, o.id desc) as global_rank
                from "rentnerproxy"."host_check_observations" o
                join "rentnerproxy"."host_check_policies" p on p.id = o.policy_id
            ) ranked
            where checked_at < clock_timestamp() - retention_days * interval '1 day'
                or policy_rank > sample_limit or global_rank > ${HOST_MONITORING_LIMITS.maxObservations}
        ) expired where observation.id = expired.id
    `)
    // Open incidents survive both retention and count caps. At most one can exist per policy.
    await transaction.execute(sql`
        delete from "rentnerproxy"."host_check_incidents" as incident
        using (
            select id from (
                select i.id, i.closed_at, p.retention_days, p.incident_limit,
                    row_number() over (partition by i.policy_id order by i.closed_at desc, i.id desc) as policy_rank,
                    row_number() over (order by i.closed_at desc, i.id desc) as global_rank,
                    case when opened.id is null then 0 else 1 end as policy_open,
                    (select count(*) from "rentnerproxy"."host_check_incidents" opened where opened.closed_reason is null) as global_open
                from "rentnerproxy"."host_check_incidents" i
                join "rentnerproxy"."host_check_policies" p on p.id = i.policy_id
                left join "rentnerproxy"."host_check_incidents" opened on opened.policy_id = i.policy_id and opened.closed_reason is null
                where i.closed_reason is not null
            ) ranked
            where closed_at < clock_timestamp() - retention_days * interval '1 day'
                or policy_rank > greatest(incident_limit - policy_open, 0)
                or global_rank > greatest(${HOST_MONITORING_LIMITS.maxIncidents} - global_open, 0)
        ) expired where incident.id = expired.id
    `)
}

export async function pruneHostMonitoringHistory(): Promise<void> {
    await getAuthDatabase().transaction(async (transaction) => {
        await prepareWorkerTransaction(transaction)
        await pruneHistoryInTransaction(transaction)
    })
}

export async function readHostMonitoringHistory(
    transaction: AuthTransaction,
    policyId: string,
    options: HostMonitoringHistoryOptions,
): Promise<HostMonitoringHistory> {
    const limit = Math.max(
        1,
        Math.min(HOST_MONITORING_LIMITS.historyLimit, Math.trunc(options.limit)),
    )
    const cursor = options.before
    const observations = await transaction
        .select()
        .from(hostCheckObservations)
        .where(
            and(
                eq(hostCheckObservations.policyId, policyId),
                options.status && options.status !== 'all'
                    ? eq(hostCheckObservations.status, options.status)
                    : undefined,
                options.since ? gte(hostCheckObservations.checkedAt, options.since) : undefined,
                cursor
                    ? or(
                          lt(hostCheckObservations.checkedAt, cursor.checkedAt),
                          and(
                              eq(hostCheckObservations.checkedAt, cursor.checkedAt),
                              lt(hostCheckObservations.id, cursor.id),
                          ),
                      )
                    : undefined,
            ),
        )
        .orderBy(desc(hostCheckObservations.checkedAt), desc(hostCheckObservations.id))
        .limit(limit + 1)
    const incidents = await transaction
        .select()
        .from(hostCheckIncidents)
        .where(
            and(
                eq(hostCheckIncidents.policyId, policyId),
                options.since
                    ? or(
                          isNull(hostCheckIncidents.closedAt),
                          gte(hostCheckIncidents.closedAt, options.since),
                      )
                    : undefined,
            ),
        )
        .orderBy(
            desc(isNull(hostCheckIncidents.closedAt)),
            desc(hostCheckIncidents.startedAt),
            desc(hostCheckIncidents.id),
        )
        .limit(limit)
    return {
        observations: observations.slice(0, limit),
        incidents,
        hasMore: observations.length > limit,
    }
}
