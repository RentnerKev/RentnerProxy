import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { saveOidcProvidersSchema } from '@/lib/Auth/Oidc/validation.ts'
import type { SaveOidcProvidersInput } from '@/lib/Auth/Oidc/Types/oidc-provider.types.ts'
import {
    buildStoredOidcSettings,
    DEFAULT_OIDC_SETTINGS,
    decryptOidcClientSecret,
    parseStoredOidcSettings,
    summarizeOidcSettings,
} from '@/server/Auth/Oidc/oidc-settings.server.ts'

const originalKey = process.env.APP_ENCRYPTION_KEY
beforeEach(() => {
    process.env.APP_ENCRYPTION_KEY = Buffer.from(new Uint8Array(32).fill(31)).toString('base64')
})
afterEach(() => {
    if (originalKey === undefined) delete process.env.APP_ENCRYPTION_KEY
    else process.env.APP_ENCRYPTION_KEY = originalKey
})

const provider: SaveOidcProvidersInput['providers'][number] = {
    id: '0194f777-4074-7000-8000-000000000001',
    name: 'Office identity',
    enabled: true,
    issuer: 'https://identity.example.test/realm',
    clientId: 'rentnerproxy',
    clientSecret: 'private-client-secret',
    tokenEndpointAuthMethod: 'client_secret_basic',
    allowedEndpointOrigins: ['https://identity.example.test'],
    allowedPrivateCidrs: [],
    bindings: [
        { subject: 'Case-Sensitive-Subject', userId: '0194f777-4074-7000-8000-000000000002' },
    ],
}
function input(
    overrides: Partial<typeof provider> = {},
    expectedRevision = 0,
): SaveOidcProvidersInput {
    return { expectedRevision, providers: [{ ...provider, ...overrides }] }
}

describe('OIDC provider settings', () => {
    test('assigns server generations and preserves retained legacy or current identities', async () => {
        const first = await buildStoredOidcSettings(
            DEFAULT_OIDC_SETTINGS,
            input({ bindings: [{ ...provider.bindings[0]!, generation: 900 }] }),
        )
        expect(first.providers[0]!.bindings[0]!.generation).toBe(1)
        const retained = await buildStoredOidcSettings(
            first,
            input({ bindings: [{ ...provider.bindings[0]!, generation: 0 }] }, 1),
        )
        expect(retained.providers[0]!.bindings[0]!.generation).toBe(1)
        const legacy = {
            ...first,
            providers: first.providers.map((entry) =>
                Object.assign({}, entry, { bindings: provider.bindings }),
            ),
        }
        const legacyRetained = await buildStoredOidcSettings(legacy, input({}, 1))
        expect(legacyRetained.providers[0]!.bindings[0]!.generation).toBe(0)
        const deleted = await buildStoredOidcSettings(retained, input({ bindings: [] }, 2))
        const relinked = await buildStoredOidcSettings(
            deleted,
            input({ bindings: [{ ...provider.bindings[0]!, generation: 1 }] }, 3),
        )
        expect(relinked.providers[0]!.bindings[0]!.generation).toBe(4)
    })
    test('encrypts secrets and exposes credential presence only', async () => {
        const stored = await buildStoredOidcSettings(DEFAULT_OIDC_SETTINGS, input())
        expect(stored.revision).toBe(1)
        expect(stored.providers[0]?.revision).toBe(1)
        expect(JSON.stringify(stored)).not.toContain(provider.clientSecret!)
        expect(await decryptOidcClientSecret(stored.providers[0]!)).toBe(provider.clientSecret!)
        const summary = summarizeOidcSettings(stored)
        expect(summary.providers[0]?.credentialConfigured).toBeTrue()
        expect(JSON.stringify(summary)).not.toContain('ciphertext')
        expect(JSON.stringify(summary)).not.toContain('clientSecret')
        expect(parseStoredOidcSettings(JSON.stringify(stored))).toEqual(stored)
    })

    test('keeps revision history after deleting and recreating providers', async () => {
        const first = await buildStoredOidcSettings(DEFAULT_OIDC_SETTINGS, input())
        const deleted = await buildStoredOidcSettings(first, { expectedRevision: 1, providers: [] })
        const recreated = await buildStoredOidcSettings(deleted, input({}, 2))
        expect(deleted.revision).toBe(2)
        expect(recreated.providers[0]?.revision).toBe(3)
        await expect(buildStoredOidcSettings(recreated, input({}, 1))).rejects.toMatchObject({
            code: 'configuration_conflict',
        })
    })

    test('preserves omitted/blank credentials for unchanged trust only', async () => {
        const first = await buildStoredOidcSettings(DEFAULT_OIDC_SETTINGS, input())
        const updated = await buildStoredOidcSettings(
            first,
            input({ name: 'Renamed', clientSecret: '' }, 1),
        )
        expect(updated.providers[0]?.clientSecret).toEqual(first.providers[0]?.clientSecret)
        await expect(
            buildStoredOidcSettings(
                first,
                input({ clientId: 'other-client', clientSecret: undefined }, 1),
            ),
        ).rejects.toMatchObject({ code: 'invalid_input' })
        await expect(
            buildStoredOidcSettings(
                first,
                input({ allowedPrivateCidrs: ['10.0.0.0/8'], clientSecret: '' }, 1),
            ),
        ).rejects.toMatchObject({ code: 'invalid_input' })
        await expect(
            buildStoredOidcSettings(
                first,
                input({ tokenEndpointAuthMethod: 'client_secret_post', clientSecret: '' }, 1),
            ),
        ).rejects.toMatchObject({ code: 'invalid_input' })
        await expect(
            buildStoredOidcSettings(
                first,
                input(
                    {
                        allowedEndpointOrigins: [
                            'https://identity.example.test',
                            'https://tokens.example.test',
                        ],
                        clientSecret: '',
                    },
                    1,
                ),
            ),
        ).rejects.toMatchObject({ code: 'invalid_input' })
    })

    test('AAD prevents moving ciphertext to another provider or trust context', async () => {
        const first = await buildStoredOidcSettings(DEFAULT_OIDC_SETTINGS, input())
        const saved = first.providers[0]!
        await expect(
            decryptOidcClientSecret({ ...saved, id: '0194f777-4074-7000-8000-000000000003' }),
        ).rejects.toMatchObject({ code: 'configuration_unavailable' })
        await expect(
            decryptOidcClientSecret({ ...saved, issuer: 'https://identity.example.test/other' }),
        ).rejects.toMatchObject({ code: 'configuration_unavailable' })
    })

    test('rejects duplicate issuer subjects, preserves opaque case and rejects extra properties', () => {
        const other = { ...provider, id: '0194f777-4074-7000-8000-000000000003' }
        expect(
            saveOidcProvidersSchema.safeParse({ expectedRevision: 0, providers: [provider, other] })
                .success,
        ).toBeFalse()
        expect(
            saveOidcProvidersSchema.safeParse({
                expectedRevision: 0,
                providers: [
                    provider,
                    {
                        ...other,
                        bindings: [{ ...other.bindings[0]!, subject: 'case-sensitive-subject' }],
                    },
                ],
            }).success,
        ).toBeTrue()
        expect(
            saveOidcProvidersSchema.safeParse({ ...input(), provisionUsers: true }).success,
        ).toBeFalse()
    })

    test.each(['not-a-url', '', '://'])(
        'fails validation without throwing for malformed URL %s',
        (malformed) => {
            expect(
                saveOidcProvidersSchema.safeParse(input({ issuer: malformed })).success,
            ).toBeFalse()
            expect(
                saveOidcProvidersSchema.safeParse(input({ allowedEndpointOrigins: [malformed] }))
                    .success,
            ).toBeFalse()
        },
    )

    test.each([
        '',
        'subject with spaces',
        ' subject',
        'subject ',
        'üser',
        'line\nfeed',
        'x'.repeat(256),
    ])('rejects unusable OIDC subject %s', (subject) => {
        expect(
            saveOidcProvidersSchema.safeParse(
                input({ bindings: [{ subject, userId: provider.bindings[0]!.userId }] }),
            ).success,
        ).toBeFalse()
    })

    test('preserves subject case and printable ASCII punctuation exactly', () => {
        const subject = "Case-Sensitive!$%&'()*+,-./:;<=>?@[\\]^_`{|}~"
        const parsed = saveOidcProvidersSchema.parse(
            input({ bindings: [{ subject, userId: provider.bindings[0]!.userId }] }),
        )
        expect(parsed.providers[0]?.bindings[0]?.subject).toBe(subject)
    })

    test.each([
        'http://identity.example.test',
        'https://user:secret@identity.example.test',
        'https://identity.example.test/?',
        'https://identity.example.test/#',
        ' https://identity.example.test',
        'https://identity.example.test\\evil',
    ])('rejects unsafe issuer %s', (issuer) => {
        expect(saveOidcProvidersSchema.safeParse(input({ issuer })).success).toBeFalse()
    })

    test.each(['0.0.0.0/0', '10.0.0.0/7', '169.254.0.0/16', '::/0'])(
        'rejects overbroad/private-policy exception %s',
        async (cidr) => {
            await expect(
                buildStoredOidcSettings(
                    DEFAULT_OIDC_SETTINGS,
                    input({ allowedPrivateCidrs: [cidr] }),
                ),
            ).rejects.toMatchObject({ code: 'invalid_input' })
        },
    )

    test('fails closed for malformed, unknown-version, and inconsistent persisted data', async () => {
        const first = await buildStoredOidcSettings(DEFAULT_OIDC_SETTINGS, input())
        for (const value of [
            '{broken',
            { version: 2, revision: 1, providers: [] },
            { ...first, revision: 0 },
            { ...first, providers: [first.providers[0], first.providers[0]] },
        ])
            expect(() => parseStoredOidcSettings(value)).toThrow('configuration_unavailable')
    })
})
