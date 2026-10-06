import '@tanstack/react-start/server-only'

import { eq, sql } from 'drizzle-orm'

import { PERMISSIONS } from '@/config/permissions.config.ts'
import { users } from '@/db/schema.ts'
import type { LoginResult } from '@/server/Auth/Core/Types/auth-service.types.ts'
import { getAuthDatabase } from '@/server/Auth/Core/database.server.ts'
import { isAuthDomainError } from '@/server/Auth/Core/errors.server.ts'
import { normalizeEmail } from '@/server/Auth/Core/identity.server.ts'
import { hashPassword, isValidPassword } from '@/server/Auth/Core/password.server.ts'
import {
    createSessionInTransaction,
    getPasswordAuthenticationFingerprint,
    requirePasswordAuthenticationInTransaction,
} from '@/server/Auth/Access/sessions.service.ts'
import { resolveActiveUserAccessInTransaction } from '@/server/Auth/Access/rbac.service.ts'
import {
    createLoginMfaChallengeService,
    getLoginMfaFactorInTransaction,
} from '@/server/Auth/TwoFactor/two-factor.service.ts'
import { createOpaqueToken } from '@/server/Auth/Core/tokens.server.ts'
import { recordAuditEventBestEffortService } from '@/server/Audit/audit.service.ts'

const dummyPassword = createOpaqueToken()
const dummyPasswordHash = hashPassword(dummyPassword)

function getNormalizedLoginEmail(email: string): string {
    try {
        return normalizeEmail(email)
    } catch {
        return 'invalid-login-identifier@invalid.invalid'
    }
}

export async function loginService(input: {
    email: string
    password: string
}): Promise<LoginResult> {
    const email = getNormalizedLoginEmail(input.email)
    const userRows = await getAuthDatabase()
        .select({
            id: users.id,
            passwordHash: users.passwordHash,
            status: users.status,
        })
        .from(users)
        .where(eq(sql<string>`lower(${users.email})`, email))
        .limit(1)
    const user = userRows.at(0)
    const preparedDummyHash = await dummyPasswordHash
    const passwordToVerify = isValidPassword(input.password) ? input.password : dummyPassword
    const passwordMatches = await Bun.password.verify(
        passwordToVerify,
        user?.passwordHash ?? preparedDummyHash,
    )

    if (!user || user.status !== 'active' || !user.passwordHash || !passwordMatches) {
        await recordAuditEventBestEffortService({
            actorUserId: null,
            actorKind: 'anonymous',
            action: 'login',
            resource: 'session',
            targetId: null,
            result: 'failure',
            metadata: { authenticationMethod: 'password', reason: 'authentication_failed' },
        })
        return { success: false, code: 'invalid_credentials' }
    }

    try {
        const passwordFingerprint = getPasswordAuthenticationFingerprint(user.passwordHash)
        const result = await getAuthDatabase().transaction(
            async (transaction): Promise<LoginResult> => {
                await requirePasswordAuthenticationInTransaction(
                    transaction,
                    user.id,
                    passwordFingerprint,
                )
                const access = await resolveActiveUserAccessInTransaction(transaction, user.id)

                if (!access?.permissions.includes(PERMISSIONS.APP_ACCESS)) {
                    return { success: false, code: 'invalid_credentials' }
                }

                const factor = await getLoginMfaFactorInTransaction(transaction, user.id)

                if (factor) {
                    const challenge = await createLoginMfaChallengeService({
                        factorId: factor.id,
                        passwordFingerprint,
                        userId: user.id,
                    })
                    return {
                        challenge: { id: challenge.id, expiresAt: challenge.expiresAt },
                        requiresTwoFactor: true,
                        success: true,
                    }
                }

                const session = await createSessionInTransaction(transaction, user.id)
                return {
                    requiresTwoFactor: false,
                    success: true,
                    user: session.user,
                    session: {
                        id: session.id,
                        token: session.token,
                        expiresAt: session.expiresAt,
                    },
                }
            },
        )

        if (!result.success) {
            await recordAuditEventBestEffortService({
                actorUserId: null,
                actorKind: 'anonymous',
                action: 'login',
                resource: 'session',
                targetId: null,
                result: 'denied',
                metadata: { authenticationMethod: 'password', reason: 'authentication_failed' },
            })
        }

        return result
    } catch (error) {
        await recordAuditEventBestEffortService({
            actorUserId: null,
            actorKind: 'anonymous',
            action: 'login',
            resource: 'session',
            targetId: null,
            result: 'failure',
            metadata: { authenticationMethod: 'password' },
        })
        if (isAuthDomainError(error) && error.code === 'user_not_active') {
            return { success: false, code: 'invalid_credentials' }
        }

        throw error
    }
}
