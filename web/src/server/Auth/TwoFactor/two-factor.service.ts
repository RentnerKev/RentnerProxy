import { auditAuthOperation } from '@/server/Auth/Core/audit-auth.server.ts'
import '@tanstack/react-start/server-only'
import { appendAuditEventInTransactionService } from '@/server/Audit/audit.service.ts'

import { and, count, eq, isNull, lt } from 'drizzle-orm'

import {
    LOGIN_MFA_CHALLENGE_DURATION_MS,
    TOTP_SETUP_CHALLENGE_DURATION_MS,
} from '@/config/auth-security.config.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { userRecoveryCodes, userTotpFactors } from '@/db/schema.ts'
import {
    acquireCodeChallengeVerification,
    consumeCodeChallengeVerification,
    createAuthChallenge,
    failCodeChallengeVerification,
    releaseCodeChallengeVerification,
} from '@/server/valkey/auth-challenges.service.ts'
import {
    decodeBase64Url,
    decryptSecret,
    encodeBase64Url,
    encryptSecret,
} from '@/server/Auth/Core/encryption.server.ts'
import { getAuthDatabase, type AuthTransaction } from '@/server/Auth/Core/database.server.ts'
import { AuthDomainError } from '@/server/Auth/Core/errors.server.ts'
import type { CurrentSession } from '@/server/Auth/Core/Types/auth-service.types.ts'
import {
    requireRecentAuthenticationForSession,
    requireSessionPermission,
} from '@/server/Auth/Access/authorization.service.ts'
import {
    createSessionInTransaction,
    requireRecentSessionInTransaction,
    revokeOtherUserSessionsInTransaction,
} from '@/server/Auth/Access/sessions.service.ts'
import { requirePermissionInTransaction } from '@/server/Auth/Access/rbac.service.ts'

import {
    createRecoveryCodeBatch,
    createTotpSecret,
    createTotpUri,
    getMatchedTotpCounter,
    hashRecoveryCode,
    normalizeRecoveryCode,
} from './two-factor-credentials.server.ts'
export interface TwoFactorStatus {
    readonly recoveryCodesRemaining: number
    readonly totpEnabled: boolean
}

export type MfaLoginCompletionResult =
    | {
          readonly code: 'authentication_failed' | 'challenge_expired'
          readonly success: false
      }
    | {
          readonly session: {
              readonly expiresAt: Date
              readonly id: string
              readonly token: string
          }
          readonly success: true
      }

function createTotpEncryptionContext(userId: string): string {
    return `rentnerproxy:totp:${userId}`
}

function normalizeTotpCode(value: string): string | null {
    return /^\d{6}$/.test(value) ? value : null
}

async function insertRecoveryCodeBatch(
    transaction: AuthTransaction,
    userId: string,
    codes: ReadonlyArray<{ hash: string }>,
): Promise<void> {
    await transaction
        .insert(userRecoveryCodes)
        .values(codes.map((code) => ({ codeHash: code.hash, userId })))
}

export async function hasEnabledTotpFactorService(userId: string): Promise<boolean> {
    const rows = await getAuthDatabase()
        .select({ id: userTotpFactors.id })
        .from(userTotpFactors)
        .where(eq(userTotpFactors.userId, userId))
        .limit(1)

    return rows.length === 1
}

export async function getTwoFactorStatusService(userId: string): Promise<TwoFactorStatus> {
    const [factorRows, recoveryRows] = await Promise.all([
        getAuthDatabase()
            .select({ id: userTotpFactors.id })
            .from(userTotpFactors)
            .where(eq(userTotpFactors.userId, userId))
            .limit(1),
        getAuthDatabase()
            .select({ value: count() })
            .from(userRecoveryCodes)
            .where(and(eq(userRecoveryCodes.userId, userId), isNull(userRecoveryCodes.usedAt))),
    ])

    return {
        recoveryCodesRemaining: factorRows.length === 1 ? (recoveryRows.at(0)?.value ?? 0) : 0,
        totpEnabled: factorRows.length === 1,
    }
}

export async function beginTotpSetupService(currentSession: CurrentSession) {
    await requireRecentAuthenticationForSession(currentSession)
    await requireSessionPermission(currentSession, PERMISSIONS.ACCOUNT_UPDATE)

    if (await hasEnabledTotpFactorService(currentSession.user.id)) {
        throw new AuthDomainError('invalid_input', 'Two-factor authentication is already enabled.')
    }

    const secret = createTotpSecret()
    const encrypted = await encryptSecret(
        secret,
        createTotpEncryptionContext(currentSession.user.id),
    )
    const issued = await createAuthChallenge(
        {
            attempts: 0,
            ciphertext: encodeBase64Url(encrypted.ciphertext),
            createdAt: new Date().toISOString(),
            iv: encodeBase64Url(encrypted.iv),
            kind: 'totp-setup',
            sessionId: currentSession.id,
            userId: currentSession.user.id,
        },
        TOTP_SETUP_CHALLENGE_DURATION_MS,
    )

    return {
        expiresAt: issued.expiresAt,
        flowId: issued.id,
        otpAuthUri: createTotpUri(secret, currentSession.user.email),
        secret,
    }
}

export async function confirmTotpSetupService(input: {
    currentSession: CurrentSession
    flowId: string
    token: string
}): Promise<
    | { readonly code: 'authentication_failed' | 'challenge_expired'; readonly success: false }
    | { readonly recoveryCodes: ReadonlyArray<string>; readonly success: true }
> {
    return auditAuthOperation(
        {
            actorUserId: input.currentSession.user.id,
            actorKind: 'user',
            action: 'enable',
            resource: 'totp',
            targetId: input.currentSession.user.id,
        },
        async () => {
            await requireRecentAuthenticationForSession(input.currentSession)
            await requireSessionPermission(input.currentSession, PERMISSIONS.ACCOUNT_UPDATE)

            const verification = await acquireCodeChallengeVerification('totp-setup', input.flowId)

            if (
                !verification ||
                verification.challenge.userId !== input.currentSession.user.id ||
                verification.challenge.sessionId !== input.currentSession.id
            ) {
                return { code: 'challenge_expired', success: false }
            }

            const code = normalizeTotpCode(input.token)
            const ciphertext = decodeBase64Url(verification.challenge.ciphertext)
            const iv = decodeBase64Url(verification.challenge.iv)

            if (!code || !ciphertext || !iv) {
                const failure = await failCodeChallengeVerification({
                    ...verification,
                    kind: 'totp-setup',
                })
                return {
                    code: failure === 'locked' ? 'challenge_expired' : 'authentication_failed',
                    success: false,
                }
            }

            let secret: string

            try {
                secret = await decryptSecret(
                    { ciphertext, iv },
                    createTotpEncryptionContext(input.currentSession.user.id),
                )
            } catch (error) {
                await releaseCodeChallengeVerification({ ...verification, kind: 'totp-setup' })
                throw error
            }

            const matchedCounter = getMatchedTotpCounter(
                secret,
                input.currentSession.user.email,
                code,
            )

            if (matchedCounter === null) {
                const failure = await failCodeChallengeVerification({
                    ...verification,
                    kind: 'totp-setup',
                })
                return {
                    code: failure === 'locked' ? 'challenge_expired' : 'authentication_failed',
                    success: false,
                }
            }

            const consumed = await consumeCodeChallengeVerification({
                ...verification,
                kind: 'totp-setup',
            })

            if (!consumed) {
                return { code: 'challenge_expired', success: false }
            }

            const recoveryCodes = await createRecoveryCodeBatch()
            const created = await getAuthDatabase().transaction(async (transaction) => {
                await requireRecentSessionInTransaction(transaction, input.currentSession)
                await requirePermissionInTransaction(
                    transaction,
                    input.currentSession.user.id,
                    PERMISSIONS.ACCOUNT_UPDATE,
                )
                const now = new Date()
                const factors = await transaction
                    .insert(userTotpFactors)
                    .values({
                        enabledAt: now,
                        lastUsedCounter: matchedCounter,
                        secretCiphertext: ciphertext,
                        secretIv: iv,
                        updatedAt: now,
                        userId: input.currentSession.user.id,
                    })
                    .onConflictDoNothing({ target: userTotpFactors.userId })
                    .returning({ id: userTotpFactors.id })

                if (factors.length !== 1) {
                    return false
                }

                await insertRecoveryCodeBatch(
                    transaction,
                    input.currentSession.user.id,
                    recoveryCodes,
                )
                await revokeOtherUserSessionsInTransaction(
                    transaction,
                    input.currentSession.user.id,
                    input.currentSession.id,
                )
                await appendAuditEventInTransactionService(transaction, {
                    actorUserId: input.currentSession.user.id,
                    actorKind: 'user',
                    action: 'enable',
                    resource: 'totp',
                    targetId: input.currentSession.user.id,
                    result: 'success',
                })
                return true
            })

            return created
                ? {
                      recoveryCodes: recoveryCodes.map((recoveryCode) => recoveryCode.plaintext),
                      success: true,
                  }
                : { code: 'authentication_failed', success: false }
        },
    )
}

export async function regenerateRecoveryCodesService(
    currentSession: CurrentSession,
): Promise<
    | { readonly code: 'authentication_failed'; readonly success: false }
    | { readonly recoveryCodes: ReadonlyArray<string>; readonly success: true }
> {
    return auditAuthOperation(
        {
            actorUserId: currentSession.user.id,
            actorKind: 'user',
            action: 'rotate',
            resource: 'recovery-codes',
            targetId: currentSession.user.id,
        },
        async () => {
            await requireRecentAuthenticationForSession(currentSession)
            await requireSessionPermission(currentSession, PERMISSIONS.ACCOUNT_UPDATE)

            const recoveryCodes = await createRecoveryCodeBatch()
            const regenerated = await getAuthDatabase().transaction(async (transaction) => {
                await requireRecentSessionInTransaction(transaction, currentSession)
                await requirePermissionInTransaction(
                    transaction,
                    currentSession.user.id,
                    PERMISSIONS.ACCOUNT_UPDATE,
                )
                const factors = await transaction
                    .select({ id: userTotpFactors.id })
                    .from(userTotpFactors)
                    .where(eq(userTotpFactors.userId, currentSession.user.id))
                    .limit(1)
                    .for('update')

                if (factors.length !== 1) {
                    return false
                }

                await transaction
                    .delete(userRecoveryCodes)
                    .where(eq(userRecoveryCodes.userId, currentSession.user.id))
                await insertRecoveryCodeBatch(transaction, currentSession.user.id, recoveryCodes)
                await revokeOtherUserSessionsInTransaction(
                    transaction,
                    currentSession.user.id,
                    currentSession.id,
                )
                await appendAuditEventInTransactionService(transaction, {
                    actorUserId: currentSession.user.id,
                    actorKind: 'user',
                    action: 'rotate',
                    resource: 'recovery-codes',
                    targetId: currentSession.user.id,
                    result: 'success',
                })
                return true
            })

            return regenerated
                ? { recoveryCodes: recoveryCodes.map((code) => code.plaintext), success: true }
                : { code: 'authentication_failed', success: false }
        },
    )
}

export async function disableTotpService(currentSession: CurrentSession): Promise<boolean> {
    return auditAuthOperation(
        {
            actorUserId: currentSession.user.id,
            actorKind: 'user',
            action: 'disable',
            resource: 'totp',
            targetId: currentSession.user.id,
        },
        async () => {
            await requireRecentAuthenticationForSession(currentSession)
            await requireSessionPermission(currentSession, PERMISSIONS.ACCOUNT_UPDATE)

            return getAuthDatabase().transaction(async (transaction) => {
                await requireRecentSessionInTransaction(transaction, currentSession)
                await requirePermissionInTransaction(
                    transaction,
                    currentSession.user.id,
                    PERMISSIONS.ACCOUNT_UPDATE,
                )
                const deleted = await transaction
                    .delete(userTotpFactors)
                    .where(eq(userTotpFactors.userId, currentSession.user.id))
                    .returning({ id: userTotpFactors.id })

                if (deleted.length !== 1) {
                    return false
                }

                await transaction
                    .delete(userRecoveryCodes)
                    .where(eq(userRecoveryCodes.userId, currentSession.user.id))
                await revokeOtherUserSessionsInTransaction(
                    transaction,
                    currentSession.user.id,
                    currentSession.id,
                )
                await appendAuditEventInTransactionService(transaction, {
                    actorUserId: currentSession.user.id,
                    actorKind: 'user',
                    action: 'disable',
                    resource: 'totp',
                    targetId: currentSession.user.id,
                    result: 'success',
                })
                return true
            })
        },
    )
}

export async function createLoginMfaChallengeService(userId: string) {
    return createAuthChallenge(
        {
            attempts: 0,
            createdAt: new Date().toISOString(),
            kind: 'login-mfa',
            userId,
        },
        LOGIN_MFA_CHALLENGE_DURATION_MS,
    )
}

export async function completeLoginMfaWithTotpService(input: {
    challengeId: string
    token: string
}): Promise<MfaLoginCompletionResult> {
    return auditAuthOperation(
        {
            actorUserId: null,
            actorKind: 'anonymous',
            action: 'login',
            resource: 'session',
            targetId: null,
            metadata: { authenticationMethod: 'totp' },
        },
        async () => {
            const verification = await acquireCodeChallengeVerification(
                'login-mfa',
                input.challengeId,
            )

            if (!verification) {
                return { code: 'challenge_expired', success: false }
            }

            const code = normalizeTotpCode(input.token)
            const factors = await getAuthDatabase()
                .select({
                    lastUsedCounter: userTotpFactors.lastUsedCounter,
                    secretCiphertext: userTotpFactors.secretCiphertext,
                    secretIv: userTotpFactors.secretIv,
                })
                .from(userTotpFactors)
                .where(eq(userTotpFactors.userId, verification.challenge.userId))
                .limit(1)
            const factor = factors.at(0)

            if (!code || !factor) {
                const failure = await failCodeChallengeVerification({
                    ...verification,
                    kind: 'login-mfa',
                })
                return {
                    code: failure === 'locked' ? 'challenge_expired' : 'authentication_failed',
                    success: false,
                }
            }

            let secret: string

            try {
                secret = await decryptSecret(
                    { ciphertext: factor.secretCiphertext, iv: factor.secretIv },
                    createTotpEncryptionContext(verification.challenge.userId),
                )
            } catch (error) {
                await releaseCodeChallengeVerification({ ...verification, kind: 'login-mfa' })
                throw error
            }

            const matchedCounter = getMatchedTotpCounter(secret, 'login', code)

            if (matchedCounter === null) {
                const failure = await failCodeChallengeVerification({
                    ...verification,
                    kind: 'login-mfa',
                })
                return {
                    code: failure === 'locked' ? 'challenge_expired' : 'authentication_failed',
                    success: false,
                }
            }

            const consumed = await consumeCodeChallengeVerification({
                ...verification,
                kind: 'login-mfa',
            })

            if (!consumed) {
                return { code: 'challenge_expired', success: false }
            }

            try {
                return await getAuthDatabase().transaction(async (transaction) => {
                    const updated = await transaction
                        .update(userTotpFactors)
                        .set({ lastUsedCounter: matchedCounter, updatedAt: new Date() })
                        .where(
                            and(
                                eq(userTotpFactors.userId, consumed.userId),
                                lt(userTotpFactors.lastUsedCounter, matchedCounter),
                            ),
                        )
                        .returning({ id: userTotpFactors.id })

                    if (updated.length !== 1) {
                        return { code: 'authentication_failed' as const, success: false as const }
                    }

                    const session = await createSessionInTransaction(
                        transaction,
                        consumed.userId,
                        'totp',
                    )
                    return {
                        session: {
                            expiresAt: session.expiresAt,
                            id: session.id,
                            token: session.token,
                        },
                        success: true as const,
                    }
                })
            } catch (error) {
                if (error instanceof AuthDomainError && error.code === 'user_not_active') {
                    return { code: 'authentication_failed', success: false }
                }

                throw error
            }
        },
    )
}

export async function completeLoginMfaWithRecoveryCodeService(input: {
    challengeId: string
    recoveryCode: string
}): Promise<MfaLoginCompletionResult> {
    return auditAuthOperation(
        {
            actorUserId: null,
            actorKind: 'anonymous',
            action: 'login',
            resource: 'session',
            targetId: null,
            metadata: { authenticationMethod: 'recovery-code' },
        },
        async () => {
            const verification = await acquireCodeChallengeVerification(
                'login-mfa',
                input.challengeId,
            )

            if (!verification) {
                return { code: 'challenge_expired', success: false }
            }

            const normalized = normalizeRecoveryCode(input.recoveryCode)
            const codeHash = normalized ? await hashRecoveryCode(normalized) : null
            const codeRows = codeHash
                ? await getAuthDatabase()
                      .select({ id: userRecoveryCodes.id })
                      .from(userRecoveryCodes)
                      .where(
                          and(
                              eq(userRecoveryCodes.userId, verification.challenge.userId),
                              eq(userRecoveryCodes.codeHash, codeHash),
                              isNull(userRecoveryCodes.usedAt),
                          ),
                      )
                      .limit(1)
                : []

            if (!codeHash || codeRows.length !== 1) {
                const failure = await failCodeChallengeVerification({
                    ...verification,
                    kind: 'login-mfa',
                })
                return {
                    code: failure === 'locked' ? 'challenge_expired' : 'authentication_failed',
                    success: false,
                }
            }

            const consumed = await consumeCodeChallengeVerification({
                ...verification,
                kind: 'login-mfa',
            })

            if (!consumed) {
                return { code: 'challenge_expired', success: false }
            }

            try {
                return await getAuthDatabase().transaction(async (transaction) => {
                    const used = await transaction
                        .update(userRecoveryCodes)
                        .set({ usedAt: new Date() })
                        .where(
                            and(
                                eq(userRecoveryCodes.userId, consumed.userId),
                                eq(userRecoveryCodes.codeHash, codeHash),
                                isNull(userRecoveryCodes.usedAt),
                            ),
                        )
                        .returning({ id: userRecoveryCodes.id })

                    if (used.length !== 1) {
                        return { code: 'authentication_failed' as const, success: false as const }
                    }

                    const session = await createSessionInTransaction(
                        transaction,
                        consumed.userId,
                        'recovery-code',
                    )
                    return {
                        session: {
                            expiresAt: session.expiresAt,
                            id: session.id,
                            token: session.token,
                        },
                        success: true as const,
                    }
                })
            } catch (error) {
                if (error instanceof AuthDomainError && error.code === 'user_not_active') {
                    return { code: 'authentication_failed', success: false }
                }

                throw error
            }
        },
    )
}
