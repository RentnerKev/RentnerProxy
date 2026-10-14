import { describe, expect, test } from 'bun:test'

import {
    authenticationResponseSchema,
    registrationResponseSchema,
} from '@/lib/Auth/webauthn.validation.ts'

const authentication = {
    id: 'AQIDBA',
    rawId: 'AQIDBA',
    type: 'public-key',
    clientExtensionResults: {},
    response: {
        authenticatorData: 'AQIDBA',
        clientDataJSON: 'AQIDBA',
        signature: 'BQYHCA',
    },
}
const registration = {
    id: 'AQIDBA',
    rawId: 'AQIDBA',
    type: 'public-key',
    clientExtensionResults: {},
    response: { attestationObject: 'AQIDBA', clientDataJSON: 'AQIDBA' },
}

describe('WebAuthn SDK response normalization', () => {
    test('omits absent and nullable optional fields while retaining a valid user handle', () => {
        for (const userHandle of [undefined, null]) {
            const parsed = authenticationResponseSchema.parse({
                ...authentication,
                authenticatorAttachment: undefined,
                response: { ...authentication.response, userHandle },
            })
            expect(Object.hasOwn(parsed, 'authenticatorAttachment')).toBeFalse()
            expect(Object.hasOwn(parsed.response, 'userHandle')).toBeFalse()
        }
        expect(
            authenticationResponseSchema.parse({
                ...authentication,
                authenticatorAttachment: 'platform',
                response: { ...authentication.response, userHandle: 'CQoLDA' },
            }),
        ).toMatchObject({
            authenticatorAttachment: 'platform',
            response: { userHandle: 'CQoLDA' },
        })
    })

    test('preserves registration transports and omits undefined optional properties', () => {
        const parsed = registrationResponseSchema.parse({
            ...registration,
            authenticatorAttachment: undefined,
            response: { ...registration.response, transports: undefined },
        })
        expect(Object.hasOwn(parsed, 'authenticatorAttachment')).toBeFalse()
        expect(Object.hasOwn(parsed.response, 'transports')).toBeFalse()
        expect(
            registrationResponseSchema.parse({
                ...registration,
                response: {
                    ...registration.response,
                    transports: ['internal', 'future-transport'],
                },
            }).response.transports,
        ).toEqual(['internal', 'future-transport'])
    })

    test('validates known extension fields and retains future extension outputs', () => {
        const extensions = {
            appid: false,
            credProps: { rk: true },
            hmacCreateSecret: true,
            futureExtension: { enabled: true },
        }
        for (const schema of [authenticationResponseSchema, registrationResponseSchema]) {
            const response = schema === authenticationResponseSchema ? authentication : registration
            expect(
                schema.parse({ ...response, clientExtensionResults: extensions })
                    .clientExtensionResults,
            ).toEqual(extensions)
            for (const invalid of [
                null,
                [],
                'invalid',
                { appid: 'yes' },
                { credProps: { rk: 1 } },
                { hmacCreateSecret: null },
                { prf: { enabled: 'yes' } },
            ]) {
                expect(
                    schema.safeParse({ ...response, clientExtensionResults: invalid }).success,
                ).toBeFalse()
            }
        }
    })

    test('preserves PRF buffers and rejects invalid PRF result shapes', () => {
        const first = new Uint8Array([1, 2, 3]).buffer
        const parsed = authenticationResponseSchema.parse({
            ...authentication,
            clientExtensionResults: {
                prf: { enabled: true, results: { first, second: undefined } },
            },
        })
        expect(parsed.clientExtensionResults.prf?.results?.first).toBe(first)
        expect(
            Object.hasOwn(parsed.clientExtensionResults.prf?.results ?? {}, 'second'),
        ).toBeFalse()
        expect(
            authenticationResponseSchema.safeParse({
                ...authentication,
                clientExtensionResults: { prf: { results: { first: 'AQIDBA' } } },
            }).success,
        ).toBeFalse()
    })

    test('accepts SDK PRF buffer views with their original byte range', () => {
        const bytes = new Uint8Array([9, 1, 2, 3, 8])
        for (const first of [bytes.subarray(1, 4), new DataView(bytes.buffer, 1, 3)]) {
            const second = bytes.subarray(2, 4)
            const parsed = authenticationResponseSchema.parse({
                ...authentication,
                clientExtensionResults: { prf: { results: { first, second } } },
            })
            expect(parsed.clientExtensionResults.prf?.results?.first).toBe(first)
            expect(parsed.clientExtensionResults.prf?.results?.second).toBe(second)
            expect(first.byteOffset).toBe(1)
            expect(first.byteLength).toBe(3)
        }
    })

    test('retains credential identity and size restrictions before normalization', () => {
        for (const invalid of [
            { ...authentication, rawId: 'BQYHCA' },
            { ...authentication, id: 'invalid+' },
            {
                ...authentication,
                response: { ...authentication.response, signature: 'A'.repeat(16_385) },
            },
        ]) {
            expect(authenticationResponseSchema.safeParse(invalid).success).toBeFalse()
        }
    })
})
