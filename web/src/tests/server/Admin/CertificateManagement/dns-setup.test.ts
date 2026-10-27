import { describe, expect, test } from 'bun:test'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { createCertificateDnsSetupService } from '@/server/Admin/CertificateManagement/dns-setup.service.ts'
import type { CertificateDnsSetupDependencies } from '@/server/Admin/CertificateManagement/Types/dns-setup.types.ts'
import type { ManualDnsChallengeMetadata } from '@/lib/Admin/CertificateManagement/Types/certificates.types.ts'
import type {
    DnsSetupInput,
    ManualDnsCheckInput,
} from '@/lib/Admin/CertificateManagement/Types/dns-setup.types.ts'

const id = '0198d98a-0000-7000-8000-000000000001'
const operationId = '0198d98a-0000-7000-8000-000000000002'
const challengeSetId = '0198d98a-0000-7000-8000-000000000003'
const setupInput: DnsSetupInput = {
    domains: ['example.com'],
    environment: 'staging',
    dnsMode: 'provider',
    connectionId: id,
    expectedRevision: 3,
    zoneId: 'a'.repeat(32),
}
const checkInput: ManualDnsCheckInput = { certificateId: id, operationId, challengeSetId }
const manual: ManualDnsChallengeMetadata = {
    challengeSetId,
    status: 'awaiting_input',
    expiresAt: '2030-01-01T00:00:00Z',
    lastCheckedAt: null,
    lastErrorCode: null,
    records: [
        {
            identifier: 'example.com',
            owner: '_acme-challenge.example.com',
            value: 'x'.repeat(43),
            expiresAt: '2030-01-01T00:00:00Z',
        },
        {
            identifier: '*.example.com',
            owner: '_acme-challenge.example.com',
            value: 'y'.repeat(43),
            expiresAt: '2030-01-01T00:00:00Z',
        },
    ],
}

function fixture(overrides: Partial<CertificateDnsSetupDependencies> = {}) {
    const calls: string[] = []
    const dependencies: CertificateDnsSetupDependencies = {
        currentUser: async () => ({ id, permissions: [PERMISSIONS.CERTIFICATES_ISSUE] }),
        assertSetupAccess: async () => {
            calls.push('authorize-setup')
        },
        assertManualAccess: async () => {
            calls.push('authorize-manual')
            return manual
        },
        limit: async () => {
            calls.push('limit')
        },
        controller: {
            setup: async () => {
                calls.push('inspect')
                return {
                    connectionId: id,
                    connectionRevision: 3,
                    zoneId: setupInput.zoneId,
                    zoneName: 'example.com',
                    provider: 'cloudflare',
                    dnsMode: 'provider',
                    checkedAt: '2026-10-27T00:00:00Z',
                    results: [],
                }
            },
            check: async () => {
                calls.push('check')
                return {
                    ...checkInput,
                    checkedAt: '2026-10-27T00:00:00Z',
                    expiresAt: manual.expiresAt,
                    status: 'ready',
                    records: [
                        {
                            owner: '_acme-challenge.example.com',
                            identifiers: ['example.com', '*.example.com'],
                            status: 'ready',
                        },
                    ],
                }
            },
        },
        ...overrides,
    }
    return { calls, service: createCertificateDnsSetupService(dependencies), dependencies }
}

describe('read-only certificate DNS service', () => {
    test('authorizes before inspection and rechecks access before returning DNS data', async () => {
        const { calls, service } = fixture()
        await service.inspectCertificateDnsSetupService(setupInput)
        expect(calls).toEqual(['authorize-setup', 'limit', 'inspect', 'authorize-setup'])
    })

    test('denied access and rate limits prevent all DNS work', async () => {
        await Promise.all(
            (['assertSetupAccess', 'limit'] as const).map(async (boundary) => {
                const { calls, service } = fixture({
                    [boundary]: async () => {
                        throw new Error('denied')
                    },
                })
                await expect(service.inspectCertificateDnsSetupService(setupInput)).rejects.toThrow(
                    'denied',
                )
                expect(calls).not.toContain('inspect')
            }),
        )
    })

    test('permission revocation during an inspection discards its result', async () => {
        let access = 0
        const { calls, service } = fixture({
            assertSetupAccess: async () => {
                if (++access === 2) throw new Error('revoked')
            },
        })
        await expect(service.inspectCertificateDnsSetupService(setupInput)).rejects.toThrow(
            'revoked',
        )
        expect(calls).toEqual(['limit', 'inspect'])
    })

    test('manual checks enforce both operation fences around a read without persisting or continuing it', async () => {
        const { calls, service } = fixture()
        expect((await service.checkManualDnsService(checkInput)).status).toBe('ready')
        expect(calls).toEqual(['authorize-manual', 'limit', 'check', 'authorize-manual'])
        const denied = fixture({
            currentUser: async () => ({ id, permissions: [PERMISSIONS.CERTIFICATES_VIEW] }),
        })
        await expect(denied.service.checkManualDnsService(checkInput)).rejects.toMatchObject({
            code: 'permission_denied',
        })
        expect(denied.calls).toEqual([])
    })

    test('replaced proofs, expiry metadata and foreign response owners fail closed', async () => {
        let reads = 0
        const stale = fixture({
            assertManualAccess: async () =>
                ++reads === 1 ? manual : { ...manual, records: manual.records.slice(0, 1) },
        })
        await expect(stale.service.checkManualDnsService(checkInput)).rejects.toThrow(
            'operation_in_progress',
        )
        const base = fixture()
        await Promise.all(
            (['foreign', 'expiry'] as const).map(async (kind) => {
                const invalid = fixture({
                    controller: {
                        ...base.dependencies.controller,
                        check: async (input) => ({
                            ...input,
                            checkedAt: '2026-10-27T00:00:00Z',
                            expiresAt:
                                kind === 'expiry' ? '2031-01-01T00:00:00Z' : manual.expiresAt,
                            status: 'pending',
                            records: [
                                {
                                    owner:
                                        kind === 'foreign'
                                            ? '_acme-challenge.foreign.test'
                                            : '_acme-challenge.example.com',
                                    identifiers: ['example.com', '*.example.com'],
                                    status: 'pending',
                                },
                            ],
                        }),
                    },
                })
                await expect(invalid.service.checkManualDnsService(checkInput)).rejects.toThrow(
                    'controller_unavailable',
                )
            }),
        )
    })
})
