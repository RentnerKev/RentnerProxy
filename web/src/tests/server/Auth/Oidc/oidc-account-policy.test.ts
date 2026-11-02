import { describe, expect, test } from 'bun:test'
import { OIDC_LIMITS } from '@/config/oidc.config.ts'
import { oidcAccountPolicySchema, oidcProviderSchema } from '@/lib/Auth/Oidc/validation.ts'
import type { OidcProviderConfiguration } from '@/lib/Auth/Oidc/Types/oidc-provider.types.ts'
const originalDatabase = process.env.DATABASE_URL
process.env.DATABASE_URL ??= 'postgresql://unit:unit@127.0.0.1:1/rentnerproxy_unit'
const { resolveOidcRoleKeys } = await import('@/server/Auth/Oidc/oidc-accounts.service.ts')
if (originalDatabase === undefined) delete process.env.DATABASE_URL

const provider: OidcProviderConfiguration = {
    id: '0194f777-4074-7000-8000-000000000003',
    name: 'Office',
    enabled: true,
    issuer: 'https://identity.example.test',
    clientId: 'client',
    tokenEndpointAuthMethod: 'client_secret_basic',
    allowedEndpointOrigins: ['https://identity.example.test'],
    allowedPrivateCidrs: [],
    bindings: [],
}
const policy = {
    provisioning: true,
    groupClaim: 'groups',
    defaultRoleKeys: ['viewer'],
    groupRoleMappings: [{ group: 'Operators', roleKeys: ['operator', 'viewer'] }],
}

describe('OIDC account policy', () => {
    test('old providers remain explicit-link only without policy or role-source defaults', () => {
        const parsed = oidcProviderSchema.parse(provider)
        expect(parsed.accountPolicy).toBeUndefined()
        expect(resolveOidcRoleKeys(parsed, ['Operators'])).toEqual([])
    })
    test('uses exact signed groups, deduplicates grants and drops missing mappings', () => {
        expect(resolveOidcRoleKeys({ ...provider, accountPolicy: policy }, ['Operators'])).toEqual([
            'viewer',
            'operator',
        ])
        expect(resolveOidcRoleKeys({ ...provider, accountPolicy: policy }, ['operators'])).toEqual([
            'viewer',
        ])
        expect(resolveOidcRoleKeys({ ...provider, accountPolicy: policy })).toEqual(['viewer'])
    })
    test('rejects unbounded proof groups instead of applying partial grants', () => {
        expect(() =>
            resolveOidcRoleKeys(
                provider,
                Array.from({ length: OIDC_LIMITS.groups + 1 }, () => 'Operators'),
            ),
        ).toThrow()
        expect(() =>
            resolveOidcRoleKeys(provider, ['x'.repeat(OIDC_LIMITS.groupLength + 1)]),
        ).toThrow()
    })
    test('rejects nested claim paths, duplicate mappings and unknown policy fields', () => {
        expect(
            oidcAccountPolicySchema.safeParse({ ...policy, groupClaim: 'realm.groups' }).success,
        ).toBe(false)
        expect(
            oidcAccountPolicySchema.safeParse({
                ...policy,
                groupRoleMappings: [policy.groupRoleMappings[0], policy.groupRoleMappings[0]],
            }).success,
        ).toBe(false)
        expect(oidcAccountPolicySchema.safeParse({ ...policy, autoLinkEmail: true }).success).toBe(
            false,
        )
    })
})
