import { describe, expect, test } from 'bun:test'

import { createOpaqueToken } from '../server/Auth/Core/tokens.server'
import {
    confirmTotpSetupInputSchema,
    finishPasskeyRegistrationInputSchema,
    finishPasskeyReauthenticationInputSchema,
    renamePasskeyInputSchema,
} from '../features/Auth/Account/validation'

const opaqueChallenge = createOpaqueToken()
const credentialId = 'AQIDBA'
const passkeyRegistrationResponse = {
    clientExtensionResults: {},
    id: credentialId,
    rawId: credentialId,
    response: {
        attestationObject: 'AQIDBA',
        clientDataJSON: 'AQIDBA',
        transports: ['internal'] as const,
    },
    type: 'public-key',
}
const passkeyAuthenticationResponse = {
    clientExtensionResults: {},
    id: credentialId,
    rawId: credentialId,
    response: {
        authenticatorData: 'AQIDBA',
        clientDataJSON: 'AQIDBA',
        signature: 'BQYHCA',
        userHandle: null,
    },
    type: 'public-key',
}

describe('account security validation', () => {
    test('accepts only six-digit TOTP confirmation codes', () => {
        expect(
            confirmTotpSetupInputSchema.safeParse({
                challengeId: opaqueChallenge,
                code: '123456',
            }).success,
        ).toBeTrue()
        expect(
            confirmTotpSetupInputSchema.safeParse({
                challengeId: opaqueChallenge,
                code: '12345',
            }).success,
        ).toBeFalse()
        expect(
            confirmTotpSetupInputSchema.safeParse({
                challengeId: opaqueChallenge,
                code: '12345a',
            }).success,
        ).toBeFalse()
    })

    test('accepts password reauthentication as a separate action input', () => {
        expect(
            renamePasskeyInputSchema.parse({
                passkeyId: '123e4567-e89b-12d3-a456-426614174000',
                name: '  Laptop  ',
            }),
        ).toMatchObject({ name: 'Laptop' })

        const parsed = renamePasskeyInputSchema.parse({
            passkeyId: '123e4567-e89b-12d3-a456-426614174000',
            name: 'Laptop',
            reauthentication: { method: 'password', credential: 'password' },
        })
        expect(parsed).toEqual({
            passkeyId: '123e4567-e89b-12d3-a456-426614174000',
            name: 'Laptop',
        })
    })

    test('requires a passkey registration challenge and response', () => {
        expect(
            finishPasskeyRegistrationInputSchema.safeParse({
                challengeId: opaqueChallenge,
                response: passkeyRegistrationResponse,
            }).success,
        ).toBeTrue()
        expect(finishPasskeyRegistrationInputSchema.safeParse({}).success).toBeFalse()

        expect(
            finishPasskeyReauthenticationInputSchema.safeParse({
                challengeId: opaqueChallenge,
                response: passkeyAuthenticationResponse,
            }).success,
        ).toBeTrue()
    })
})
