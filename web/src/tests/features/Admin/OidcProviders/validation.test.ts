import { describe, expect, test } from 'bun:test'
import { providerDraft, providerInput } from '@/features/Admin/OidcProviders/validation.ts'
import { saveOidcProvidersSchema } from '@/lib/Auth/Oidc/validation.ts'

const draft = {
    ...providerDraft(),
    name: 'Fixture SSO',
    issuer: 'https://identity.example.test/realms/proxy',
    clientId: 'fixture-client',
    clientSecret: 'synthetic-fixture-secret',
}

describe('OIDC editor endpoint-origin normalization', () => {
    test('retains account policy and binding generations when editing unrelated provider details', () => {
        const input = providerInput(draft)
        const provider = {
            ...input,
            revision: 5,
            credentialConfigured: true,
            accountPolicy: {
                provisioning: true,
                groupClaim: 'groups',
                defaultRoleKeys: ['viewer'],
                groupRoleMappings: [{ group: 'Operators', roleKeys: ['admin'] }],
            },
            bindings: [
                {
                    subject: 'stable-subject',
                    userId: '0194f777-4074-7000-8000-000000000002',
                    roleSource: 'provider' as const,
                    generation: 4,
                },
            ],
        }
        const editable = providerDraft(provider)
        editable.name = 'Renamed provider'
        const updated = providerInput(editable)
        expect(updated.accountPolicy).toEqual(provider.accountPolicy)
        expect(updated.accountPolicy).not.toBe(provider.accountPolicy)
        expect(updated.bindings).toEqual(provider.bindings)
        expect(updated).not.toHaveProperty('clientSecret')
        expect(
            saveOidcProvidersSchema.safeParse({ expectedRevision: 5, providers: [updated] })
                .success,
        ).toBeTrue()
    })
    test.each(['', '\n', ' \t\r\n ', ' , ,\n'])(
        'uses the issuer origin when the list has no nonblank entries: %j',
        (endpointOrigins) => {
            const input = providerInput({ ...draft, endpointOrigins })
            expect(input.allowedEndpointOrigins).toEqual(['https://identity.example.test'])
            expect(
                saveOidcProvidersSchema.safeParse({ expectedRevision: 0, providers: [input] })
                    .success,
            ).toBeTrue()
            const retained = providerInput({ ...draft, clientSecret: '', endpointOrigins })
            expect(retained.allowedEndpointOrigins).toEqual(input.allowedEndpointOrigins)
            expect(retained).not.toHaveProperty('clientSecret')
        },
    )

    test('retains every explicit nonblank origin for validation instead of replacing malformed input', () => {
        expect(
            providerInput({
                ...draft,
                endpointOrigins: ' https://identity.example.test ,\nhttps://keys.example.test\n',
            }).allowedEndpointOrigins,
        ).toEqual(['https://identity.example.test', 'https://keys.example.test'])
        const invalid = providerInput({
            ...draft,
            endpointOrigins: ' http://insecure.example.test\n',
        })
        expect(invalid.allowedEndpointOrigins).toEqual(['http://insecure.example.test'])
        expect(
            saveOidcProvidersSchema.safeParse({ expectedRevision: 0, providers: [invalid] })
                .success,
        ).toBeFalse()
    })
})
