import '@tanstack/react-start/server-only'
import { ZodError } from 'zod'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import type { AuthTransaction } from '@/server/Auth/Core/Types/database.types.ts'
import type { DiscoveryRegistry } from '@/lib/DockerDiscovery/Types/management.types.ts'
import type { DockerDiscoverySnapshot } from '@/lib/DockerDiscovery/Types/docker-discovery.types.ts'
import { requirePermissionInTransaction } from '@/server/Auth/Access/rbac.service.ts'
import { AuthDomainError } from '@/server/Auth/Core/errors.server.ts'
import {
    createProxyHostInTransaction,
    updateProxyHostInTransaction,
} from '@/server/Admin/ProxyHostManagement/proxy-hosts.mutations.server.ts'
import { ProxyHostDomainError } from '@/server/Admin/ProxyHostManagement/proxy-hosts.errors.ts'
import { CertificateDomainError } from '@/server/Admin/CertificateManagement/certificates.errors.ts'
import {
    createDiscoveryPlan,
    discoveryEndpointHash,
    discoveryHash,
    discoverySourceKey,
} from './discovery-plan.ts'
import { runDiscoveryBatch } from './discovery-batch.ts'
import { readDiscoveryInventory } from './discovery-inventory.server.ts'
import { writeDiscoveryRegistry } from './discovery-storage.server.ts'
import { appendAuditEventInTransactionService } from '@/server/Audit/audit.service.ts'
import { readProxyRuntimeSnapshot } from '@/server/ProxyRuntime/proxy-runtime-data.ts'
import { ProxyRuntimeSnapshotError } from '@/server/ProxyRuntime/proxy-runtime-snapshot.ts'

export const discoveryReconcilePermissions = [
    PERMISSIONS.DOCKER_DISCOVERY_VIEW,
    PERMISSIONS.DOCKER_DISCOVERY_MANAGE,
    PERMISSIONS.PROXY_HOSTS_VIEW,
    PERMISSIONS.PROXY_HOSTS_CREATE,
    PERMISSIONS.PROXY_HOSTS_UPDATE,
    PERMISSIONS.PROXY_HOSTS_APPLY,
] as const

/** Revalidates the delegated actor's complete host-management grant in the write transaction. */
export async function requireDiscoveryReconcilePermissions(
    transaction: AuthTransaction,
    actorId: string,
): Promise<void> {
    const actor = await requirePermissionInTransaction(
        transaction,
        actorId,
        PERMISSIONS.DOCKER_DISCOVERY_MANAGE,
    )
    if (
        !discoveryReconcilePermissions.every((permission) => actor.permissions.includes(permission))
    )
        throw new AuthDomainError(
            'permission_denied',
            'Discovery reconciliation permission is required.',
        )
}

/** Synchronizes eligible sources; absent/stopped/unavailable sources never delete or disable hosts. */
export async function reconcileDiscoveryInTransaction(
    transaction: AuthTransaction,
    registry: DiscoveryRegistry,
    snapshot: DockerDiscoverySnapshot | null,
    progress: { afterKey: string | null } = { afterKey: null },
) {
    if (
        !registry.enabled ||
        !registry.actorUserId ||
        snapshot?.status !== 'ready' ||
        snapshot.stale ||
        snapshot.configuration.revision !== registry.connectorRevision ||
        !snapshot.configuration.settings.enabled ||
        !snapshot.configuration.settings.endpoint ||
        registry.endpointHash !== discoveryEndpointHash(snapshot.configuration.settings.endpoint)
    )
        return false
    const before = discoveryHash(registry)
    const actorId = registry.actorUserId
    try {
        await requireDiscoveryReconcilePermissions(transaction, actorId)
    } catch (error) {
        if (!(error instanceof AuthDomainError)) throw error
        registry.error = 'authorization_required'
        if (before !== discoveryHash(registry)) {
            registry.revision += 1
            await writeDiscoveryRegistry(transaction, registry)
        }
        return false
    }
    registry.error = null
    const inventory = await readDiscoveryInventory(transaction, snapshot)
    const plan = createDiscoveryPlan(snapshot, registry, inventory)
    const endpoint = snapshot.configuration.settings.endpoint
    const present = new Set(
        snapshot.candidates.map((candidate) =>
            discoverySourceKey(
                endpoint,
                candidate.sourceId ?? `container:${candidate.containerId}`,
            ),
        ),
    )
    const settled = new Set(plan.settled)
    const previous = new Map(
        registry.results
            .filter((result) => present.has(result.key) && !settled.has(result.key))
            .map((result) => [result.key, result]),
    )
    for (const candidate of snapshot.candidates) {
        const rejection = inventory.rejections?.[candidate.containerId]
        if (rejection) {
            const key = discoverySourceKey(
                endpoint,
                candidate.sourceId ?? `container:${candidate.containerId}`,
            )
            previous.set(key, { key, error: rejection })
        }
    }
    let changedHosts = false
    const batch = await runDiscoveryBatch(
        plan.changes,
        [...previous.values()],
        progress.afterKey,
        async (change) => {
            if (!change.candidate.sourceId) return 'reconcile_failed'
            if (!change.host && registry.owners.length >= 1024) {
                return 'owner_limit'
            }
            try {
                const host = await transaction.transaction(async (savepoint) => {
                    const saved = change.host
                        ? await updateProxyHostInTransaction(
                              savepoint,
                              actorId,
                              { ...change.input, proxyHostId: change.host.id },
                              change.key,
                          )
                        : await createProxyHostInTransaction(savepoint, actorId, change.input)
                    // Validate the combined typed Desired State before committing this candidate.
                    // Capacity, policy and TLS errors cannot strand the whole saved configuration.
                    await readProxyRuntimeSnapshot(savepoint)
                    return saved
                })
                const owner = registry.owners.find((entry) => entry.key === change.key)
                if (owner)
                    Object.assign(owner, {
                        containerId: change.candidate.containerId,
                        domains: [...host.domains],
                        state: 'managed',
                        error: null,
                    })
                else
                    registry.owners.push({
                        key: change.key,
                        sourceId: change.candidate.sourceId,
                        hostId: host.id,
                        containerId: change.candidate.containerId,
                        domains: [...host.domains],
                        state: 'managed',
                        error: null,
                    })
                changedHosts = true
                return null
            } catch (error) {
                // Unexpected storage failures roll back the complete outer transaction.
                const code =
                    error instanceof AuthDomainError
                        ? 'authorization_required'
                        : error instanceof CertificateDomainError
                          ? 'reference_invalid'
                          : error instanceof ProxyHostDomainError ||
                              error instanceof ProxyRuntimeSnapshotError ||
                              error instanceof ZodError
                            ? 'reconcile_failed'
                            : null
                if (!code) throw error
                return code
            }
        },
    )
    progress.afterKey = batch.afterKey
    registry.results = batch.results
    for (const owner of registry.owners) {
        const row = plan.rows.find((entry) => entry.key === owner.key)
        if (owner.state === 'detached') continue
        if (row?.state === 'orphaned') owner.state = 'orphaned'
        else if (row && row.state !== 'unavailable') {
            owner.state = 'managed'
            if (row.containerId) owner.containerId = row.containerId
        }
    }
    if (changedHosts) registry.runtimeStatus = 'pending'
    if (before !== discoveryHash(registry)) {
        registry.revision += 1
        await writeDiscoveryRegistry(transaction, registry)
        await appendAuditEventInTransactionService(transaction, {
            actorUserId: actorId,
            actorKind: 'user',
            action: 'update',
            resource: 'security-settings',
            targetId: null,
            result: registry.results.length ? 'failure' : 'success',
            metadata: { changedFields: ['dockerDiscovery'] },
        })
    }
    return changedHosts
}
