import { expect, test } from 'bun:test'

import {
    accessPolicies,
    certificates,
    certificateDomains,
    hostDomains,
    proxyHosts,
} from '@/db/schema.ts'
import { readDiscoveryInventory } from '@/server/Admin/DockerDiscovery/discovery-inventory.server.ts'
import type { AuthTransaction } from '@/server/Auth/Core/Types/database.types.ts'
import {
    discoveredHost,
    discoveryCandidate,
    discoverySnapshot,
} from '@/tests/Helpers/discoveryFixture.ts'

const certificateId = '0198d98a-0000-7000-8000-000000000030'
const otherCertificateId = '0198d98a-0000-7000-8000-000000000031'
const policyId = '0198d98a-0000-7000-8000-000000000040'

function fixture() {
    const first = discoveredHost()
    const second = discoveredHost({ id: '0198d98a-0000-7000-8000-000000000003' })
    const domains = [
        { proxyHostId: first.id, domain: 'alias.example.com' },
        { proxyHostId: second.id, domain: 'other.example.com' },
        { proxyHostId: null, domain: 'redirect.example.com' },
        { proxyHostId: first.id, domain: 'app.example.com' },
    ]
    const now = Date.now()
    const valid = {
        status: 'valid',
        issuedAt: new Date(now - 60_000),
        expiresAt: new Date(now + 60_000),
    }
    const stored = new Map<unknown, unknown[]>([
        [proxyHosts, [first, second]],
        [hostDomains, domains],
        [
            certificates,
            [
                { id: certificateId, ...valid },
                { id: otherCertificateId, ...valid },
            ],
        ],
        [
            certificateDomains,
            [
                { id: certificateId, domain: 'alias.example.com' },
                { id: otherCertificateId, domain: 'other.example.com' },
                { id: certificateId, domain: 'app.example.com' },
            ],
        ],
        [accessPolicies, [{ id: policyId }]],
    ])
    const transaction = {
        select: () => ({
            from: (table: unknown) => ({
                orderBy: async () => stored.get(table) ?? [],
                where: async () => stored.get(table) ?? [],
            }),
        }),
    } as unknown as AuthTransaction
    return { first, second, domains, valid, stored, transaction }
}

test('groups host aliases and shared certificate names without losing redirect occupancy or cross-assigning names', async () => {
    const context = fixture()
    const candidates = [
        discoveryCandidate({
            certificateId,
            accessPolicyId: policyId,
            domains: ['app.example.com', 'alias.example.com'],
        }),
        discoveryCandidate({
            certificateId,
            containerId: 'b'.repeat(64),
            domains: ['alias.example.com'],
        }),
        discoveryCandidate({
            certificateId: otherCertificateId,
            containerId: 'c'.repeat(64),
            domains: ['other.example.com'],
        }),
        discoveryCandidate({
            certificateId: otherCertificateId,
            containerId: 'd'.repeat(64),
            domains: ['app.example.com'],
        }),
    ]
    const before = structuredClone(context.domains)
    const inventory = await readDiscoveryInventory(
        context.transaction,
        discoverySnapshot(candidates),
    )
    expect(inventory.hosts[0]!.domains).toEqual(['alias.example.com', 'app.example.com'])
    expect(inventory.hosts[1]!.domains).toEqual(['other.example.com'])
    expect(inventory.domains).toEqual(before)
    expect(inventory.rejections).toEqual({ ['d'.repeat(64)]: 'reference_invalid' })
    expect(context.domains).toEqual(before)
})

test.each([
    'missing',
    'failed',
    'not-yet-valid',
    'expired',
    'no-issue-date',
    'no-expiry-date',
    'no-names',
    'missing-policy',
] as const)('preserves the %s reference rejection with indexed inventory', async (failure) => {
    const context = fixture()
    if (failure === 'missing') context.stored.set(certificates, [])
    else if (failure === 'no-names') context.stored.set(certificateDomains, [])
    else if (failure === 'missing-policy') context.stored.set(accessPolicies, [])
    else
        context.stored.set(certificates, [
            {
                id: certificateId,
                ...context.valid,
                ...(failure === 'failed' ? { status: 'failed' } : {}),
                ...(failure === 'not-yet-valid' ? { issuedAt: new Date(Date.now() + 60_000) } : {}),
                ...(failure === 'expired' ? { expiresAt: new Date(Date.now() - 60_000) } : {}),
                ...(failure === 'no-issue-date' ? { issuedAt: null } : {}),
                ...(failure === 'no-expiry-date' ? { expiresAt: null } : {}),
            },
        ])
    const inventory = await readDiscoveryInventory(
        context.transaction,
        discoverySnapshot([discoveryCandidate({ certificateId, accessPolicyId: policyId })]),
    )
    expect(inventory.rejections).toEqual({ ['a'.repeat(64)]: 'reference_invalid' })
})
