import '@tanstack/react-start/server-only'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import {
    UPSTREAM_HEALTH_OBSERVATION_MAX_AGE_MS,
    UPSTREAM_HEALTH_OBSERVATION_FUTURE_TOLERANCE_MS,
} from '@/config/upstream-pools.config.ts'
import { proxyHostIdInputSchema } from '@/features/Admin/ProxyHostManagement/validation.ts'
import type { ProxyHostUpstreamHealth } from '@/lib/ProxyRuntime/Types/upstream-health.types.ts'
import { proxyHostUpstreamHealthSchema } from '@/lib/ProxyRuntime/upstreamHealth.ts'
import { requirePermissionService } from '@/server/Auth/Access/authorization.service.ts'
import { requirePermissionInTransaction } from '@/server/Auth/Access/rbac.service.ts'
import { getAuthDatabase } from '@/server/Auth/Core/database.server.ts'
import { getProxyHostUpstreamHealth } from '@/server/Controller/proxy.server.ts'
import {
    readProxyRuntimeHost,
    readProxyRuntimeSnapshot,
} from '@/server/ProxyRuntime/proxy-runtime-data.ts'
import { ProxyHostDomainError } from './proxy-hosts.errors.ts'
import type {
    UpstreamHealthDesiredState,
    UpstreamHealthReaderDependencies,
} from './Types/upstream-health.types.ts'

/**
 * Builds an unknown view from desired members without retaining an old observation.
 * Null revision/timestamp and unknown member states prevent a failed or stale read
 * from looking like a current healthy sample.
 */
function unknownHealth(desired: UpstreamHealthDesiredState): ProxyHostUpstreamHealth {
    return {
        hostId: desired.hostId,
        revision: null,
        observedAt: null,
        state: 'unknown',
        members: desired.members.map((member, index) => ({
            index,
            host: member.host,
            port: member.port,
            state: 'unknown',
        })),
    }
}

/**
 * Creates an uncached reader that authorizes before loading desired state and
 * re-reads it after controller I/O. Observations must match the current full
 * revision and every ordered index/host/port tuple, have a consistent aggregate
 * state, and be at most 30 seconds old or 5 seconds ahead. Failures and mismatches
 * return desired-member unknown views; permission errors remain errors.
 */
export function createProxyHostUpstreamHealthReader(
    dependencies: UpstreamHealthReaderDependencies,
) {
    return async (proxyHostId: string): Promise<ProxyHostUpstreamHealth> => {
        const actorId = await dependencies.authorize()
        const id = proxyHostIdInputSchema.parse({ proxyHostId }).proxyHostId.toLowerCase()
        const desired = await dependencies.readDesired(id, actorId)
        if (!desired.enabled || !desired.hasPool) return unknownHealth(desired)
        const health = await dependencies.readHealth(id).catch(() => null)
        // Re-read the desired revision after I/O so a concurrent save cannot publish stale health.
        const current = await dependencies.readDesired(id, actorId)
        const parsed = proxyHostUpstreamHealthSchema.safeParse(health)
        if (
            !parsed.success ||
            current.revision !== desired.revision ||
            !current.enabled ||
            !current.hasPool
        )
            return unknownHealth(current)
        const result = parsed.data
        const observedAt = result.observedAt === null ? NaN : Date.parse(result.observedAt)
        const age = dependencies.now() - observedAt
        if (
            result.hostId !== current.hostId ||
            result.revision !== current.revision ||
            !Number.isFinite(age) ||
            age > UPSTREAM_HEALTH_OBSERVATION_MAX_AGE_MS ||
            age < -UPSTREAM_HEALTH_OBSERVATION_FUTURE_TOLERANCE_MS ||
            result.members.length !== current.members.length ||
            result.members.some(
                (member, index) =>
                    member.index !== index ||
                    member.host !== current.members[index]?.host ||
                    member.port !== current.members[index]?.port,
            )
        )
            return unknownHealth(current)
        const derivedState = result.members.some((member) => member.state === 'available')
            ? 'available'
            : result.members.length > 0 &&
                result.members.every((member) => member.state === 'unavailable')
              ? 'all_unavailable'
              : 'unknown'
        if (derivedState !== result.state) return unknownHealth(current)
        return result
    }
}

/**
 * Binds health reads to VIEW permission, without requiring edit permission.
 * Each desired-state read reauthorizes inside a repeatable-read transaction and
 * pairs host settings with the full desired runtime revision from that snapshot.
 */
export const getProxyHostUpstreamHealthService = createProxyHostUpstreamHealthReader({
    authorize: async () => (await requirePermissionService(PERMISSIONS.PROXY_HOSTS_VIEW)).id,
    readDesired: (id, actorId) =>
        getAuthDatabase().transaction(
            async (transaction) => {
                await requirePermissionInTransaction(
                    transaction,
                    actorId,
                    PERMISSIONS.PROXY_HOSTS_VIEW,
                )
                const host = await readProxyRuntimeHost(transaction, id)
                if (!host)
                    throw new ProxyHostDomainError(
                        'proxy_host_not_found',
                        'Proxy host was not found.',
                    )
                const snapshot = await readProxyRuntimeSnapshot(transaction)
                return {
                    hostId: id,
                    enabled: host.enabled,
                    hasPool: host.upstreamPool !== undefined,
                    revision: snapshot.revision,
                    members: host.upstreamPool?.members ?? [
                        { host: host.forwardHost, port: host.forwardPort },
                    ],
                }
            },
            { isolationLevel: 'repeatable read', accessMode: 'read only' },
        ),
    readHealth: getProxyHostUpstreamHealth,
    now: Date.now,
})
