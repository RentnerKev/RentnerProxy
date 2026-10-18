import { beforeEach, expect, mock, test } from 'bun:test'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { AuthenticationResponseJSON } from '@simplewebauthn/server'
import type { CurrentSession } from '@/server/Auth/Core/Types/auth-service.types.ts'
import type { PasskeyTestDatabase } from './Types/passkey-state-test.types.ts'
import { AuthDomainError } from '@/server/Auth/Core/errors.server.ts'

const userId = '0198f2f0-0000-7000-8000-000000000001'
const currentSession = { id: 'existing-session', user: { id: userId } } as CurrentSession
let stored = {
    id: 'passkey-1',
    counter: 1,
    credentialId: 'credential-1',
    publicKey: new Uint8Array([1]),
    transports: ['internal'],
    backedUp: false,
    deviceType: 'singleDevice',
}
let active = true
let beforeTransaction: (() => void) | null = null
let verificationHook: (() => Promise<void>) | null = null
let transactionTail = Promise.resolve()
const consumed = new Set<string>()
const events: string[] = []
const dialect = new PgDialect()

const database: PasskeyTestDatabase = {
    select: () => ({
        from: () => {
            const result = {
                innerJoin: () => result,
                where: () => result,
                limit: async () => [
                    {
                        passkey: structuredClone(stored),
                        userId,
                        userStatus: active ? 'active' : 'disabled',
                    },
                ],
            }
            return result
        },
    }),
    update: () => ({
        set: (values: Partial<typeof stored>) => ({
            where: (condition: SQL) => ({
                returning: async () => {
                    const query = dialect.sqlToQuery(condition)
                    // This fixture enforces the database's compare-and-update admission rule.
                    if (query.params[0] !== stored.id || query.params[1] !== stored.counter)
                        return []
                    Object.assign(stored, values)
                    events.push('credential-updated')
                    return [{ id: stored.id }]
                },
            }),
        }),
    }),
    transaction: async <T>(
        callback: (transaction: PasskeyTestDatabase) => Promise<T>,
    ): Promise<T> => {
        const previous = transactionTail
        const next = Promise.withResolvers<void>()
        transactionTail = next.promise
        await previous
        beforeTransaction?.()
        beforeTransaction = null
        const original = structuredClone(stored)
        try {
            return await callback(database)
        } catch (error) {
            stored = original
            throw error
        } finally {
            next.resolve()
        }
    },
}
mock.module('@tanstack/react-start/server-only', () => ({}))
mock.module('@/server/Auth/Core/database.server.ts', () => ({ getAuthDatabase: () => database }))
mock.module('@/server/Configuration/management-origin.server.ts', () => ({
    getRuntimeWebAuthnConfiguration: async () => ({
        origin: 'https://unit.invalid',
        rpId: 'unit.invalid',
    }),
}))
mock.module('@/server/Valkey/auth-challenges.service.ts', () => ({
    createAuthChallenge: async () => {
        throw new Error('Not used')
    },
    consumeAuthChallenge: async (kind: string, flowId: string) => {
        if (consumed.has(flowId)) return null
        consumed.add(flowId)
        return { kind, challenge: 'challenge', userId, sessionId: currentSession.id }
    },
}))
mock.module('@simplewebauthn/server', () => ({
    generateAuthenticationOptions: async () => {
        throw new Error('Not used')
    },
    generateRegistrationOptions: async () => {
        throw new Error('Not used')
    },
    verifyRegistrationResponse: async () => {
        throw new Error('Not used')
    },
    verifyAuthenticationResponse: async () => {
        await verificationHook?.()
        return {
            verified: true,
            authenticationInfo: {
                credentialBackedUp: true,
                newCounter: 2,
                credentialDeviceType: 'multiDevice',
            },
        }
    },
}))
mock.module('@/server/Auth/Access/authorization.service.ts', () => ({
    requireRecentAuthenticationForSession: async () => undefined,
    requireSessionPermission: async () => undefined,
}))
mock.module('@/server/Auth/Access/rbac.service.ts', () => ({
    requirePermissionInTransaction: async () => undefined,
}))
mock.module('@/server/Auth/Access/sessions.service.ts', () => ({
    createSessionInTransaction: async () => {
        if (!active) throw new AuthDomainError('user_not_active', 'Inactive fixture user')
        events.push('session-created')
        return { id: 'new-session', token: 'unit-token', expiresAt: new Date(0) }
    },
    markSessionReauthenticatedInTransaction: async () => {
        events.push('session-refreshed')
        return active
    },
    requireRecentSessionInTransaction: async () => undefined,
    revokeOtherUserSessionsInTransaction: async () => {
        events.push('others-revoked')
    },
}))
mock.module('@/server/Audit/audit.service.ts', () => ({
    appendAuditEventInTransactionService: async () => {
        events.push('audit')
    },
    recordAuditEventBestEffortService: async () => undefined,
}))
const { finishDiscoverablePasskeyAuthenticationService, finishPasskeyReauthenticationService } =
    await import('@/server/Auth/Passkey/passkey.service.ts')
const response = {
    id: 'credential-1',
    response: { userHandle: Buffer.from(userId.replaceAll('-', ''), 'hex').toString('base64url') },
} as AuthenticationResponseJSON
function complete(kind: 'login' | 'reauthentication', flowId = 'flow-1') {
    return kind === 'login'
        ? finishDiscoverablePasskeyAuthenticationService({ flowId, response })
        : finishPasskeyReauthenticationService({ currentSession, flowId, response })
}
beforeEach(() => {
    stored = { ...stored, id: 'passkey-1', counter: 1, backedUp: false, deviceType: 'singleDevice' }
    active = true
    consumed.clear()
    events.length = 0
    beforeTransaction = null
    verificationHook = null
    transactionTail = Promise.resolve()
})
for (const kind of ['login', 'reauthentication'] as const) {
    test(`${kind} commits credential metadata before issuing or refreshing a session`, async () => {
        expect(await complete(kind)).toMatchObject({ success: true })
        expect(stored).toMatchObject({ counter: 2, backedUp: true, deviceType: 'multiDevice' })
        expect(events[0]).toBe('credential-updated')
        expect(events[1]).toBe(kind === 'login' ? 'session-created' : 'session-refreshed')
        expect(await complete(kind)).toEqual({ code: 'challenge_expired', success: false })
    })
    for (const changed of ['counter', 'id'] as const) {
        test(`${kind} rejects a credential ${changed} changed after verification`, async () => {
            beforeTransaction = () => {
                if (changed === 'counter') stored.counter = 3
                else stored.id = 'replacement'
            }
            expect(await complete(kind)).toEqual({ code: 'authentication_failed', success: false })
            expect(events).toEqual([])
        })
    }
    test(`${kind} admits one of two verifications of the same stored counter`, async () => {
        const barrier = Promise.withResolvers<void>()
        let arrivals = 0
        verificationHook = async () => {
            if (++arrivals === 2) barrier.resolve()
            await barrier.promise
        }
        const results = await Promise.all([complete(kind, 'first'), complete(kind, 'second')])
        expect(results.filter((result) => result.success)).toHaveLength(1)
        expect(events.filter((event) => event === 'credential-updated')).toHaveLength(1)
    })
}
test('login rechecks inactive users in the session transaction and rolls back the counter', async () => {
    beforeTransaction = () => {
        active = false
    }
    expect(await complete('login')).toEqual({ code: 'authentication_failed', success: false })
    expect(stored.counter).toBe(1)
    expect(events).not.toContain('session-created')
})
