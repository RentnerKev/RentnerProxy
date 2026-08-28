import '@tanstack/react-start/server-only'

import { eq, sql } from 'drizzle-orm'

import { users } from '../../../db/schema'
import type { LoginResult } from '../Core/Types/auth-service.types'
import { getAuthDatabase } from '../Core/database.server'
import { isAuthDomainError } from '../Core/errors.server'
import { normalizeEmail } from '../Core/identity.server'
import { hashPassword, isValidPassword, verifyPassword } from '../Core/password.server'
import { createSessionService } from '../Access/sessions.service'
import { createOpaqueToken } from '../Core/tokens.server'

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
    const passwordMatches = await verifyPassword(
        passwordToVerify,
        user?.passwordHash ?? preparedDummyHash,
    )

    if (!user || user.status !== 'active' || !user.passwordHash || !passwordMatches) {
        return { success: false, code: 'invalid_credentials' }
    }

    try {
        const session = await createSessionService(user.id)
        return {
            success: true,
            user: session.user,
            session: {
                id: session.id,
                token: session.token,
                expiresAt: session.expiresAt,
            },
        }
    } catch (error) {
        if (isAuthDomainError(error) && error.code === 'user_not_active') {
            return { success: false, code: 'invalid_credentials' }
        }

        throw error
    }
}
