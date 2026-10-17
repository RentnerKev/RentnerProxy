// oxlint-disable-next-line import/no-unassigned-import -- The lifecycle must only run on the server.
import '@tanstack/react-start/server-only'
import { sql } from 'drizzle-orm'
import { getAuthDatabase } from '@/server/Auth/Core/database.server.ts'
import { lockProxyRuntimeSettings } from '@/server/ProxyRuntime/proxy-runtime-settings.ts'
import { reconcileProxyConfigurationService } from '@/server/ProxyRuntime/proxy-runtime.service.ts'
import { dockerDiscoveryController } from '@/server/Controller/docker-discovery.server.ts'
import { publishApplicationChange } from '@/server/WebSockets/applicationChanges.ts'
import { readDiscoveryRegistry, writeDiscoveryRegistry } from './discovery-storage.server.ts'
import { reconcileDiscoveryInTransaction } from './discovery-reconcile.server.ts'
import { appendAuditEventInTransactionService } from '@/server/Audit/audit.service.ts'

/** One bounded reconciliation at a time; interval ticks never accumulate background work. */
export function createDiscoveryWorker(step: () => Promise<void>, intervalMs = 2_000) {
    let timer: ReturnType<typeof setInterval> | null = null
    let flight: Promise<void> | null = null
    let stopped = false
    let unavailable = false
    function trigger(): Promise<void> {
        if (stopped) return Promise.resolve()
        if (flight) return flight
        flight = step()
            .then(() => {
                unavailable = false
            })
            .catch(() => {
                if (!unavailable)
                    console.warn('[docker-discovery] reconciliation unavailable; retrying')
                unavailable = true
            })
            .finally(() => {
                flight = null
            })
        return flight
    }
    return {
        trigger,
        start() {
            if (timer || stopped) return
            timer = setInterval(() => {
                void trigger()
            }, intervalMs)
            timer.unref?.()
            void trigger()
        },
        async stop() {
            stopped = true
            if (timer) clearInterval(timer)
            timer = null
            await flight
        },
    }
}
let offset = 0
async function runDiscoveryCycle(): Promise<void> {
    // Disabled discovery makes no controller/Docker requests and never adopts existing hosts.
    const stored = await getAuthDatabase().transaction(readDiscoveryRegistry, {
        accessMode: 'read only',
    })
    if (!stored.enabled) return
    const snapshot = await dockerDiscoveryController.status()
    const result = await getAuthDatabase().transaction(async (transaction) => {
        await transaction.execute(sql`set local lock_timeout = '5s'`)
        await transaction.execute(sql`set local statement_timeout = '20s'`)
        await lockProxyRuntimeSettings(transaction)
        const registry = await readDiscoveryRegistry(transaction)
        const changed = await reconcileDiscoveryInTransaction(
            transaction,
            registry,
            snapshot,
            offset,
        )
        offset = (offset + 16) % 65_536
        return {
            revision: registry.revision,
            enabled: registry.enabled,
            pending: changed || registry.runtimeStatus === 'pending',
        }
    })
    if (!result.enabled || !result.pending) return
    const runtimeStatus = await reconcileProxyConfigurationService()
    if (runtimeStatus === 'applied') {
        await getAuthDatabase().transaction(async (transaction) => {
            await lockProxyRuntimeSettings(transaction)
            const registry = await readDiscoveryRegistry(transaction)
            if (registry.revision !== result.revision) return
            registry.runtimeStatus = 'applied'
            registry.revision += 1
            await writeDiscoveryRegistry(transaction, registry)
            await appendAuditEventInTransactionService(transaction, {
                actorUserId: registry.actorUserId,
                actorKind: 'user',
                action: 'apply',
                resource: 'proxy-runtime',
                targetId: null,
                result: 'success',
                metadata: { runtimeStatus: 'applied' },
            })
        })
    }
    publishApplicationChange()
}
async function recordDiscoveryFailure(): Promise<void> {
    await getAuthDatabase().transaction(async (transaction) => {
        await transaction.execute(sql`set local lock_timeout = '5s'`)
        await lockProxyRuntimeSettings(transaction)
        const registry = await readDiscoveryRegistry(transaction)
        if (!registry.enabled || registry.error === 'reconcile_failed') return
        registry.error = 'reconcile_failed'
        registry.revision += 1
        await writeDiscoveryRegistry(transaction, registry)
        await appendAuditEventInTransactionService(transaction, {
            actorUserId: registry.actorUserId,
            actorKind: 'user',
            action: 'update',
            resource: 'security-settings',
            targetId: null,
            result: 'failure',
            metadata: { changedFields: ['dockerDiscovery'] },
        })
    })
    publishApplicationChange()
}
export const dockerDiscoveryWorker = createDiscoveryWorker(async () => {
    try {
        await runDiscoveryCycle()
    } catch (error) {
        await recordDiscoveryFailure().catch(() => undefined)
        throw error
    }
})
