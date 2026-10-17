import type {
    DiscoveryRegistry,
    DiscoveryRow,
    DiscoveryCandidate,
} from '@/lib/DockerDiscovery/Types/management.types.ts'
import type { DockerDiscoverySnapshot } from '@/lib/DockerDiscovery/Types/docker-discovery.types.ts'
import type { DiscoveryInventory, DiscoveryPlan } from './Types/discovery-plan.types.ts'
import { createProxyHostInputSchema } from '@/features/Admin/ProxyHostManagement/validation.ts'

export function discoveryHash(value: unknown): string {
    return new Bun.CryptoHasher('sha256').update(JSON.stringify(value)).digest('hex')
}
export function discoveryEndpointHash(endpoint: string): string {
    return discoveryHash(new URL(endpoint).origin)
}
export function discoverySourceKey(endpoint: string, sourceId: string): string {
    return discoveryHash([discoveryEndpointHash(endpoint), sourceId])
}
export function candidateHostInput(
    candidate: DiscoveryCandidate,
    host: DiscoveryInventory['hosts'][number] | null,
) {
    return createProxyHostInputSchema.safeParse({
        domains: candidate.domains,
        forwardScheme: candidate.target?.scheme,
        forwardHost: candidate.target?.address,
        forwardPort: candidate.target?.port,
        certificateId: candidate.certificateId,
        accessPolicyId: candidate.accessPolicyId,
        enabled: host?.enabled ?? true,
        forceHttps: host?.forceHttps ?? false,
        verifyUpstreamTls: true,
        upstreamTlsServerName: candidate.upstreamTlsServerName,
        trustedCaId: host?.trustedCaId ?? null,
    })
}
export function createDiscoveryPlan(
    snapshot: DockerDiscoverySnapshot | null,
    registry: DiscoveryRegistry,
    inventory: DiscoveryInventory,
): DiscoveryPlan {
    const rows: DiscoveryRow[] = []
    const changes: DiscoveryPlan['changes'][number][] = []
    const observed = new Set<string>()
    const endpoint = snapshot?.configuration.settings.endpoint
    const complete = snapshot?.status === 'ready' && !snapshot.stale && Boolean(endpoint)
    const hosts = new Map(inventory.hosts.map((host) => [host.id, host]))
    const occupied = new Map(inventory.domains.map((entry) => [entry.domain, entry.proxyHostId]))
    const counts = new Map<string, number>()
    for (const candidate of snapshot?.candidates ?? []) {
        if (candidate.sourceId)
            counts.set(candidate.sourceId, (counts.get(candidate.sourceId) ?? 0) + 1)
    }
    for (const candidate of snapshot?.candidates ?? []) {
        const sourceId = candidate.sourceId ?? `container:${candidate.containerId}`
        const key = discoverySourceKey(endpoint ?? 'http://unavailable.invalid', sourceId)
        observed.add(key)
        const owner = registry.owners.find((entry) => entry.key === key)
        const host = owner ? (hosts.get(owner.hostId) ?? null) : null
        const issues: string[] = [...candidate.issues]
        if (!candidate.sourceId && !issues.includes('invalid_source')) issues.push('invalid_source')
        const rejection = inventory.rejections?.[candidate.containerId]
        if (rejection) issues.push(rejection)
        if (
            candidate.sourceId &&
            (counts.get(candidate.sourceId) ?? 0) > 1 &&
            !issues.includes('source_conflict')
        )
            issues.push('source_conflict')
        if (
            candidate.domains.some(
                (domain) => occupied.has(domain) && occupied.get(domain) !== owner?.hostId,
            )
        )
            issues.push('domain_conflict')
        if (owner && !host && owner.state !== 'detached') issues.push('host_missing')
        const input = candidateHostInput(candidate, host)
        if (!input.success && issues.length === 0) issues.push('invalid_input')
        let state: DiscoveryRow['state'] = !complete
            ? 'unavailable'
            : owner?.state === 'detached'
              ? 'detached'
              : issues.includes('container_not_running') &&
                  issues.every((issue) =>
                      ['container_not_running', 'missing_address', 'missing_network'].includes(
                          issue,
                      ),
                  )
                ? 'stopped'
                : issues.length > 0
                  ? 'conflicted'
                  : !host
                    ? 'create'
                    : 'current'
        if (input.success && state === 'current' && host) {
            const desired = input.data
            if (
                JSON.stringify(host.domains.toSorted()) !==
                    JSON.stringify(desired.domains.toSorted()) ||
                host.forwardHost !== desired.forwardHost ||
                host.forwardPort !== desired.forwardPort ||
                host.forwardScheme !== desired.forwardScheme ||
                host.certificateId !== desired.certificateId ||
                (host.accessPolicyId ?? null) !== desired.accessPolicyId ||
                host.upstreamTlsServerName !== desired.upstreamTlsServerName ||
                !host.verifyUpstreamTls
            )
                state = 'update'
        }
        if (input.success && (state === 'create' || state === 'update'))
            changes.push({ key, candidate, host, input: input.data })
        // Errors from reference validation remain visible until a successful retry.
        const error = registry.results.find((entry) => entry.key === key)?.error ?? owner?.error
        if (error && !issues.includes(error)) issues.push(error)
        rows.push({
            key,
            sourceId,
            containerId: candidate.containerId,
            hostId: owner?.hostId ?? null,
            domains: candidate.domains,
            target: candidate.target,
            state: error && ['current', 'create', 'update'].includes(state) ? 'conflicted' : state,
            issues,
        })
    }
    for (const owner of registry.owners) {
        if (observed.has(owner.key)) continue
        rows.push({
            key: owner.key,
            sourceId: owner.sourceId,
            containerId: owner.containerId,
            hostId: owner.hostId,
            domains: owner.domains,
            target: null,
            state:
                owner.state === 'detached'
                    ? 'detached'
                    : complete &&
                        endpoint &&
                        owner.key === discoverySourceKey(endpoint, owner.sourceId)
                      ? 'orphaned'
                      : 'unavailable',
            issues: owner.error ? [owner.error] : [],
        })
    }
    rows.sort(
        (a, b) =>
            a.key.localeCompare(b.key) || (a.containerId ?? '').localeCompare(b.containerId ?? ''),
    )
    return {
        rows,
        changes,
        previewToken: discoveryHash({
            configuration: snapshot?.configuration,
            status: snapshot?.status,
            stale: snapshot?.stale,
            candidates: snapshot?.candidates,
            registry,
            hosts: inventory.hosts.map((host) => ({ ...host, certificateJob: undefined })),
            occupied: inventory.domains,
            rejections: inventory.rejections,
        }),
    }
}
