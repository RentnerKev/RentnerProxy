import '@tanstack/react-start/server-only'

import { and, eq, gt } from 'drizzle-orm'

import { PERMISSIONS } from '../../../config/permissions.config'
import { passwordResetTokens, sessions, users } from '../../../db/schema'
import type { ChangePasswordResult, CurrentSession } from '../Core/Types/auth-service.types'
import { getAuthDatabase } from '../Core/database.server'
import { AuthDomainError } from '../Core/errors.server'
import { hashPassword, verifyPassword } from '../Core/password.server'
import { enforcePasswordChangeRateLimit } from '../../redis/rate-limiter.service'
import { requirePermissionInTransaction } from '../Access/rbac.service'
import {
    getCurrentSessionService,
    markSessionReauthenticatedInTransaction,
    revokeOtherUserSessionsInTransaction,
} from '../Access/sessions.service'

export async function changeCurrentPasswordService(input: {
    currentPassword: string
    password: string
}): Promise<ChangePasswordResult> {
    const currentSession = await getCurrentSessionService()

    if (!currentSession) {
        throw new AuthDomainError('authentication_required', 'Authentication is required.')
    }

    if (!currentSession.user.permissions.includes(PERMISSIONS.ACCOUNT_UPDATE)) {
        throw new AuthDomainError('permission_denied', 'Permission is required.')
    }

    await enforcePasswordChangeRateLimit(currentSession.user.id)

    const passwordHash = await hashPassword(input.password)
    const now = new Date()
    const db = getAuthDatabase()

    return db.transaction(async (transaction) => {
        const userRows = await transaction
            .select({ passwordHash: users.passwordHash, status: users.status })
            .from(users)
            .where(eq(users.id, currentSession.user.id))
            .limit(1)
            .for('update')
        const user = userRows.at(0)

        if (!user || user.status !== 'active' || !user.passwordHash) {
            throw new AuthDomainError('authentication_required', 'Authentication is required.')
        }

        await requirePermissionInTransaction(
            transaction,
            currentSession.user.id,
            PERMISSIONS.ACCOUNT_UPDATE,
        )

        const sessionRows = await transaction
            .select({ id: sessions.id })
            .from(sessions)
            .where(
                and(
                    eq(sessions.id, currentSession.id),
                    eq(sessions.userId, currentSession.user.id),
                    gt(sessions.expiresAt, now),
                ),
            )
            .limit(1)
            .for('update')

        if (sessionRows.length !== 1) {
            throw new AuthDomainError('authentication_required', 'Authentication is required.')
        }

        const currentPasswordMatches =
            input.currentPassword.length > 0 &&
            input.currentPassword.length <= 256 &&
            (await verifyPassword(input.currentPassword, user.passwordHash))

        if (!currentPasswordMatches) {
            return { success: false as const, code: 'invalid_current_password' as const }
        }

        await transaction
            .update(users)
            .set({ mustChangePassword: false, passwordHash, updatedAt: now })
            .where(eq(users.id, currentSession.user.id))
        await transaction
            .delete(passwordResetTokens)
            .where(eq(passwordResetTokens.userId, currentSession.user.id))
        await revokeOtherUserSessionsInTransaction(
            transaction,
            currentSession.user.id,
            currentSession.id,
        )
        await markSessionReauthenticatedInTransaction(transaction, currentSession)

        return { success: true as const }
    })
}

export async function reauthenticateCurrentSessionWithPasswordService(
    currentSession: CurrentSession,
    password: string,
): Promise<boolean> {
    if (!password || password.length > 256) {
        return false
    }

    return getAuthDatabase().transaction(async (transaction) => {
        const rows = await transaction
            .select({ passwordHash: users.passwordHash, status: users.status })
            .from(users)
            .where(eq(users.id, currentSession.user.id))
            .limit(1)
            .for('share')
        const user = rows.at(0)

        if (!user || user.status !== 'active' || !user.passwordHash) {
            throw new AuthDomainError('authentication_required', 'Authentication is required.')
        }

        if (!(await verifyPassword(password, user.passwordHash))) {
            return false
        }

        return markSessionReauthenticatedInTransaction(transaction, currentSession)
    })
}
