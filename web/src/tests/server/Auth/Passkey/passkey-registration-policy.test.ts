import { beforeEach, expect, mock, test } from 'bun:test'
import type { RegistrationResponseJSON } from '@simplewebauthn/server'
import type { CurrentSession } from '@/server/Auth/Core/Types/auth-service.types.ts'

let externallyManaged = true
let active = true
let changeManagementDuringVerification = false
let inserts = 0
let generated = 0
const session = {
    id: 'session-1',
    user: { id: 'user-1' },
    reauthenticatedAt: new Date(0),
} as CurrentSession
const transaction = {
    select: () => ({
        from: () => ({
            where: () => ({
                limit: () => ({
                    for: async () => [
                        {
                            status: active ? 'active' : 'disabled',
                            oidcProviderId: externallyManaged ? 'external-provider' : null,
                        },
                    ],
                }),
            }),
        }),
    }),
    insert: () => {
        inserts += 1
        throw new Error('External account must not acquire a local passkey.')
    },
}
mock.module('@tanstack/react-start/server-only', () => ({}))
mock.module('@/server/Auth/Core/database.server.ts', () => ({
    getAuthDatabase: () => ({
        transaction: async (run: (value: typeof transaction) => Promise<unknown>) =>
            run(transaction),
    }),
}))
mock.module('@/server/Auth/Access/authorization.service.ts', () => ({
    requireActiveSessionForSession: async () => undefined,
    requireSessionPermission: async () => undefined,
}))
mock.module('@/server/Auth/Access/sessions.service.ts', () => ({
    createSessionInTransaction: async () => undefined,
    requireActiveSessionInTransaction: async () => undefined,
    revokeOtherUserSessionsInTransaction: async () => undefined,
}))
mock.module('@/server/Auth/Access/rbac.service.ts', () => ({
    requirePermissionInTransaction: async () => undefined,
}))
mock.module('@/server/Audit/audit.service.ts', () => ({
    appendAuditEventInTransactionService: async () => undefined,
    recordAuditEventBestEffortService: async () => undefined,
}))
mock.module('@/server/Configuration/management-origin.server.ts', () => ({
    getRuntimeWebAuthnConfiguration: async () => ({
        origin: 'https://unit.invalid',
        rpId: 'unit.invalid',
    }),
}))
mock.module('@/server/Valkey/auth-challenges.service.ts', () => ({
    createAuthChallenge: async () => {
        throw new Error('Must not issue a registration challenge.')
    },
    consumeAuthChallenge: async () => ({
        userId: session.user.id,
        sessionId: session.id,
        challenge: 'bound-challenge',
    }),
}))
mock.module('@simplewebauthn/server', () => ({
    generateRegistrationOptions: async () => {
        generated += 1
        throw new Error('Must not generate options.')
    },
    generateAuthenticationOptions: async () => undefined,
    verifyAuthenticationResponse: async () => undefined,
    verifyRegistrationResponse: async () => {
        if (changeManagementDuringVerification) externallyManaged = true
        return {
            verified: true,
            registrationInfo: {
                credential: { id: 'credential-1', counter: 0, publicKey: new Uint8Array([1]) },
                credentialBackedUp: true,
                credentialDeviceType: 'multiDevice',
            },
        }
    },
}))
const { beginPasskeyRegistrationService, finishPasskeyRegistrationService } =
    await import('@/server/Auth/Passkey/passkey.service.ts')
beforeEach(() => {
    externallyManaged = true
    active = true
    changeManagementDuringVerification = false
    inserts = 0
    generated = 0
})

test('refuses local passkey enrollment for an externally managed active session before issuing a challenge', async () => {
    await expect(beginPasskeyRegistrationService(session)).rejects.toMatchObject({
        code: 'permission_denied',
    })
    expect(generated).toBe(0)
    expect(inserts).toBe(0)
})
test.each([false, true])(
    'rechecks external credential management transactionally before committing a verified enrollment (%s)',
    async (changedDuringVerification) => {
        externallyManaged = !changedDuringVerification
        changeManagementDuringVerification = changedDuringVerification
        await expect(
            finishPasskeyRegistrationService({
                currentSession: session,
                flowId: 'flow-1',
                response: { id: 'credential-1', response: {} } as RegistrationResponseJSON,
            }),
        ).rejects.toMatchObject({ code: 'permission_denied' })
        expect(inserts).toBe(0)
    },
)
