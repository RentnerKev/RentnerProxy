import '@tanstack/react-start/server-only'
import { eq, sql } from 'drizzle-orm'
import { systemSettings } from '@/db/schema.ts'
import { discoveryRegistrySchema } from '@/lib/DockerDiscovery/management.ts'
import type { DiscoveryRegistry } from '@/lib/DockerDiscovery/Types/management.types.ts'
import type { AuthTransaction } from '@/server/Auth/Core/Types/database.types.ts'
import { ProxyHostDomainError } from '@/server/Admin/ProxyHostManagement/proxy-hosts.errors.ts'

const SETTINGS_KEY = 'docker_discovery_management_v1'
function emptyDiscoveryRegistry(): DiscoveryRegistry {
    return {
        version: 1,
        revision: 0,
        enabled: false,
        actorUserId: null,
        connectorRevision: null,
        endpointHash: null,
        runtimeStatus: 'idle',
        error: null,
        owners: [],
        results: [],
    }
}
export async function readDiscoveryRegistry(
    transaction: AuthTransaction,
): Promise<DiscoveryRegistry> {
    const [row] = await transaction
        .select({ value: systemSettings.value })
        .from(systemSettings)
        .where(eq(systemSettings.key, SETTINGS_KEY))
        .limit(1)
    if (!row) return emptyDiscoveryRegistry()
    return discoveryRegistrySchema.parse(
        typeof row.value === 'string' ? JSON.parse(row.value) : row.value,
    )
}
// Callers hold lockProxyRuntimeSettings: ownership and host writes share one transaction/lock.
export async function writeDiscoveryRegistry(
    transaction: AuthTransaction,
    registry: DiscoveryRegistry,
): Promise<void> {
    const value = sql`${discoveryRegistrySchema.parse(registry)}`
    await transaction
        .insert(systemSettings)
        .values({ key: SETTINGS_KEY, value })
        .onConflictDoUpdate({
            target: systemSettings.key,
            set: { value, updatedAt: new Date() },
        })
}
export async function assertDiscoveryHostEditable(
    transaction: AuthTransaction,
    hostId: string,
    discoveryKey?: string,
): Promise<void> {
    const registry = await readDiscoveryRegistry(transaction)
    const owner = registry.owners.find(
        (entry) => entry.hostId === hostId && entry.state !== 'detached',
    )
    if (owner && owner.key !== discoveryKey)
        throw new ProxyHostDomainError(
            'discovery_managed',
            'Detach this host from Docker discovery before changing managed fields.',
        )
}
