import { describe, expect, test } from 'bun:test'
import { validateManualDnsBackupState } from '../../../../../../scripts/backup/manual-dns-state.ts'

const certificateId = '0198d98a-0000-7000-8000-000000000501'
const operationId = '0198d98a-0000-7000-8000-000000000502'
const expiresAt = '2030-01-02T03:04:05Z'
function certificate() {
    return {
        id: certificateId,
        domains: ['example.com', '*.example.com'],
        currentOperation: { id: operationId },
        acme: {
            challengeType: 'dns-01',
            dnsMode: 'manual',
            pendingDnsRecords: [],
            manualOrder: {
                version: 1,
                operationId,
                challengeSetId: operationId,
                accountIdentity: 'a'.repeat(64),
                orderUrl: 'https://acme.example.test/order/fixture',
                expiresAt,
                records: [
                    {
                        identifier: 'example.com',
                        owner: '_acme-challenge.example.com',
                        value: 'a'.repeat(43),
                        expiresAt,
                    },
                    {
                        identifier: '*.example.com',
                        owner: '_acme-challenge.example.com',
                        value: 'b'.repeat(43),
                        expiresAt,
                    },
                ],
                phase: 'awaiting_input',
                privateKeyPem: null,
                csrDer: null,
                lastCheckedAt: null,
                lastErrorCode: null,
            },
        },
    }
}

describe('manual DNS controller backup state', () => {
    test('preserves legacy state and durable pending apex/wildcard challenges', () => {
        expect(() =>
            validateManualDnsBackupState({ acme: { challengeType: 'http-01' } }, certificateId),
        ).not.toThrow()
        expect(() => validateManualDnsBackupState(certificate(), certificateId)).not.toThrow()
    })
    test('accepts preparation before TXT material is available and terminal cleanup instructions', () => {
        const preparing = certificate()
        preparing.acme.manualOrder.phase = 'checking_dns'
        preparing.acme.manualOrder.records = []
        expect(() => validateManualDnsBackupState(preparing, certificateId)).not.toThrow()
        for (const phase of ['complete', 'expired', 'cancelled', 'failed']) {
            const terminal = certificate()
            terminal.acme.manualOrder.phase = phase
            expect(() => validateManualDnsBackupState(terminal, certificateId)).not.toThrow()
        }
    })
    test('rejects mixed provider state and operation/account/reference confusion', () => {
        const initial = certificate()
        const changes = [
            { ...initial, acme: { ...initial.acme, dnsMode: 'provider' } },
            { ...initial, acme: { ...initial.acme, dnsProvider: { type: 'cloudflare' } } },
            { ...initial, currentOperation: { id: certificateId } },
            {
                ...initial,
                acme: {
                    ...initial.acme,
                    manualOrder: { ...initial.acme.manualOrder, accountIdentity: 'bad' },
                },
            },
            {
                ...initial,
                acme: {
                    ...initial.acme,
                    manualOrder: {
                        ...initial.acme.manualOrder,
                        orderUrl: 'http://acme.example.test/order',
                    },
                },
            },
            {
                ...initial,
                acme: {
                    ...initial.acme,
                    manualOrder: {
                        ...initial.acme.manualOrder,
                        orderUrl: 'https://user:secret@acme.example.test/order',
                    },
                },
            },
        ]
        for (const value of changes)
            expect(() => validateManualDnsBackupState(value, certificateId)).toThrow(
                /invalid manual DNS/u,
            )
    })
    test('rejects unrelated owners/identifiers, duplicate authorizations and impossible expiry', () => {
        const initial = certificate()
        const base = initial.acme.manualOrder.records[0]!
        for (const records of [
            [{ ...base, identifier: 'unrelated.example.com' }],
            [{ ...base, owner: '_acme-challenge.unrelated.example.com' }],
            [base, base],
            [{ ...base, expiresAt: '2020-01-01T00:00:00Z' }],
            [],
        ])
            expect(() =>
                validateManualDnsBackupState(
                    {
                        ...initial,
                        acme: {
                            ...initial.acme,
                            manualOrder: { ...initial.acme.manualOrder, records },
                        },
                    },
                    certificateId,
                ),
            ).toThrow(/invalid manual DNS/u)
    })
    test('bounds private material and never includes invalid material in diagnostics', () => {
        const initial = certificate()
        for (const material of [
            { privateKeyPem: 'private-fixture-do-not-print', csrDer: null },
            { privateKeyPem: 'private-fixture-do-not-print', csrDer: [48, 0] },
            { privateKeyPem: 'x'.repeat(65_537), csrDer: [48, 0] },
            { privateKeyPem: null, csrDer: [256] },
        ]) {
            const invalid = {
                ...initial,
                acme: {
                    ...initial.acme,
                    manualOrder: { ...initial.acme.manualOrder, phase: 'finalizing', ...material },
                },
            }
            try {
                validateManualDnsBackupState(invalid, certificateId)
                throw new Error('fixture accepted')
            } catch (error) {
                expect(error).toBeInstanceOf(Error)
                expect((error as Error).message).not.toContain('private-fixture')
                expect((error as Error).message).toMatch(/invalid manual DNS/u)
            }
        }
    })
})
