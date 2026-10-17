import '@tanstack/react-start/server-only'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { DOCKER_DISCOVERY_MUTATION_RATE_LIMIT } from '@/config/docker-discovery.config.ts'
import {
    discoveryActionSchema,
    discoveryConnectSchema,
    discoveryInspectSchema,
} from '@/lib/DockerDiscovery/management.ts'
import type {
    DiscoveryAction,
    DiscoveryConnect,
    DiscoveryInspect,
    DiscoveryOverview,
    DiscoveryRegistry,
} from '@/lib/DockerDiscovery/Types/management.types.ts'
import { requirePermissionService } from '@/server/Auth/Access/authorization.service.ts'
import { requirePermissionInTransaction } from '@/server/Auth/Access/rbac.service.ts'
import { getAuthDatabase } from '@/server/Auth/Core/database.server.ts'
import { lockProxyRuntimeSettings } from '@/server/ProxyRuntime/proxy-runtime-settings.ts'
import { consumeRateLimit } from '@/server/Valkey/rate-limiter.service.ts'
import { dockerDiscoveryController } from '@/server/Controller/docker-discovery.server.ts'
import {
    appendAuditEventInTransactionService,
    recordAuditEventBestEffortService,
} from '@/server/Audit/audit.service.ts'
import { readDiscoveryRegistry, writeDiscoveryRegistry } from './discovery-storage.server.ts'
import { createDiscoveryPlan, discoveryEndpointHash } from './discovery-plan.ts'
import { readDiscoveryInventory } from './discovery-inventory.server.ts'
import { DockerDiscoveryError } from './docker-discovery.errors.ts'
import { requireDiscoveryReconcilePermissions } from './discovery-reconcile.server.ts'
import { dockerDiscoveryWorker } from './discovery-worker.ts'

async function authorize(manage = false) {
    const actor = await requirePermissionService(PERMISSIONS.DOCKER_DISCOVERY_VIEW)
    await requirePermissionService(PERMISSIONS.PROXY_HOSTS_VIEW)
    if (manage) {
        await requirePermissionService(PERMISSIONS.DOCKER_DISCOVERY_MANAGE)
        await consumeRateLimit({ ...DOCKER_DISCOVERY_MUTATION_RATE_LIMIT, identifier: actor.id })
    }
    return actor
}
async function auditMutationFailure<T>(
    actorUserId: string,
    operation: () => Promise<T>,
): Promise<T> {
    try {
        return await operation()
    } catch (error) {
        await recordAuditEventBestEffortService({
            actorUserId,
            actorKind: 'user',
            action: 'update',
            resource: 'security-settings',
            targetId: null,
            result: 'failure',
            metadata: { changedFields: ['dockerDiscovery'] },
        })
        throw error
    }
}
function overviewManagement(registry: DiscoveryRegistry): DiscoveryOverview['management'] {
    return {
        version: registry.version,
        revision: registry.revision,
        enabled: registry.enabled,
        connectorRevision: registry.connectorRevision,
        runtimeStatus: registry.runtimeStatus,
        error: registry.error,
    }
}
/** Returns candidate plans, never secrets, host private configuration or the delegated actor. */
export async function getDiscoveryOverviewService(): Promise<DiscoveryOverview> {
    await authorize()
    const snapshot = await dockerDiscoveryController.status().catch(() => null)
    return getAuthDatabase().transaction(
        async (transaction) => {
            const registry = await readDiscoveryRegistry(transaction)
            const plan = createDiscoveryPlan(
                snapshot,
                registry,
                await readDiscoveryInventory(transaction, snapshot),
            )
            return {
                snapshot,
                management: overviewManagement(registry),
                rows: plan.rows,
                previewToken: plan.previewToken,
                changes: {
                    create: plan.changes.filter((change) => !change.host).length,
                    update: plan.changes.filter((change) => change.host !== null).length,
                },
            }
        },
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
    )
}
export async function inspectDiscoveryService(input: DiscoveryInspect) {
    const actor = await authorize(true)
    const parsed = discoveryInspectSchema.safeParse(input)
    if (!parsed.success) throw new DockerDiscoveryError('invalid_input')
    return dockerDiscoveryController.inspect({ ...parsed.data, actorUserId: actor.id })
}
/** Connection saves pause host synchronization, so changing endpoints always requires a new review. */
export async function connectDiscoveryService(input: DiscoveryConnect) {
    const actor = await authorize(true)
    const parsed = discoveryConnectSchema.safeParse(input)
    if (!parsed.success) throw new DockerDiscoveryError('invalid_input')
    return auditMutationFailure(actor.id, () =>
        getAuthDatabase().transaction(async (transaction) => {
            await lockProxyRuntimeSettings(transaction)
            await requirePermissionInTransaction(
                transaction,
                actor.id,
                PERMISSIONS.DOCKER_DISCOVERY_MANAGE,
            )
            const registry = await readDiscoveryRegistry(transaction)
            if (registry.revision !== parsed.data.expectedRevision)
                throw new DockerDiscoveryError('conflict')
            const saved = await dockerDiscoveryController.save({
                expectedRevision: parsed.data.connectorRevision,
                actorUserId: actor.id,
                configuration: { enabled: true, endpoint: parsed.data.endpoint },
                acknowledgeRestore: parsed.data.acknowledgeRestore,
            })
            registry.enabled = false
            registry.actorUserId = null
            registry.connectorRevision = saved.configuration.revision
            registry.endpointHash = discoveryEndpointHash(parsed.data.endpoint)
            registry.error = null
            registry.results = []
            registry.revision += 1
            await writeDiscoveryRegistry(transaction, registry)
            await appendAuditEventInTransactionService(transaction, {
                actorUserId: actor.id,
                actorKind: 'user',
                action: 'update',
                resource: 'security-settings',
                targetId: null,
                result: 'success',
                metadata: { changedFields: ['dockerDiscovery'] },
            })
            return { revision: registry.revision }
        }),
    )
}
/** Revision-checked activation/detachment; management acknowledgments contain no source metadata. */
export async function changeDiscoveryService(input: DiscoveryAction) {
    const actor = await authorize(true)
    const parsed = discoveryActionSchema.safeParse(input)
    if (!parsed.success) throw new DockerDiscoveryError('invalid_input')
    const acknowledgment = await auditMutationFailure(actor.id, () =>
        getAuthDatabase().transaction(async (transaction) => {
            await lockProxyRuntimeSettings(transaction)
            await requirePermissionInTransaction(
                transaction,
                actor.id,
                PERMISSIONS.DOCKER_DISCOVERY_MANAGE,
            )
            const registry = await readDiscoveryRegistry(transaction)
            if (registry.revision !== parsed.data.expectedRevision)
                throw new DockerDiscoveryError('conflict')
            switch (parsed.data.action) {
                case 'enable': {
                    await requireDiscoveryReconcilePermissions(transaction, actor.id)
                    const snapshot = await dockerDiscoveryController.status()
                    if (
                        snapshot.status !== 'ready' ||
                        snapshot.stale ||
                        !snapshot.configuration.settings.endpoint ||
                        !snapshot.configuration.settings.enabled
                    )
                        throw new DockerDiscoveryError('endpoint_unavailable')
                    const plan = createDiscoveryPlan(
                        snapshot,
                        registry,
                        await readDiscoveryInventory(transaction, snapshot),
                    )
                    if (plan.previewToken !== parsed.data.previewToken)
                        throw new DockerDiscoveryError('conflict')
                    registry.enabled = true
                    registry.actorUserId = actor.id
                    registry.connectorRevision = snapshot.configuration.revision
                    registry.endpointHash = discoveryEndpointHash(
                        snapshot.configuration.settings.endpoint,
                    )
                    registry.error = null
                    break
                }
                case 'disable':
                    registry.enabled = false
                    registry.error = null
                    break
                case 'detach': {
                    await requirePermissionInTransaction(
                        transaction,
                        actor.id,
                        PERMISSIONS.PROXY_HOSTS_UPDATE,
                    )
                    const owner = registry.owners.find(
                        (entry) => entry.key === parsed.data.key && entry.state !== 'detached',
                    )
                    if (!owner) throw new DockerDiscoveryError('conflict')
                    owner.state = 'detached'
                    owner.error = null
                    registry.results = registry.results.filter((entry) => entry.key !== owner.key)
                    break
                }
                case 'retry': {
                    if (registry.enabled)
                        await requireDiscoveryReconcilePermissions(transaction, actor.id)
                    const snapshot = await dockerDiscoveryController.status()
                    if (!snapshot.configuration.settings.enabled)
                        throw new DockerDiscoveryError('invalid_input')
                    const saved = await dockerDiscoveryController.save({
                        expectedRevision: snapshot.configuration.revision,
                        actorUserId: actor.id,
                        configuration: snapshot.configuration.settings,
                        acknowledgeRestore: false,
                    })
                    registry.connectorRevision = saved.configuration.revision
                    registry.error = null
                    break
                }
            }
            registry.revision += 1
            await writeDiscoveryRegistry(transaction, registry)
            await appendAuditEventInTransactionService(transaction, {
                actorUserId: actor.id,
                actorKind: 'user',
                action: 'update',
                resource: 'security-settings',
                targetId: null,
                result: 'success',
                metadata: { changedFields: ['dockerDiscovery'] },
            })
            return { revision: registry.revision }
        }),
    )
    void dockerDiscoveryWorker.trigger()
    return acknowledgment
}
