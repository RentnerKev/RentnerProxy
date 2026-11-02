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
