import { expect, test } from 'bun:test'
import {
    createDiscoveryPlan,
    discoverySourceKey,
} from '@/server/Admin/DockerDiscovery/discovery-plan.ts'
import {
    discoveryActionSchema,
    discoveryConnectSchema,
    discoveryRegistrySchema,
} from '@/lib/DockerDiscovery/management.ts'
import {
    discoveryRegistry,
    discoveryCandidate,
    discoverySnapshot,
    discoveredHost,
    DISCOVERY_HOST,
} from '@/tests/Helpers/discoveryFixture.ts'

const endpoint = 'http://docker-proxy:2375'
function owned() {
    return discoveryRegistry({
        owners: [
            {
                key: discoverySourceKey(endpoint, 'compose:example/app'),
                sourceId: 'compose:example/app',
                hostId: DISCOVERY_HOST,
                containerId: 'a'.repeat(64),
                domains: ['app.example.com'],
                state: 'managed',
                error: null,
            },
        ],
    })
}
const empty = { hosts: [], domains: [] }
test('preview creates eligible explicitly labeled candidates and is deterministic', () => {
    const a = createDiscoveryPlan(discoverySnapshot(), discoveryRegistry(), empty)
    expect(a.rows[0]?.state).toBe('create')
    expect(a.changes[0]?.input).toMatchObject({
        enabled: true,
        forwardHost: '172.22.0.5',
        verifyUpstreamTls: true,
    })
    expect(a).toEqual(createDiscoveryPlan(discoverySnapshot(), discoveryRegistry(), empty))
})
test('manual proxy hosts and redirect domains are never adopted or overwritten', () => {
    for (const proxyHostId of [DISCOVERY_HOST, null]) {
        const plan = createDiscoveryPlan(discoverySnapshot(), discoveryRegistry(), {
            hosts: [discoveredHost()],
            domains: [{ domain: 'app.example.com', proxyHostId }],
        })
        expect(plan.changes).toHaveLength(0)
        expect(plan.rows[0]).toMatchObject({
            state: 'conflicted',
            issues: ['domain_conflict'],
            hostId: null,
        })
    }
})
test('container recreation updates the same host and preserves a manual disabled state', () => {
    const plan = createDiscoveryPlan(
        discoverySnapshot([
            discoveryCandidate({
                containerId: 'b'.repeat(64),
                target: { scheme: 'http', address: '172.22.0.9', port: 8080, network: 'proxy' },
            }),
        ]),
        owned(),
        {
            hosts: [discoveredHost({ enabled: false })],
            domains: [{ domain: 'app.example.com', proxyHostId: DISCOVERY_HOST }],
        },
    )
    expect(plan.rows[0]?.state).toBe('update')
    expect(plan.changes[0]?.host?.id).toBe(DISCOVERY_HOST)
    expect(plan.changes[0]?.input.enabled).toBe(false)
})
test('an unchanged owned host produces no database write or runtime reload', () => {
    const plan = createDiscoveryPlan(discoverySnapshot(), owned(), {
        hosts: [discoveredHost()],
        domains: [{ domain: 'app.example.com', proxyHostId: DISCOVERY_HOST }],
    })
    expect(plan.rows[0]?.state).toBe('current')
    expect(plan.changes).toHaveLength(0)
})
test('stopped containers, incomplete snapshots and unavailable endpoints never delete or disable hosts', () => {
    for (const snapshot of [
        null,
        discoverySnapshot([], { status: 'unavailable', stale: true }),
        discoverySnapshot([
            discoveryCandidate({
                issues: ['container_not_running', 'missing_address'],
                target: null,
            }),
        ]),
    ]) {
        const plan = createDiscoveryPlan(snapshot, owned(), {
            hosts: [discoveredHost()],
            domains: [],
        })
        expect(plan.changes).toHaveLength(0)
        expect(['stopped', 'unavailable']).toContain(plan.rows[0]?.state ?? '')
        expect(plan.rows[0]?.hostId).toBe(DISCOVERY_HOST)
    }
})
test('only a complete inventory for the same endpoint can confirm orphaning', () => {
    const snapshot = discoverySnapshot([])
    expect(createDiscoveryPlan(snapshot, owned(), empty).rows[0]?.state).toBe('orphaned')
    snapshot.configuration.settings.endpoint = 'http://another-engine:2375'
    expect(createDiscoveryPlan(snapshot, owned(), empty).rows[0]?.state).toBe('unavailable')
})
test('switching an endpoint never adopts the previous endpoint owner', () => {
    const snapshot = discoverySnapshot()
    snapshot.configuration.settings.endpoint = 'http://another-engine:2375'
    const plan = createDiscoveryPlan(snapshot, owned(), {
        hosts: [discoveredHost()],
        domains: [{ domain: 'app.example.com', proxyHostId: DISCOVERY_HOST }],
    })
    expect(plan.changes).toHaveLength(0)
    expect(plan.rows.some((row) => row.state === 'conflicted')).toBe(true)
})
test('detachment leaves a tombstone that prevents recreation even if the manual host is later removed', () => {
    const registry = owned()
    registry.owners[0]!.state = 'detached'
    const plan = createDiscoveryPlan(discoverySnapshot(), registry, empty)
    expect(plan.rows[0]?.state).toBe('detached')
    expect(plan.changes).toHaveLength(0)
})
test('a missing owned host never gets silently recreated', () => {
    const plan = createDiscoveryPlan(discoverySnapshot(), owned(), empty)
    expect(plan.rows[0]).toMatchObject({ state: 'conflicted', issues: ['host_missing'] })
    expect(plan.changes).toHaveLength(0)
})
test('duplicate source identities, invalid references and invalid TLS targets stay out of the write plan', () => {
    const duplicates = createDiscoveryPlan(
        discoverySnapshot([
            discoveryCandidate(),
            discoveryCandidate({ containerId: 'b'.repeat(64), domains: ['other.example.com'] }),
        ]),
        discoveryRegistry(),
        empty,
    )
    expect(duplicates.changes).toHaveLength(0)
    expect(duplicates.rows.every((row) => row.issues.includes('source_conflict'))).toBe(true)
    const references = createDiscoveryPlan(discoverySnapshot(), discoveryRegistry(), {
        ...empty,
        rejections: { ['a'.repeat(64)]: 'reference_invalid' },
    })
    expect(references.changes).toHaveLength(0)
    const tls = discoveryCandidate({
        target: { scheme: 'https', address: '172.22.0.5', port: 8443, network: 'proxy' },
    })
    expect(
        createDiscoveryPlan(discoverySnapshot([tls]), discoveryRegistry(), empty).changes,
    ).toHaveLength(0)
    tls.upstreamTlsServerName = 'backend.example.com'
    expect(
        createDiscoveryPlan(discoverySnapshot([tls]), discoveryRegistry(), empty).changes[0]?.input
            .verifyUpstreamTls,
    ).toBe(true)
})
test('preview tokens change with candidate, ownership, configuration or host state', () => {
    const baseline = createDiscoveryPlan(
        discoverySnapshot(),
        discoveryRegistry(),
        empty,
    ).previewToken
    for (const plan of [
        createDiscoveryPlan(discoverySnapshot([]), discoveryRegistry(), empty),
        createDiscoveryPlan(discoverySnapshot(), discoveryRegistry({ revision: 1 }), empty),
        createDiscoveryPlan(discoverySnapshot([], { stale: true }), discoveryRegistry(), empty),
        createDiscoveryPlan(discoverySnapshot(), discoveryRegistry(), {
            ...empty,
            hosts: [discoveredHost()],
        }),
        createDiscoveryPlan(discoverySnapshot(), discoveryRegistry(), {
            ...empty,
            rejections: { ['a'.repeat(64)]: 'reference_invalid' },
        }),
    ])
        expect(plan.previewToken).not.toBe(baseline)
})
test('source identity scopes endpoints and normalizes equivalent endpoint URLs', () => {
    expect(discoverySourceKey(endpoint, 'name:app')).toBe(
        discoverySourceKey(endpoint + '/', 'name:app'),
    )
    expect(discoverySourceKey(endpoint, 'name:app')).not.toBe(
        discoverySourceKey('http://other:2375', 'name:app'),
    )
})
test('management inputs reject stale-action omissions, unknown fields and secret endpoint credentials', () => {
    expect(discoveryActionSchema.safeParse({ expectedRevision: 0, action: 'enable' }).success).toBe(
        false,
    )
    expect(discoveryActionSchema.safeParse({ expectedRevision: 0, action: 'detach' }).success).toBe(
        false,
    )
    expect(
        discoveryActionSchema.safeParse({
            expectedRevision: 0,
            action: 'disable',
            actorUserId: 'forged',
        }).success,
    ).toBe(false)
    expect(
        discoveryConnectSchema.safeParse({
            expectedRevision: 0,
            connectorRevision: 1,
            endpoint: 'http://user:secret@proxy:2375',
            acknowledgeRestore: false,
        }).success,
    ).toBe(false)
    expect(discoveryRegistrySchema.parse(discoveryRegistry())).toEqual(discoveryRegistry())
})
