import { describe, expect, test } from 'bun:test'
import { OIDC_LIMITS } from '@/config/oidc.config.ts'
import type { AuthTransaction } from '@/server/Auth/Core/Types/database.types.ts'
import {
    isOidcSessionValidInTransaction,
    prepareOidcSessionProof,
} from '@/server/Auth/Oidc/oidc-session.server.ts'

const now = 1_800_000_000_000
const proof = {
    providerId: '0194f777-4074-7000-8000-000000000001',
    providerRevision: 1,
    issuer: 'https://identity.example.test',
    subject: 'subject',
    userId: '0194f777-4074-7000-8000-000000000002',
    expiresAt: now + 60_000,
}
const provider = {
    id: proof.providerId,
    revision: 1,
    name: 'Identity',
    issuer: proof.issuer,
    enabled: true,
    clientId: 'client',
    tokenEndpointAuthMethod: 'client_secret_basic',
    allowedEndpointOrigins: [proof.issuer],
    allowedPrivateCidrs: [],
    bindings: [{ subject: proof.subject, userId: proof.userId }],
    clientSecret: {
        ciphertext: Buffer.alloc(17).toString('base64url'),
        iv: Buffer.alloc(12).toString('base64url'),
    },
}

function transaction(providers: unknown[] = [provider]): AuthTransaction {
    return {
        select: () => ({
            from: () => ({
                where: () => ({
                    limit: async () => [{ value: { version: 1, revision: 2, providers } }],
                }),
            }),
        }),
    } as unknown as AuthTransaction
}

function valid(
    providers: unknown[] = [provider],
    managedProviderId: string | null = null,
    roles: string[] = [],
) {
    return isOidcSessionValidInTransaction(
        transaction(providers),
        proof,
        proof.userId,
        managedProviderId,
        roles,
        now,
    )
}

describe('durable OIDC session provenance', () => {
    test('caps lifetime and strips transient group claims', () => {
        expect(
            prepareOidcSessionProof({ ...proof, groups: ['private-group'] }, proof.userId, now),
        ).toEqual({ ...proof, bindingGeneration: 0 })
        expect(
            prepareOidcSessionProof({ ...proof, expiresAt: now + 86_400_000 }, proof.userId, now)
                .expiresAt,
        ).toBe(now + OIDC_LIMITS.sessionDurationMs)
    })

    test('rejects missing, expired, malformed and substituted identity proof', () => {
        for (const value of [
            null,
            {},
            { ...proof, expiresAt: now },
            { ...proof, providerRevision: 0 },
            { ...proof, bindingGeneration: -1 },
            { ...proof, bindingGeneration: 0.5 },
            { ...proof, userId: proof.providerId },
        ])
            expect(() => prepareOidcSessionProof(value, proof.userId, now)).toThrow()
    })

    test('requires exact current enabled provider, revision, issuer and binding', async () => {
        expect(await valid()).toBeTrue()
        expect(await valid([])).toBeFalse()
        expect(await valid([{ ...provider, enabled: false }])).toBeFalse()
        expect(await valid([{ ...provider, revision: 2 }])).toBeFalse()
        expect(
            await valid([
                {
                    ...provider,
                    issuer: 'https://other.example.test',
                    allowedEndpointOrigins: ['https://other.example.test'],
                },
            ]),
        ).toBeFalse()
        expect(await valid([{ ...provider, bindings: [] }])).toBeFalse()
        expect(
            await valid([
                { ...provider, bindings: [{ subject: 'another-subject', userId: proof.userId }] },
            ]),
        ).toBeFalse()
    })

    test('rejects managed provider mismatch and owner elevation', async () => {
        expect(await valid([provider], proof.providerId)).toBeTrue()
        expect(await valid([provider], proof.userId)).toBeFalse()
        expect(await valid([provider], proof.providerId, ['owner'])).toBeFalse()
        expect(
            await valid(
                [{ ...provider, bindings: [{ ...provider.bindings[0], roleSource: 'provider' }] }],
                null,
                ['owner'],
            ),
        ).toBeFalse()
        expect(await valid([provider], null, ['owner'])).toBeTrue()
    })

    test('rejects expired proof on an otherwise valid active session', async () => {
        expect(
            await isOidcSessionValidInTransaction(
                transaction(),
                proof,
                proof.userId,
                null,
                [],
                proof.expiresAt,
            ),
        ).toBeFalse()
    })

    test('pins only its binding generation and accepts legacy generation zero', async () => {
        expect(
            await valid([{ ...provider, bindings: [{ ...provider.bindings[0], generation: 0 }] }]),
        ).toBeTrue()
        const relinked = { ...provider, bindings: [{ ...provider.bindings[0], generation: 1 }] }
        expect(await valid([relinked])).toBeFalse()
        expect(
            await isOidcSessionValidInTransaction(
                transaction([relinked]),
                { ...proof, bindingGeneration: 1 },
                proof.userId,
                null,
                [],
                now,
            ),
        ).toBeTrue()
        expect(
            await valid([
                {
                    ...provider,
                    bindings: [
                        provider.bindings[0],
                        { subject: 'unrelated', userId: proof.providerId, generation: 2 },
                    ],
                },
            ]),
        ).toBeTrue()
    })
})
