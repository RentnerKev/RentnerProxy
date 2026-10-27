import { describe, expect, test } from 'bun:test'
import type {
    DnsSetupInput,
    DnsSetupResult,
    ManualDnsCheckResult,
} from '@/lib/Admin/CertificateManagement/Types/dns-setup.types.ts'
import { createCertificateDnsSetupController } from '@/server/Controller/dns-setup.server.ts'

const id = '0198d98a-0000-7000-8000-000000000001'
const operationId = '0198d98a-0000-7000-8000-000000000002'
const challengeSetId = '0198d98a-0000-7000-8000-000000000003'
const input: DnsSetupInput = {
    domains: ['example.com', '*.example.com'],
    environment: 'staging',
    dnsMode: 'delegated',
    connectionId: id,
    expectedRevision: 3,
    zoneId: 'a'.repeat(32),
    delegation: { type: 'cname', targetOwner: 'proof.validation.example.net' },
}
const setup: DnsSetupResult = {
    connectionId: id,
    connectionRevision: 3,
    zoneId: input.zoneId,
    zoneName: 'validation.example.net',
    provider: 'cloudflare',
    dnsMode: 'delegated',
    checkedAt: '2026-10-27T00:00:00Z',
    results: [
        {
            identifiers: input.domains,
            originalOwner: '_acme-challenge.example.com',
            instruction: {
                type: 'CNAME',
                owner: '_acme-challenge.example.com',
                values: ['proof.validation.example.net.'],
            },
            status: 'ready',
            observedTarget: 'proof.validation.example.net',
        },
    ],
}
const check: ManualDnsCheckResult = {
    certificateId: id,
    operationId,
    challengeSetId,
    checkedAt: setup.checkedAt,
    expiresAt: '2030-01-01T00:00:00Z',
    status: 'ready',
    records: [
        { owner: '_acme-challenge.example.com', identifiers: input.domains, status: 'ready' },
    ],
}

describe('read-only DNS controller contract', () => {
    test('uses bounded confidential POST diagnostics without an issuance or credential payload', async () => {
        const calls: unknown[] = []
        const controller = createCertificateDnsSetupController(async (path, options) => {
            calls.push({ path, ...options })
            return path.endsWith('/setup') ? setup : check
        })
        expect(
            await controller.setup({
                ...input,
                delegation: { type: 'cname', targetOwner: 'Proof.Validation.Example.Net.' },
            }),
        ).toEqual(setup)
        expect(await controller.check({ certificateId: id, operationId, challengeSetId })).toEqual(
            check,
        )
        expect(calls).toEqual([
            {
                path: '/internal/v1/certificates/dns-01/setup',
                privileged: true,
                confidential: true,
                method: 'POST',
                timeoutMs: 20_000,
                responseLimit: 524_288,
                acceptErrorResponse: true,
                body: JSON.stringify(input),
            },
            {
                path: `/internal/v1/certificates/${id}/dns-01/check`,
                privileged: true,
                confidential: true,
                method: 'POST',
                timeoutMs: 20_000,
                responseLimit: 524_288,
                acceptErrorResponse: true,
                body: JSON.stringify({ operationId, challengeSetId }),
            },
        ])
    })

    test('rejects invalid mode, target, connection and stale action IDs before transport', async () => {
        let calls = 0
        const controller = createCertificateDnsSetupController(async () => {
            calls += 1
            return setup
        })
        const invalid = [
            { ...input, domains: [] },
            { ...input, domains: ['localhost'] },
            { ...input, domains: ['example.com', 'EXAMPLE.COM'] },
            { ...input, expectedRevision: 0 },
            { ...input, dnsMode: 'provider' as const },
            { ...input, connectionId: '../../private' },
            { ...input, delegation: { type: 'cname' as const, targetOwner: 'https://127.0.0.1/' } },
        ]
        await Promise.all(
            invalid.map((bad) => expect(controller.setup(bad)).rejects.toThrow('invalid_input')),
        )
        await expect(
            controller.check({ certificateId: id, operationId: 'old', challengeSetId }),
        ).rejects.toThrow('invalid_input')
        expect(calls).toBe(0)
    })

    test('rejects mismatched authority, incomplete SANs, invented instructions and unknown response fields', async () => {
        const first = setup.results[0]!
        const payloads = [
            { ...setup, connectionRevision: 4 },
            { ...setup, connectionId: operationId },
            { ...setup, zoneId: 'b'.repeat(32) },
            { ...setup, provider: 'hetzner' },
            { ...setup, dnsMode: 'provider' },
            { ...setup, privateToken: 'must-not-escape' },
            { ...setup, results: [{ ...first, identifiers: ['example.com'] }] },
            { ...setup, results: [first, first] },
            { ...setup, results: [{ ...first, originalOwner: '_acme-challenge.foreign.test' }] },
            {
                ...setup,
                results: [
                    {
                        ...first,
                        instruction: { ...first.instruction, values: ['foreign.example.net.'] },
                    },
                ],
            },
            { ...setup, results: [{ ...first, observedTarget: 'foreign.example.net' }] },
        ]
        await Promise.all(
            payloads.map((payload) =>
                expect(
                    createCertificateDnsSetupController(async () => payload).setup(input),
                ).rejects.toThrow('controller_unavailable'),
            ),
        )
    })

    test('direct TXT is automatic and NS instructions require the selected challenge zone', async () => {
        const direct = { ...input, dnsMode: 'provider' as const, delegation: undefined }
        const automatic = {
            ...setup,
            dnsMode: 'provider',
            zoneName: 'example.com',
            results: [
                {
                    ...setup.results[0],
                    instruction: { type: 'TXT', owner: '_acme-challenge.example.com', values: [] },
                    observedTarget: null,
                },
            ],
        }
        expect(
            (await createCertificateDnsSetupController(async () => automatic).setup(direct))
                .results[0]?.instruction.values,
        ).toEqual([])
        await expect(
            createCertificateDnsSetupController(async () => ({
                ...automatic,
                zoneName: 'foreign.test',
            })).setup(direct),
        ).rejects.toThrow('controller_unavailable')
        const nsInput = { ...input, delegation: { type: 'ns' as const } }
        const ns = {
            ...setup,
            zoneName: '_acme-challenge.example.com',
            results: [
                {
                    ...setup.results[0],
                    instruction: {
                        type: 'NS',
                        owner: '_acme-challenge.example.com',
                        values: ['ns1.example.net.'],
                    },
                    observedTarget: '_acme-challenge.example.com',
                },
            ],
        }
        expect(
            (await createCertificateDnsSetupController(async () => ns).setup(nsInput)).results[0]
                ?.instruction.type,
        ).toBe('NS')
        await expect(
            createCertificateDnsSetupController(async () => ({
                ...ns,
                zoneName: 'example.com',
            })).setup(nsInput),
        ).rejects.toThrow('controller_unavailable')
    })

    test('keeps manual result fences and never accepts pending records as ready', async () => {
        const payloads = [
            { ...check, certificateId: operationId },
            { ...check, operationId: id },
            { ...check, challengeSetId: id },
            { ...check, records: [{ ...check.records[0], status: 'pending' }] },
            { ...check, records: [check.records[0], check.records[0]] },
            { ...check, privateValue: 'not-public' },
        ]
        await Promise.all(
            payloads.map((payload) =>
                expect(
                    createCertificateDnsSetupController(async () => payload).check({
                        certificateId: id,
                        operationId,
                        challengeSetId,
                    }),
                ).rejects.toThrow('controller_unavailable'),
            ),
        )
    })

    test('retains catalogued errors and sanitizes unknown provider response bodies', async () => {
        await expect(
            createCertificateDnsSetupController(async () => ({
                error: 'operation_in_progress',
            })).setup(input),
        ).rejects.toThrow('operation_in_progress')
        await expect(
            createCertificateDnsSetupController(async () => ({
                error: 'private-provider-message',
                token: 'secret',
            })).setup(input),
        ).rejects.toThrow('controller_unavailable')
    })
})
