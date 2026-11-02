import { describe, expect, test } from 'bun:test'
import type { CurrentSession } from '@/server/Auth/Core/Types/auth-service.types.ts'
import type { AuthTransaction } from '@/server/Auth/Core/Types/database.types.ts'
import type { SaveOidcProvidersInput } from '@/lib/Auth/Oidc/Types/oidc-provider.types.ts'
import type {
    OidcProviderDependencies,
    StoredOidcSettings,
} from '@/server/Auth/Oidc/Types/oidc-provider.types.ts'
import { AuthDomainError } from '@/server/Auth/Core/errors.server.ts'
import {
    buildStoredOidcSettings,
    DEFAULT_OIDC_SETTINGS,
} from '@/server/Auth/Oidc/oidc-settings.server.ts'

// The SQL client is lazy: all transaction/storage operations below are injected.
const originalDatabase = process.env.DATABASE_URL
process.env.DATABASE_URL ??= 'postgresql://unit:unit@127.0.0.1:1/rentnerproxy_unit'
const { createOidcProvidersService } = await import('@/server/Auth/Oidc/oidc-providers.service.ts')
if (originalDatabase === undefined) delete process.env.DATABASE_URL

const session: CurrentSession = {
    id: '0194f777-4074-7000-8000-000000000001',
    expiresAt: new Date(Date.now() + 60_000),
    reauthenticatedAt: new Date(),
    user: {
        id: '0194f777-4074-7000-8000-000000000002',
        roles: ['owner'],
        permissions: ['app.access'],
        displayName: 'Owner',
        email: 'owner@example.test',
        profileImageVersion: null,
        language: 'en',
        themeMode: 'dark',
    },
}

function fixture(overrides: Partial<OidcProviderDependencies> = {}) {
    const calls: string[] = []
    let settings: StoredOidcSettings = DEFAULT_OIDC_SETTINGS
    const dependencies: OidcProviderDependencies = {
        session: async () => session,
        transaction: async (run) => run({} as AuthTransaction),
        authorize: async () => {
            calls.push('authorize')
        },
        validateUser: async () => {
            calls.push('binding')
        },
        read: async () => {
            calls.push('read')
            return settings
        },
        lock: async () => {
            calls.push('lock')
            return settings
        },
        write: async (_transaction, value) => {
            calls.push('write')
            settings = value
        },
        build: async (current, input) => {
            calls.push('build')
            return buildStoredOidcSettings(current, input)
        },
        limit: async () => {
            calls.push('limit')
        },
        audit: async () => {
            calls.push('audit')
        },
        publish: () => {
            calls.push('publish')
        },
        ...overrides,
    }
    return { calls, service: createOidcProvidersService(dependencies) }
}

describe('owner OIDC provider service', () => {
    test('can disable or rotate a provider while an unchanged binding target is inactive', async () => {
        const originalKey = process.env.APP_ENCRYPTION_KEY
        process.env.APP_ENCRYPTION_KEY = Buffer.from(new Uint8Array(32).fill(37)).toString('base64')
        try {
            const input: SaveOidcProvidersInput = {
                expectedRevision: 0,
                providers: [
                    {
                        id: '0194f777-4074-7000-8000-000000000003',
                        name: 'Office',
                        enabled: true,
                        issuer: 'https://identity.example.test',
                        clientId: 'client',
                        clientSecret: 'initial-secret',
                        tokenEndpointAuthMethod: 'client_secret_basic',
                        allowedEndpointOrigins: ['https://identity.example.test'],
                        allowedPrivateCidrs: [],
                        bindings: [{ subject: 'stale-subject', userId: session.user.id }],
                    },
                ],
            }
            const current = await buildStoredOidcSettings(DEFAULT_OIDC_SETTINGS, input)
            for (const changes of [
                { enabled: false, clientSecret: '' },
                { clientSecret: 'replacement-secret' },
            ]) {
                const { service, calls } = fixture({
                    lock: async () => {
                        calls.push('lock')
                        return current
                    },
                    validateUser: async () => {
                        calls.push('binding')
                        throw new Error('inactive target')
                    },
                })
                // oxlint-disable-next-line no-await-in-loop -- Exercise each maintenance operation with an independent fixture.
                const saved = await service.saveOidcProvidersService({
                    expectedRevision: 1,
                    providers: [{ ...input.providers[0]!, ...changes }],
                })
                expect(saved.revision).toBe(2)
                expect(saved.providers[0]?.enabled).toBe(changes.enabled ?? true)
                expect(calls).toEqual([
                    'limit',
                    'lock',
                    'authorize',
                    'build',
                    'write',
                    'audit',
                    'publish',
                ])
            }
            const changedProviders = [
                { ...input.providers[0]!, id: '0194f777-4074-7000-8000-000000000004' },
                { ...input.providers[0]!, issuer: 'https://identity.example.test/other' },
                {
                    ...input.providers[0]!,
                    bindings: [{ subject: 'new-subject', userId: session.user.id }],
                },
                {
                    ...input.providers[0]!,
                    bindings: [
                        {
                            subject: 'stale-subject',
                            userId: '0194f777-4074-7000-8000-000000000004',
                        },
                    ],
                },
            ]
            for (const provider of changedProviders) {
                const { service, calls } = fixture({
                    lock: async () => {
                        calls.push('lock')
                        return current
                    },
                    validateUser: async () => {
                        calls.push('binding')
                        throw new Error('inactive target')
                    },
                })
                // oxlint-disable-next-line no-await-in-loop -- Independent cases assert the ordered authorization boundary.
                await expect(
                    service.saveOidcProvidersService({
                        expectedRevision: 1,
                        providers: [provider],
                    }),
                ).rejects.toThrow('inactive target')
                expect(calls).toEqual(['limit', 'lock', 'authorize', 'binding'])
            }
        } finally {
            if (originalKey === undefined) delete process.env.APP_ENCRYPTION_KEY
            else process.env.APP_ENCRYPTION_KEY = originalKey
        }
    })
    test('public list exposes only enabled configured provider names with bindings', async () => {
        const provider = {
            id: '0194f777-4074-7000-8000-000000000003',
            name: 'Office',
            revision: 1,
            enabled: true,
            issuer: 'https://identity.example.test',
            clientId: 'private-client-id',
            clientSecret: { ciphertext: 'private-ciphertext', iv: 'private-iv' },
            tokenEndpointAuthMethod: 'client_secret_basic' as const,
            allowedEndpointOrigins: ['https://identity.example.test'],
            allowedPrivateCidrs: [],
            bindings: [{ subject: 'private-subject', userId: session.user.id }],
        }
        const { service, calls } = fixture({
            read: async () => ({
                version: 1,
                revision: 1,
                providers: [
                    provider,
                    { ...provider, id: 'disabled', enabled: false },
                    { ...provider, id: 'unbound', bindings: [] },
                    {
                        ...provider,
                        id: 'provisioning',
                        bindings: [],
                        accountPolicy: {
                            provisioning: true,
                            groupClaim: 'groups',
                            defaultRoleKeys: [],
                            groupRoleMappings: [],
                        },
                    },
                ],
            }),
        })
        expect(await service.getPublicOidcProvidersService()).toEqual([
            { id: provider.id, name: 'Office' },
            { id: 'provisioning', name: 'Office' },
        ])
        expect(calls).toEqual([])
    })
    test('locks settings before fresh authorization and audits before publication', async () => {
        const { service, calls } = fixture()
        expect(
            await service.saveOidcProvidersService({ expectedRevision: 0, providers: [] }),
        ).toEqual({ revision: 1, providers: [] })
        expect(calls).toEqual(['limit', 'lock', 'authorize', 'build', 'write', 'audit', 'publish'])
    })

    test('rejects a non-owner even with administrative permissions', async () => {
        const { service, calls } = fixture({
            session: async () => ({
                ...session,
                user: {
                    ...session.user,
                    roles: ['admin'],
                    permissions: ['app.access', 'users.update'],
                },
            }),
        })
        await expect(
            service.saveOidcProvidersService({ expectedRevision: 0, providers: [] }),
        ).rejects.toMatchObject({ code: 'owner_required' })
        await expect(service.getOidcProvidersService()).rejects.toMatchObject({
            code: 'owner_required',
        })
        expect(calls).toEqual([])
    })

    test('fresh transaction authorization failure prevents any save or publication', async () => {
        const { service, calls } = fixture({
            authorize: async () => {
                calls.push('authorize')
                throw new AuthDomainError(
                    'reauthentication_required',
                    'Recent authentication is required.',
                )
            },
        })
        await expect(
            service.saveOidcProvidersService({ expectedRevision: 0, providers: [] }),
        ).rejects.toMatchObject({ code: 'reauthentication_required' })
        expect(calls).toEqual(['limit', 'lock', 'authorize'])
    })

    test('checks optimistic revision after authorization and before any save', async () => {
        const { service, calls } = fixture()
        await expect(
            service.saveOidcProvidersService({ expectedRevision: 1, providers: [] }),
        ).rejects.toMatchObject({ code: 'configuration_conflict' })
        expect(calls).toEqual(['limit', 'lock', 'authorize'])
    })

    test('rechecks owner and recent session before returning configuration', async () => {
        const { service, calls } = fixture()
        expect(await service.getOidcProvidersService()).toEqual({ revision: 0, providers: [] })
        expect(calls).toEqual(['read', 'authorize'])
    })

    test('rejects an inactive or inaccessible explicit binding before encrypting or writing', async () => {
        const { service, calls } = fixture({
            validateUser: async () => {
                calls.push('binding')
                throw new Error('inaccessible user')
            },
        })
        await expect(
            service.saveOidcProvidersService({
                expectedRevision: 0,
                providers: [
                    {
                        id: '0194f777-4074-7000-8000-000000000003',
                        name: 'Identity',
                        enabled: true,
                        issuer: 'https://identity.example.test',
                        clientId: 'client',
                        clientSecret: 'secret',
                        tokenEndpointAuthMethod: 'client_secret_basic',
                        allowedEndpointOrigins: ['https://identity.example.test'],
                        allowedPrivateCidrs: [],
                        bindings: [{ subject: 'subject', userId: session.user.id }],
                    },
                ],
            }),
        ).rejects.toThrow('inaccessible user')
        expect(calls).toEqual(['limit', 'lock', 'authorize', 'binding'])
    })
})
