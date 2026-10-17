import type { DdnsBatch, DdnsDraft, DdnsSnapshot, DdnsTarget } from '@/lib/Ddns/Types/ddns.types.ts'
import type { DnsConnection } from '@/lib/DnsConnections/Types/dns-connections.types.ts'
export const DDNS_ACTOR = '0198d98a-0000-7000-8000-000000000001'
export const DDNS_CONNECTION: DnsConnection = {
    id: '0198d98a-0000-7000-8000-000000000002',
    provider: 'cloudflare',
    ownership: 'instance',
    name: 'Fixture Cloudflare',
    createdByUserId: DDNS_ACTOR,
    revision: 1,
    zones: [
        { id: 'a'.repeat(32), name: 'example.com' },
        { id: 'b'.repeat(32), name: 'example.org' },
    ],
    references: [],
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
}
export function ddnsTarget(overrides: Partial<DdnsTarget> = {}): DdnsTarget {
    return {
        id: '0198d98a-0000-7000-8000-000000000003',
        connectionId: DDNS_CONNECTION.id,
        zoneId: 'a'.repeat(32),
        name: 'example.com',
        recordType: 'A',
        proxied: true,
        selection: { mode: 'inspect' },
        ...overrides,
    }
}
export function ddnsSettings(targets = [ddnsTarget()]): DdnsDraft {
    return { intervalSeconds: 300, updateOnStart: true, ipv4: true, ipv6: false, targets }
}
export function ddnsSnapshot(draft?: DdnsDraft, enabled = false, revision = 1): DdnsSnapshot {
    return {
        version: 1,
        configuration: draft
            ? { revision, updatedByUserId: DDNS_ACTOR, settings: { ...draft, enabled } }
            : null,
        targets: (draft?.targets ?? []).map((target) => ({
            targetId: target.id,
            lastAttemptAt: null,
            lastSuccessAt: null,
            lastSuccessfulAddress: null,
            lastSuccessfulProxied: null,
            lastResult: null,
            consecutiveFailures: 0,
            permanentFailure: false,
            connectionRevision: null,
            nextAttemptAt: enabled ? 1_792_205_700 : null,
            retryNotBefore: null,
        })),
        inFlight: null,
        lastRun: null,
        providerNotBefore: null,
        providerPauseReason: null,
        manualNotBefore: null,
        restorePaused: false,
        events: [],
        eventSequence: 0,
    }
}
export function ddnsBatch(draft: DdnsDraft): DdnsBatch {
    return {
        preview: true,
        ipv4: draft.ipv4 ? '203.0.113.10' : null,
        ipv6: draft.ipv6 ? '2001:db8::10' : null,
        targets: draft.targets.map((target) => ({
            targetId: target.id,
            status: target.selection.mode === 'inspect' ? 'adoption_required' : 'would_update',
            current: { id: 'c'.repeat(32), address: '203.0.113.1', proxied: true },
            desiredAddress: target.recordType === 'A' ? '203.0.113.10' : '2001:db8::10',
            error: target.selection.mode === 'inspect' ? 'adoption_required' : null,
            retryAfterSeconds: null,
        })),
    }
}
