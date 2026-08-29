import '@tanstack/react-start/server-only'

import { and, eq, gt, lte } from 'drizzle-orm'

import { SESSION_DURATION_MS, SESSION_LAST_SEEN_INTERVAL_MS } from '../../../config/auth.config'
import { PERMISSIONS } from '../../../config/permissions.config'
import { sessions, users } from '../../../db/schema'
import type { CurrentSession } from '../Core/Types/auth-service.types'
import { getSessionCookie } from './cookies.server'
import { getAuthDatabase, type AuthTransaction } from '../Core/database.server'
import { AuthDomainError } from '../Core/errors.server'
import { resolveActiveUserAccessInTransaction } from './rbac.service'
import { createOpaqueToken, hashOpaqueToken, isValidOpaqueToken } from '../Core/tokens.server'

export async function createSessionService(userId: string) {
    const token = createOpaqueToken()
    const tokenHash = await hashOpaqueToken(token)
    const expiresAt = new Date(Date.now() + SESSION_DURATION_MS)
    const db = getAuthDatabase()

    return db.transaction(async (transaction) => {
        const userRows = await transaction
            .select({ id: users.id, status: users.status })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1)
            .for('share')
        const user = userRows.at(0)

        if (!user || user.status !== 'active') {
            throw new AuthDomainError('user_not_active', 'User is not active.')
        }

        const sessionRows = await transaction
            .insert(sessions)
            .values({ expiresAt, tokenHash, userId })
            .returning({ id: sessions.id })
        const session = sessionRows.at(0)

        if (!session) {
            throw new AuthDomainError('service_unavailable', 'Session could not be created.')
        }

        const access = await resolveActiveUserAccessInTransaction(transaction, userId)

        if (!access) {
            throw new AuthDomainError('user_not_active', 'User is not active.')
        }

        return { id: session.id, token, expiresAt, user: access }
    })
}

export async function getSessionByTokenService(token: string): Promise<CurrentSession | null> {
    if (!isValidOpaqueToken(token)) {
        return null
    }

    const tokenHash = await hashOpaqueToken(token)
    const now = new Date()
    const touchCutoff = new Date(now.getTime() - SESSION_LAST_SEEN_INTERVAL_MS)
    const db = getAuthDatabase()

    return db.transaction(async (transaction) => {
        const rows = await transaction
            .select({
                expiresAt: sessions.expiresAt,
                id: sessions.id,
                userId: sessions.userId,
            })
            .from(sessions)
            .innerJoin(users, eq(users.id, sessions.userId))
            .where(
                and(
                    eq(sessions.tokenHash, tokenHash),
                    gt(sessions.expiresAt, now),
                    eq(users.status, 'active'),
                ),
            )
            .limit(1)
        const session = rows.at(0)

        if (!session) {
            return null
        }

        const user = await resolveActiveUserAccessInTransaction(transaction, session.userId)

        if (!user || !user.permissions.includes(PERMISSIONS.APP_ACCESS)) {
            return null
        }

        await transaction
            .update(sessions)
            .set({ lastSeenAt: now })
            .where(and(eq(sessions.id, session.id), lte(sessions.lastSeenAt, touchCutoff)))

        return {
            id: session.id,
            expiresAt: session.expiresAt,
            user,
        }
    })
}

export async function getCurrentSessionService(): Promise<CurrentSession | null> {
    const token = getSessionCookie()
    return token ? getSessionByTokenService(token) : null
}

export async function revokeSessionByTokenService(token: string): Promise<boolean> {
    if (!isValidOpaqueToken(token)) {
        return false
    }

    const tokenHash = await hashOpaqueToken(token)
    const deletedSessions = await getAuthDatabase()
        .delete(sessions)
        .where(eq(sessions.tokenHash, tokenHash))
        .returning({ id: sessions.id })

    return deletedSessions.length > 0
}

export async function revokeCurrentSessionService(): Promise<boolean> {
    const token = getSessionCookie()
    return token ? revokeSessionByTokenService(token) : false
}

export async function revokeAllUserSessionsInTransaction(
    transaction: AuthTransaction,
    userId: string,
): Promise<void> {
    await transaction.delete(sessions).where(eq(sessions.userId, userId))
}
