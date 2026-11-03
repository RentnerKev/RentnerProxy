import { expect, mock, test } from 'bun:test'
import type { CurrentSession } from '@/server/Auth/Core/Types/auth-service.types.ts'
import type { AuthTransaction } from '@/server/Auth/Core/Types/database.types.ts'
import type { StoredOidcSettings } from '@/server/Auth/Oidc/Types/oidc-provider.types.ts'
import type { OidcProviderTestDependencies } from '@/server/Auth/Oidc/Types/oidc-provider-test.types.ts'
import { AuthDomainError } from '@/server/Auth/Core/errors.server.ts'
const originalDatabase = process.env.DATABASE_URL
process.env.DATABASE_URL ??= 'postgresql://unit:unit@127.0.0.1:1/rentnerproxy_unit'
const { createOidcProviderTestService } =
    await import('@/server/Auth/Oidc/oidc-provider-test.service.ts')
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
const input = { providerId: '0194f777-4074-7000-8000-000000000003', expectedRevision: 7 }
const settings: StoredOidcSettings = {
    version: 1,
    revision: 7,
    providers: [
        {
            id: input.providerId,
            name: 'Office',
            enabled: false,
            revision: 3,
            issuer: 'https://identity.example',
            clientId: 'client',
            tokenEndpointAuthMethod: 'client_secret_basic',
            allowedEndpointOrigins: ['https://identity.example'],
            allowedPrivateCidrs: [],
            bindings: [],
            clientSecret: { ciphertext: 'must-not-be-decrypted', iv: 'invalid' },
        },
    ],
}
function fixture(overrides: Partial<OidcProviderTestDependencies> = {}) {
    const calls: string[] = []
    const verify = mock(async () => {
        calls.push('verify')
    })
    const dependencies: OidcProviderTestDependencies = {
        session: async () => session,
        transaction: async (run) => run({} as AuthTransaction),
        lock: async () => {
            calls.push('lock')
            return structuredClone(settings)
        },
        /** Records each authorization recheck so tests can verify it runs around network work. */
        authorize: async () => {
            calls.push('authorize')
        },
        limit: async () => {
            calls.push('limit')
        },
        origin: () => 'https://canonical.example',
        verify,
        ...overrides,
    }
    return { calls, verify, service: createOidcProviderTestService(dependencies) }
}
test('tests disabled saved providers without decrypting credentials and rechecks trust after network work', async () => {
    const { service, calls, verify } = fixture()
    expect(await service(input)).toEqual({
        status: 'metadata_verified',
        callbackUrl: 'https://canonical.example/api/auth/oidc/callback',
    })
    expect(calls).toEqual(['limit', 'lock', 'authorize', 'verify', 'lock', 'authorize'])
    expect(verify).toHaveBeenCalledWith(expect.objectContaining({ clientSecret: '', revision: 3 }))
})
test('rejects nonowners before rate or storage work', async () => {
    const { service, calls } = fixture({
        session: async () => ({ ...session, user: { ...session.user, roles: ['admin'] } }),
    })
    await expect(service(input)).rejects.toMatchObject({ code: 'owner_required' })
    expect(calls).toEqual([])
})
test('rejects invalid references, absent providers and stale global revisions before probing', async () => {
    const { service, verify } = fixture()
    await expect(service({ ...input, expectedRevision: -1 })).rejects.toMatchObject({
        code: 'invalid_input',
    })
    await expect(service({ ...input, expectedRevision: 6 })).rejects.toMatchObject({
        code: 'configuration_conflict',
    })
    await expect(
        service({ ...input, providerId: '0194f777-4074-7000-8000-000000000004' }),
    ).rejects.toMatchObject({ code: 'configuration_conflict' })
    expect(verify).not.toHaveBeenCalled()
})
test('fails closed without canonical PUBLIC_ORIGIN before network activity', async () => {
    const { service, verify } = fixture({ origin: () => null })
    await expect(service(input)).rejects.toMatchObject({ code: 'configuration_unavailable' })
    expect(verify).not.toHaveBeenCalled()
})
test('rechecks session validity after network work', async () => {
    let checks = 0
    const { service } = fixture({
        authorize: async () => {
            if (++checks === 2) throw new AuthDomainError('authentication_required', 'Expired.')
        },
    })
    await expect(service(input)).rejects.toMatchObject({ code: 'authentication_required' })
})
test.each(['revision', 'trust', 'removed'] as const)(
    'rejects concurrent %s changes',
    async (change) => {
        let reads = 0
        const { service } = fixture({
            /** Changes the second locked snapshot to simulate concurrent revision or trust edits. */
            lock: async () => {
                const current = structuredClone(settings)
                if (++reads === 2) {
                    if (change === 'revision') return { ...current, revision: current.revision + 1 }
                    if (change === 'trust')
                        current.providers[0]!.allowedEndpointOrigins.push('https://other.example')
                    if (change === 'removed') current.providers.length = 0
                }
                return current
            },
        })
        await expect(service(input)).rejects.toMatchObject({ code: 'configuration_conflict' })
    },
)
