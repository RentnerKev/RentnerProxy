import '@tanstack/react-start/server-only'
import { and, eq, gt, sql } from 'drizzle-orm'
import { HOST_MONITORING_LIMITS } from '@/config/host-monitoring.config.ts'
import { hostCheckPolicies } from '@/db/schema.ts'
import { getAuthDatabase } from '@/server/Auth/Core/database.server.ts'
import { inspectControllerDomain } from '@/server/Controller/domain-diagnostics.server.ts'
import { readHostMonitoringContextInTransaction } from '@/server/RuntimeDiagnostics/domain-diagnostics-data.ts'
import { DomainDiagnosticsError } from '@/server/RuntimeDiagnostics/domain-diagnostics.errors.ts'
import { createHostMonitoringWorker } from './host-monitoring.worker.ts'
import { createHostMonitoringProbe } from './host-monitoring.probe.ts'
import {
    claimDueHostMonitoringPolicy,
    completeHostMonitoringClaim,
    releaseHostMonitoringClaim,
    pruneHostMonitoringHistory,
} from './host-monitoring.repository.ts'

const runClaim = createHostMonitoringProbe({
    readContext: (claim) =>
        getAuthDatabase().transaction(
            async (transaction) => {
                const timeout = `${HOST_MONITORING_LIMITS.transactionTimeoutMs}ms`
                await transaction.execute(
                    sql`select set_config('statement_timeout', ${timeout}, true), set_config('lock_timeout', ${timeout}, true), set_config('transaction_timeout', ${timeout}, true)`,
                )
                const [current] = await transaction
                    .select({ id: hostCheckPolicies.id })
                    .from(hostCheckPolicies)
                    .where(
                        and(
                            eq(hostCheckPolicies.id, claim.policy.id),
                            eq(hostCheckPolicies.version, claim.policy.version),
                            eq(hostCheckPolicies.leaseToken, claim.leaseToken),
                            eq(hostCheckPolicies.enabled, true),
                            gt(hostCheckPolicies.leaseExpiresAt, sql`clock_timestamp()`),
                        ),
                    )
                    .limit(1)
                if (!current) return null
                try {
                    return await readHostMonitoringContextInTransaction(transaction, {
                        hostType: 'proxy',
                        hostId: claim.policy.proxyHostId,
                        domain: claim.policy.domain,
                    })
                } catch (error) {
                    if (error instanceof DomainDiagnosticsError && error.code === 'invalid_input')
                        return null
                    throw error
                }
            },
            { isolationLevel: 'repeatable read', accessMode: 'read only' },
        ),
    inspect: inspectControllerDomain,
    complete: (claim, outcome, before) =>
        completeHostMonitoringClaim(
            claim,
            outcome,
            async (transaction, policy) => {
                try {
                    const after = await readHostMonitoringContextInTransaction(transaction, {
                        hostType: 'proxy',
                        hostId: policy.proxyHostId,
                        domain: policy.domain,
                    })
                    return (
                        after.enabled &&
                        after.proof === before.proof &&
                        after.revision === before.revision
                    )
                } catch (error) {
                    if (error instanceof DomainDiagnosticsError && error.code === 'invalid_input')
                        return false
                    throw error
                }
            },
            before.availability,
        ),
    release: releaseHostMonitoringClaim,
})

export const hostMonitoringWorker = createHostMonitoringWorker({
    claim: claimDueHostMonitoringPolicy,
    runClaim,
    releaseCancelled: async (claim) => {
        await releaseHostMonitoringClaim(claim)
    },
    prune: pruneHostMonitoringHistory,
    unavailable: () =>
        console.warn('[host-monitoring] Worker temporarily unavailable.', {
            retryMs: HOST_MONITORING_LIMITS.pollIntervalMs,
        }),
})
