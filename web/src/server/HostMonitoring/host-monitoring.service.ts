import '@tanstack/react-start/server-only'
import { sql } from 'drizzle-orm'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import {
    HOST_MONITORING_LIMITS,
    HOST_MONITORING_WRITE_RATE_LIMIT,
} from '@/config/host-monitoring.config.ts'
import {
    hostMonitoringSelectorSchema,
    hostMonitoringSummarySchema,
    hostMonitoringHistorySchema,
    saveHostMonitoringPolicySchema,
} from '@/lib/HostMonitoring/validation.ts'
import type {
    HostMonitoringSettings,
    HostMonitoringSummary,
    HostMonitoringPolicyView,
} from '@/lib/HostMonitoring/Types/host-monitoring.types.ts'
import { getAuthDatabase } from '@/server/Auth/Core/database.server.ts'
import type { AuthTransaction } from '@/server/Auth/Core/Types/database.types.ts'
import { requirePermissionService } from '@/server/Auth/Access/authorization.service.ts'
import { requirePermissionInTransaction } from '@/server/Auth/Access/rbac.service.ts'
import { readProxyHostSummariesInTransaction } from '@/server/Admin/ProxyHostManagement/proxy-hosts.service.ts'
import { lockProxyRuntimeSettings } from '@/server/ProxyRuntime/proxy-runtime-settings.ts'
import { appendAuditEventInTransactionService } from '@/server/Audit/audit.service.ts'
import { consumeRateLimit } from '@/server/Valkey/rate-limiter.service.ts'
import {
    lockHostMonitoringPolicy,
    readHostMonitoringPolicy,
    readHostMonitoringSummaries,
    readHostMonitoringHistory,
    saveHostMonitoringPolicy,
} from './host-monitoring.repository.ts'
import { HostMonitoringError } from './host-monitoring.errors.ts'
import type { HostMonitoringPolicy } from './Types/host-monitoring.repository.types.ts'
import type { HostMonitoringServiceDependencies } from './Types/host-monitoring-service.types.ts'

function policySettings(policy: HostMonitoringPolicy): HostMonitoringSettings {
    return {
        domain: policy.domain,
        enabled: policy.enabled,
        intervalSeconds: policy.intervalSeconds,
        timeoutMs: policy.timeoutMs,
        expectedStatus: policy.expectedStatus,
        failureThreshold: policy.failureThreshold,
        recoveryThreshold: policy.recoveryThreshold,
        retentionDays: policy.retentionDays,
        sampleLimit: policy.sampleLimit,
        incidentLimit: policy.incidentLimit,
    }
}

function policyView(
    policy: HostMonitoringPolicy,
    host: { enabled: boolean; domains: readonly string[] },
    now: Date,
): HostMonitoringPolicyView {
    const eligible = policy.enabled && host.enabled && host.domains.includes(policy.domain)
    return {
        id: policy.id,
        proxyHostId: policy.proxyHostId,
        version: policy.version,
        settings: policySettings(policy),
        state: policy.state,
        availability: !policy.enabled
            ? 'disabled'
            : !host.enabled
              ? 'host_disabled'
              : !host.domains.includes(policy.domain)
                ? 'domain_removed'
                : policy.lastCheckedAt === null
                  ? 'not_checked'
                  : now.getTime() - policy.lastCheckedAt.getTime() >
                      policy.intervalSeconds * 2_000 + policy.timeoutMs + 15_000
                    ? 'stale'
                    : policy.lastOutcome === 'unknown'
                      ? 'unknown'
                      : policy.state,
        lastCheckedAt: policy.lastCheckedAt,
        lastOutcome: policy.lastOutcome,
        lastCode: policy.lastCode,
        lastDurationMs: policy.lastDurationMs,
        lastHttpStatus: policy.lastHttpStatus,
        nextCheckAt: eligible ? policy.nextCheckAt : null,
        observationPoint: 'appliance',
        publicReachability: 'not_checked',
    }
}

async function readHost(transaction: AuthTransaction, actorId: string, proxyHostId: string) {
    await requirePermissionInTransaction(transaction, actorId, PERMISSIONS.PROXY_HOSTS_VIEW)
    const rows = await readProxyHostSummariesInTransaction(transaction, [proxyHostId])
    const host = rows.find((row) => row.id === proxyHostId)
    if (!host) throw new HostMonitoringError('host_not_found')
    return host
}

async function prepareTransaction(transaction: AuthTransaction): Promise<Date> {
    const timeout = `${HOST_MONITORING_LIMITS.transactionTimeoutMs}ms`
    await transaction.execute(
        sql`select set_config('statement_timeout', ${timeout}, true), set_config('lock_timeout', ${timeout}, true), set_config('transaction_timeout', ${timeout}, true)`,
    )
    const [clock] = await transaction.execute<{ now: string }>(
        sql`select clock_timestamp()::text as now`,
    )
    if (!clock) throw new Error('Monitoring clock unavailable.')
    return new Date(clock.now)
}

export function createHostMonitoringService(dependencies: HostMonitoringServiceDependencies) {
    return {
        async getSummary(raw: unknown): Promise<HostMonitoringSummary> {
            const input = hostMonitoringSummarySchema.safeParse(raw)
            if (!input.success) throw new HostMonitoringError('invalid_input')
            const actor = await dependencies.requireActor(PERMISSIONS.PROXY_HOSTS_VIEW)
            return dependencies.database().transaction(
                async (transaction) => {
                    const now = await prepareTransaction(transaction)
                    await requirePermissionInTransaction(
                        transaction,
                        actor.id,
                        PERMISSIONS.PROXY_HOSTS_VIEW,
                    )
                    const rows = await readHostMonitoringSummaries(
                        transaction,
                        input.data.proxyHostIds,
                    )
                    return {
                        checkedAt: now,
                        summaries: rows.map((row) => ({
                            proxyHostId: row.proxyHostId,
                            policy: row.policy
                                ? policyView(
                                      row.policy,
                                      {
                                          enabled: row.enabled,
                                          domains: row.domain ? [row.domain] : [],
                                      },
                                      now,
                                  )
                                : null,
                        })),
                    }
                },
                { isolationLevel: 'repeatable read', accessMode: 'read only' },
            )
        },
        async getPolicy(raw: unknown): Promise<HostMonitoringPolicyView | null> {
            const input = hostMonitoringSelectorSchema.safeParse(raw)
            if (!input.success) throw new HostMonitoringError('invalid_input')
            const actor = await dependencies.requireActor(PERMISSIONS.PROXY_HOSTS_VIEW)
            return dependencies.database().transaction(
                async (transaction) => {
                    const now = await prepareTransaction(transaction)
                    const host = await readHost(transaction, actor.id, input.data.proxyHostId)
                    const policy = await readHostMonitoringPolicy(transaction, host.id)
                    return policy ? policyView(policy, host, now) : null
                },
                { isolationLevel: 'repeatable read', accessMode: 'read only' },
            )
        },
        async getHistory(raw: unknown) {
            const input = hostMonitoringHistorySchema.safeParse(raw)
            if (!input.success) throw new HostMonitoringError('invalid_input')
            const actor = await dependencies.requireActor(PERMISSIONS.PROXY_HOSTS_VIEW)
            return dependencies.database().transaction(
                async (transaction) => {
                    await prepareTransaction(transaction)
                    const host = await readHost(transaction, actor.id, input.data.proxyHostId)
                    const policy = await readHostMonitoringPolicy(transaction, host.id)
                    if (!policy) return { observations: [], incidents: [], nextCursor: null }
                    const history = await readHostMonitoringHistory(transaction, policy.id, {
                        limit: input.data.limit,
                        status: input.data.status,
                        ...(input.data.since ? { since: new Date(input.data.since) } : {}),
                        ...(input.data.before
                            ? {
                                  before: {
                                      checkedAt: new Date(input.data.before.checkedAt),
                                      id: input.data.before.id,
                                  },
                              }
                            : {}),
                    })
                    const last = history.observations.at(-1)
                    return {
                        observations: history.observations,
                        incidents: history.incidents,
                        nextCursor:
                            history.hasMore && last
                                ? { checkedAt: last.checkedAt.toISOString(), id: last.id }
                                : null,
                    }
                },
                { isolationLevel: 'repeatable read', accessMode: 'read only' },
            )
        },
        async savePolicy(raw: unknown): Promise<HostMonitoringPolicyView> {
            const input = saveHostMonitoringPolicySchema.safeParse(raw)
            if (!input.success) throw new HostMonitoringError('invalid_input')
            const actor = await dependencies.requireActor(PERMISSIONS.PROXY_HOSTS_UPDATE)
            await dependencies.rateLimit(actor.id)
            return dependencies.database().transaction(async (transaction) => {
                const now = await prepareTransaction(transaction)
                await lockProxyRuntimeSettings(transaction)
                await requirePermissionInTransaction(
                    transaction,
                    actor.id,
                    PERMISSIONS.PROXY_HOSTS_UPDATE,
                )
                const host = await readHost(transaction, actor.id, input.data.proxyHostId)
                if (!host.domains.includes(input.data.settings.domain))
                    throw new HostMonitoringError('invalid_input')
                const existing = await lockHostMonitoringPolicy(transaction, host.id)
                if ((existing?.version ?? null) !== input.data.expectedVersion)
                    throw new HostMonitoringError('conflict')
                if (
                    existing &&
                    Object.entries(input.data.settings).every(
                        ([key, value]) => existing[key as keyof HostMonitoringSettings] === value,
                    )
                )
                    return policyView(existing, host, now)
                const policy = await saveHostMonitoringPolicy(transaction, {
                    proxyHostId: host.id,
                    settings: input.data.settings,
                    existing,
                    configuredBy: actor.id,
                })
                await appendAuditEventInTransactionService(transaction, {
                    actorKind: 'user',
                    actorUserId: actor.id,
                    action: 'update',
                    resource: 'host-monitoring',
                    targetId: host.id,
                    result: 'success',
                    metadata: { enabled: policy.enabled },
                })
                return policyView(policy, host, now)
            })
        },
    }
}

export const hostMonitoringService = createHostMonitoringService({
    database: getAuthDatabase,
    requireActor: requirePermissionService,
    rateLimit: async (actorId) => {
        await consumeRateLimit({ ...HOST_MONITORING_WRITE_RATE_LIMIT, identifier: actorId })
    },
})
