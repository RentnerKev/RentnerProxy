import '@tanstack/react-start/server-only'

import { and, eq, gt } from 'drizzle-orm'

import { PERMISSIONS } from '@/config/permissions.config.ts'
import { passwordResetTokens, sessions, users } from '@/db/schema.ts'
import type { ChangePasswordResult } from '@/server/Auth/Core/Types/auth-service.types.ts'
import { getAuthDatabase } from '@/server/Auth/Core/database.server.ts'
import { AuthDomainError } from '@/server/Auth/Core/errors.server.ts'
import { hashPassword } from '@/server/Auth/Core/password.server.ts'
import { enforcePasswordChangeRateLimit } from '@/server/Valkey/rate-limiter.service.ts'
import { requirePermissionInTransaction } from '@/server/Auth/Access/rbac.service.ts'
import { appendAuditEventInTransactionService } from '@/server/Audit/audit.service.ts'
import { auditAuthOperation } from '@/server/Auth/Core/audit-auth.server.ts'
import {
    getCurrentSessionService,
    revokeOtherUserSessionsInTransaction,
} from '@/server/Auth/Access/sessions.service.ts'

export async function changeCurrentPasswordService(input: {
    password: string
}): Promise<ChangePasswordResult> {
    const currentSession = await getCurrentSessionService()
    return auditAuthOperation(
        {
            actorUserId: currentSession?.user.id ?? null,
            actorKind: currentSession ? 'user' : 'anonymous',
            action: 'update',
            resource: 'password',
            targetId: currentSession?.user.id ?? null,
        },
        async () => {
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
                    throw new AuthDomainError(
                        'authentication_required',
                        'Authentication is required.',
                    )
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
                    throw new AuthDomainError(
                        'authentication_required',
                        'Authentication is required.',
                    )
                }

                await transaction
                    .update(users)
                    .set({ passwordHash, updatedAt: now })
                    .where(eq(users.id, currentSession.user.id))
                await transaction
                    .delete(passwordResetTokens)
                    .where(eq(passwordResetTokens.userId, currentSession.user.id))
                await revokeOtherUserSessionsInTransaction(
                    transaction,
                    currentSession.user.id,
                    currentSession.id,
                )
                await appendAuditEventInTransactionService(transaction, {
                    actorUserId: currentSession.user.id,
                    actorKind: 'user',
                    action: 'update',
                    resource: 'password',
                    targetId: currentSession.user.id,
                    result: 'success',
                })

                return { success: true as const }
            })
        },
    )
}
