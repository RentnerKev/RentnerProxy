import { auditAuthOperation } from '../Core/audit-auth.server'
import '@tanstack/react-start/server-only'

import { and, eq, gt, isNotNull, isNull, lte, or, sql } from 'drizzle-orm'

import { PASSWORD_RESET_DURATION_MS } from '../../../config/auth.config'
import { passwordResetTokens, users } from '../../../db/schema'
import { sendPasswordResetEmailService } from '../../Mail/mail.service'
import type { TokenConsumptionResult, TokenDelivery } from '../Core/Types/auth-service.types'
import { getAuthDatabase } from '../Core/database.server'
import { normalizeEmail } from '../Core/identity.server'
import { hashPassword } from '../Core/password.server'
import { revokeAllUserSessionsInTransaction } from '../Access/sessions.service'
import { createOpaqueToken, hashOpaqueToken, isValidOpaqueToken } from '../Core/tokens.server'
import {
    appendAuditEventInTransaction,
    recordAuditEventBestEffort,
} from '../../Audit/audit.service'

async function createPasswordResetDelivery(emailInput: string): Promise<TokenDelivery | null> {
    let email: string

    try {
        email = normalizeEmail(emailInput)
    } catch {
        return null
    }

    const token = createOpaqueToken()
    const tokenHash = await hashOpaqueToken(token)
    const now = new Date()
    const expiresAt = new Date(now.getTime() + PASSWORD_RESET_DURATION_MS)
    const db = getAuthDatabase()

    return db.transaction(async (transaction) => {
        const userRows = await transaction
            .select({ displayName: users.displayName, email: users.email, id: users.id })
            .from(users)
            .where(and(eq(sql<string>`lower(${users.email})`, email), eq(users.status, 'active')))
            .limit(1)
            .for('update')
        const user = userRows.at(0)

        if (!user) {
            return null
        }

        await transaction
            .delete(passwordResetTokens)
            .where(
                and(
                    eq(passwordResetTokens.userId, user.id),
                    or(
                        lte(passwordResetTokens.expiresAt, now),
                        isNotNull(passwordResetTokens.consumedAt),
                    ),
                ),
            )
        await transaction.insert(passwordResetTokens).values({
            expiresAt,
            tokenHash,
            userId: user.id,
        })

        return {
            displayName: user.displayName,
            email: user.email,
            token,
            expiresAt,
        }
    })
}

export async function issuePasswordResetService(emailInput: string): Promise<TokenDelivery | null> {
    return createPasswordResetDelivery(emailInput)
}

export async function requestPasswordResetService(emailInput: string): Promise<void> {
    await recordAuditEventBestEffort({
        actorUserId: null,
        actorKind: 'anonymous',
        action: 'request',
        resource: 'password',
        targetId: null,
        result: 'success',
    })
    const delivery = await createPasswordResetDelivery(emailInput)

    if (!delivery) {
        return
    }

    void sendPasswordResetEmailService({
        displayName: delivery.displayName,
        to: delivery.email,
        token: delivery.token,
    }).catch(() => console.warn('[auth] password reset delivery unavailable'))
}

export async function consumePasswordResetService(input: {
    token: string
    password: string
}): Promise<TokenConsumptionResult> {
    return auditAuthOperation(
        {
            actorUserId: null,
            actorKind: 'anonymous',
            action: 'reset',
            resource: 'password',
            targetId: null,
        },
        async () => {
            if (!isValidOpaqueToken(input.token)) {
                return { success: false, code: 'invalid_or_expired_token' }
            }

            const tokenHash = await hashOpaqueToken(input.token)
            const now = new Date()
            const db = getAuthDatabase()

            return db.transaction(async (transaction) => {
                const tokenRows = await transaction
                    .select({ id: passwordResetTokens.id, userId: passwordResetTokens.userId })
                    .from(passwordResetTokens)
                    .where(
                        and(
                            eq(passwordResetTokens.tokenHash, tokenHash),
                            gt(passwordResetTokens.expiresAt, now),
                            isNull(passwordResetTokens.consumedAt),
                        ),
                    )
                    .limit(1)
                const resetToken = tokenRows.at(0)

                if (!resetToken) {
                    return { success: false as const, code: 'invalid_or_expired_token' as const }
                }

                const userRows = await transaction
                    .select({ id: users.id, status: users.status })
                    .from(users)
                    .where(eq(users.id, resetToken.userId))
                    .limit(1)
                    .for('update')
                const user = userRows.at(0)

                if (!user || user.status !== 'active') {
                    return { success: false as const, code: 'invalid_or_expired_token' as const }
                }

                const lockedTokenRows = await transaction
                    .select({ id: passwordResetTokens.id })
                    .from(passwordResetTokens)
                    .where(
                        and(
                            eq(passwordResetTokens.id, resetToken.id),
                            eq(passwordResetTokens.tokenHash, tokenHash),
                            gt(passwordResetTokens.expiresAt, now),
                            isNull(passwordResetTokens.consumedAt),
                        ),
                    )
                    .limit(1)
                    .for('update')

                if (lockedTokenRows.length !== 1) {
                    return { success: false as const, code: 'invalid_or_expired_token' as const }
                }

                const passwordHash = await hashPassword(input.password)

                const consumedTokens = await transaction
                    .update(passwordResetTokens)
                    .set({ consumedAt: now })
                    .where(
                        and(
                            eq(passwordResetTokens.userId, user.id),
                            isNull(passwordResetTokens.consumedAt),
                        ),
                    )
                    .returning({ id: passwordResetTokens.id })

                if (!consumedTokens.some((token) => token.id === resetToken.id)) {
                    return { success: false as const, code: 'invalid_or_expired_token' as const }
                }

                await transaction
                    .update(users)
                    .set({ passwordHash, updatedAt: now })
                    .where(eq(users.id, user.id))
                await revokeAllUserSessionsInTransaction(transaction, user.id)
                await appendAuditEventInTransaction(transaction, {
                    actorUserId: user.id,
                    actorKind: 'user',
                    action: 'reset',
                    resource: 'password',
                    targetId: user.id,
                    result: 'success',
                })

                return { success: true as const, userId: user.id }
            })
        },
    )
}
