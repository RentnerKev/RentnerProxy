import type { DockerDiscoverySnapshot } from '@/lib/DockerDiscovery/Types/docker-discovery.types.ts'
import type {
    DiscoveryCandidate,
    DiscoveryRegistry,
    DiscoveryOverview,
} from '@/lib/DockerDiscovery/Types/management.types.ts'
import type { ProxyHostSummary } from '@/lib/Admin/ProxyHostManagement/Types/proxy-hosts.types.ts'
export const DISCOVERY_ACTOR = '0198d98a-0000-7000-8000-000000000001'
export const DISCOVERY_HOST = '0198d98a-0000-7000-8000-000000000002'
export function discoveryRegistry(overrides: Partial<DiscoveryRegistry> = {}): DiscoveryRegistry {
    return {
        version: 1,
        revision: 0,
        enabled: false,
        actorUserId: null,
        connectorRevision: null,
        endpointHash: null,
        runtimeStatus: 'idle',
        error: null,
        results: [],
        owners: [],
        ...overrides,
    }
}
export function discoveryCandidate(
    overrides: Partial<DiscoveryCandidate> = {},
): DiscoveryCandidate {
    return {
        containerId: 'a'.repeat(64),
        sourceId: 'compose:example/app',
        domains: ['app.example.com'],
        target: { scheme: 'http', address: '172.22.0.5', port: 8080, network: 'proxy' },
        certificateId: null,
        accessPolicyId: null,
        upstreamTlsServerName: null,
        issues: [],
        ...overrides,
    }
}
export function discoverySnapshot(
    candidates = [discoveryCandidate()],
    overrides: Partial<DockerDiscoverySnapshot> = {},
): DockerDiscoverySnapshot {
    return {
        configuration: {
            version: 1,
            revision: 1,
            settings: { enabled: true, endpoint: 'http://docker-proxy:2375' },
        },
        status: 'ready',
        stale: false,
        error: null,
        candidates,
        ...overrides,
    }
}
export function discoveryOverview(
    candidates = [discoveryCandidate()],
    overrides: Partial<DiscoveryOverview> = {},
): DiscoveryOverview {
    return {
        changes: { create: candidates.length, update: 0 },
        snapshot: discoverySnapshot(candidates),
        management: {
            version: 1,
            revision: 0,
            enabled: false,
            connectorRevision: 1,
            runtimeStatus: 'idle',
            error: null,
        },
        rows: candidates.map((candidate, index) => ({
            key: index.toString(16).padStart(64, '0'),
            sourceId: candidate.sourceId ?? `invalid:${candidate.containerId}`,
            containerId: candidate.containerId,
            hostId: null,
            domains: candidate.domains,
            target: candidate.target,
            state: 'create',
            issues: candidate.issues,
        })),
        previewToken: 'c'.repeat(64),
        ...overrides,
    }
}
export function discoveredHost(overrides: Partial<ProxyHostSummary> = {}): ProxyHostSummary {
    return {
        id: DISCOVERY_HOST,
        domains: ['app.example.com'],
        enabled: true,
        forwardScheme: 'http',
        forwardHost: '172.22.0.5',
        forwardPort: 8080,
        certificateId: null,
        accessPolicyId: null,
        forceHttps: false,
        verifyUpstreamTls: true,
        upstreamTlsServerName: null,
        trustedCaId: null,
        createdAt: new Date('2026-10-17T00:00:00Z'),
        updatedAt: new Date('2026-10-17T00:00:00Z'),
        ...overrides,
    }
}
