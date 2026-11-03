import { afterEach, beforeAll, expect, mock, spyOn } from 'bun:test'
import { eq } from 'drizzle-orm'
import * as webauthn from '@simplewebauthn/server'
import type { RegistrationResponseJSON, VerifiedRegistrationResponse } from '@simplewebauthn/server'
import { passkeys } from '@/db/schema.ts'
import * as configuration from '@/server/Configuration/management-origin.server.ts'
import * as challenges from '@/server/Valkey/auth-challenges.service.ts'
import { getCurrentSessionService } from '@/server/Auth/Access/sessions.service.ts'
import {
    beginPasskeyRegistrationService,
    finishPasskeyRegistrationService,
    getPasskeysForUserService,
} from '@/server/Auth/Passkey/passkey.service.ts'
import {
    asBackendActor,
    backendCoverageEnabled,
    cleanupBackendCoverage,
    createBackendActor,
    database,
    initializeBackendRegistry,
    integrationTest,
} from '@/tests/Helpers/backendCoverageFixture.ts'
const config = {
    origin: 'https://coverage.example.com',
    rpId: 'coverage.example.com',
    rpName: 'Coverage fixture',
}
const response: RegistrationResponseJSON = {
    id: 'registration-fixture',
    rawId: 'registration-fixture',
    type: 'public-key',
    clientExtensionResults: {},
    response: {
        clientDataJSON: 'fixture',
        attestationObject: 'fixture',
        transports: ['internal', 'usb'],
    },
}
const verified: VerifiedRegistrationResponse = {
    verified: true,
    registrationInfo: {
        fmt: 'none',
        aaguid: '00000000-0000-0000-0000-000000000000',
        credential: {
            id: 'registered-credential-fixture',
            publicKey: new Uint8Array([1, 2, 3]),
            counter: 0,
        },
        credentialType: 'public-key',
        attestationObject: new Uint8Array(),
        userVerified: true,
        credentialDeviceType: 'singleDevice',
        credentialBackedUp: false,
        origin: config.origin,
        rpID: config.rpId,
    },
}
beforeAll(async () => {
    if (backendCoverageEnabled) await initializeBackendRegistry()
})
afterEach(async () => {
    mock.restore()
    if (backendCoverageEnabled) await cleanupBackendCoverage()
})
async function session() {
    const actor = await createBackendActor()
    const current = await asBackendActor(actor, getCurrentSessionService)
    if (!current) throw new Error('Missing current session fixture')
    return current
}

integrationTest(
    'verified registration persists opaque credential bytes, defaults its name, excludes existing credentials and rejects replay',
    async () => {
        const current = await session()
        spyOn(configuration, 'getRuntimeWebAuthnConfiguration').mockResolvedValue(config)
        const consumed = spyOn(challenges, 'consumeAuthChallenge').mockResolvedValue({
            kind: 'webauthn-registration',
            challenge: 'registration-challenge',
            sessionId: current.id,
            userId: current.user.id,
            createdAt: new Date().toISOString(),
        })
        const verification = spyOn(webauthn, 'verifyRegistrationResponse').mockResolvedValue(
            verified,
        )
        expect(
            await finishPasskeyRegistrationService({
                currentSession: current,
                flowId: 'registration-flow',
                response,
            }),
        ).toEqual({ success: true })
        expect(verification).toHaveBeenCalledWith({
            response,
            expectedChallenge: 'registration-challenge',
            expectedOrigin: config.origin,
            expectedRPID: config.rpId,
            requireUserVerification: true,
        })
        const stored = await getPasskeysForUserService(current.user.id)
        expect(stored).toHaveLength(1)
        expect(stored[0]?.name).toBe('Passkey')
        const [credential] = await database
            .select()
            .from(passkeys)
            .where(eq(passkeys.userId, current.user.id))
        expect(credential?.publicKey).toEqual(new Uint8Array([1, 2, 3]))
        expect(credential?.transports).toEqual(['internal', 'usb'])
        expect(
            await finishPasskeyRegistrationService({
                currentSession: current,
                flowId: 'duplicate-flow',
                response,
            }),
        ).toEqual({ success: false, code: 'registration_failed' })
        consumed.mockResolvedValue(null)
        expect(
            await finishPasskeyRegistrationService({
                currentSession: current,
                flowId: 'used-flow',
                response,
            }),
        ).toEqual({ success: false, code: 'challenge_expired' })
        const issued = spyOn(challenges, 'createAuthChallenge').mockResolvedValue({
            id: 'new-registration-flow',
            expiresAt: new Date(Date.now() + 60000),
        })
        const options = await beginPasskeyRegistrationService(current)
        expect(options.flowId).toBe('new-registration-flow')
        expect(options.options.excludeCredentials?.map((item) => item.id)).toEqual([
            'registered-credential-fixture',
        ])
        expect(issued).toHaveBeenCalledWith(
            expect.objectContaining({
                kind: 'webauthn-registration',
                userId: current.user.id,
                sessionId: current.id,
            }),
            expect.any(Number),
        )
    },
)

integrationTest(
    'registration rejects foreign challenges and failed authenticator verification without persisting credentials',
    async () => {
        const current = await session()
        spyOn(configuration, 'getRuntimeWebAuthnConfiguration').mockResolvedValue(config)
        const challenge = {
            kind: 'webauthn-registration' as const,
            challenge: 'registration-challenge',
            sessionId: current.id,
            userId: current.user.id,
            createdAt: new Date().toISOString(),
        }
        const consumed = spyOn(challenges, 'consumeAuthChallenge').mockResolvedValue({
            ...challenge,
            userId: Bun.randomUUIDv7(),
        })
        const verification = spyOn(webauthn, 'verifyRegistrationResponse').mockResolvedValue({
            verified: false,
        })
        expect(
            await finishPasskeyRegistrationService({
                currentSession: current,
                flowId: 'foreign-user',
                response,
            }),
        ).toEqual({ success: false, code: 'challenge_expired' })
        consumed.mockResolvedValue({ ...challenge, sessionId: Bun.randomUUIDv7() })
        expect(
            await finishPasskeyRegistrationService({
                currentSession: current,
                flowId: 'foreign-session',
                response,
            }),
        ).toEqual({ success: false, code: 'challenge_expired' })
        expect(verification).not.toHaveBeenCalled()
        consumed.mockResolvedValue(challenge)
        expect(
            await finishPasskeyRegistrationService({
                currentSession: current,
                flowId: 'unverified',
                response,
            }),
        ).toEqual({ success: false, code: 'registration_failed' })
        verification.mockRejectedValueOnce(new Error('invalid authenticator signature'))
        expect(
            await finishPasskeyRegistrationService({
                currentSession: current,
                flowId: 'invalid-signature',
                response,
            }),
        ).toEqual({ success: false, code: 'registration_failed' })
        verification.mockResolvedValue(verified)
        await expect(
            finishPasskeyRegistrationService({
                currentSession: current,
                flowId: 'invalid-name',
                name: 'x'.repeat(201),
                response,
            }),
        ).rejects.toMatchObject({ code: 'invalid_input' })
        expect(await getPasskeysForUserService(current.user.id)).toEqual([])
    },
)

integrationTest(
    'registration is unavailable without canonical WebAuthn configuration',
    async () => {
        const current = await session()
        spyOn(configuration, 'getRuntimeWebAuthnConfiguration').mockResolvedValue(null)
        await expect(beginPasskeyRegistrationService(current)).rejects.toMatchObject({
            code: 'service_unavailable',
        })
        expect(await getPasskeysForUserService(current.user.id)).toEqual([])
    },
)
