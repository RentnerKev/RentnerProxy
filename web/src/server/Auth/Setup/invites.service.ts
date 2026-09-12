import { auditAuthOperation } from '../Core/audit-auth.server'
import '@tanstack/react-start/server-only'

import { and, eq, gt, isNull, sql } from 'drizzle-orm'

import { ACTIVE_OWNER_ADVISORY_LOCK_ID, USER_INVITE_DURATION_MS } from '../../../config/auth.config'
import { PERMISSIONS } from '../../../config/permissions.config'
import { userInvites, users } from '../../../db/schema'
import type { TokenConsumptionResult, TokenDelivery } from '../Core/Types/auth-service.types'
import { requirePermissionService } from '../Access/authorization.service'
import { getCurrentSessionService } from '../Access/sessions.service'
import { getAuthDatabase } from '../Core/database.server'
import { AuthDomainError } from '../Core/errors.server'
import { isUniqueConstraintViolation } from '../Core/database-errors.server'
import {
    normalizeDisplayName,
    normalizeEmail,
    normalizePendingDisplayName,
    PENDING_DISPLAY_NAME,
} from '../Core/identity.server'
import { hashPassword } from '../Core/password.server'
import { enforceInviteRateLimit } from '../../redis/rate-limiter.service'
import {
    assertRoleAssignmentAllowedInTransaction,
    getUserRoleKeysInTransaction,
    hasOwnerRole,
    loadRolesByKeysInTransaction,
    replaceUserRolesInTransaction,
    requirePermissionInTransaction,
} from '../Access/rbac.service'
import { createOpaqueToken, hashOpaqueToken, isValidOpaqueToken } from '../Core/tokens.server'
import {
    appendAuditEventInTransaction,
    recordAuditEventBestEffort,
} from '../../Audit/audit.service'

export async function issueInviteService(input: {
    displayName?: string | undefined
    email: string
    roleKeys: ReadonlyArray<string>
}): Promise<TokenDelivery & { readonly userId: string }> {
    const actor = await requirePermissionService(PERMISSIONS.USERS_CREATE).catch(
        async (error: unknown) => {
            if (error instanceof AuthDomainError && error.code === 'permission_denied') {
                const session = await getCurrentSessionService().catch(() => null)
                if (session) {
                    await recordAuditEventBestEffort({
                        actorUserId: session.user.id,
                        actorKind: 'user',
                        action: 'create',
                        resource: 'invite',
                        targetId: null,
                        result: 'denied',
                        metadata: { failureCode: 'permission_denied' },
                    })
                }
            }
            throw error
        },
    )
    const email = normalizeEmail(input.email)
    await enforceInviteRateLimit({ actorUserId: actor.id, email })

    const pendingDisplayName = normalizePendingDisplayName(input.displayName)
    const token = createOpaqueToken()
    const tokenHash = await hashOpaqueToken(token)
    const expiresAt = new Date(Date.now() + USER_INVITE_DURATION_MS)
    const db = getAuthDatabase()

    try {
        return await db.transaction(async (transaction) => {
            await transaction.execute(
                sql`select pg_advisory_xact_lock(${ACTIVE_OWNER_ADVISORY_LOCK_ID})`,
            )
            const transactionActor = await requirePermissionInTransaction(
                transaction,
                actor.id,
                PERMISSIONS.USERS_CREATE,
            )
            await requirePermissionInTransaction(
                transaction,
                actor.id,
                PERMISSIONS.USERS_ASSIGN_ROLES,
            )
            const selectedRoles = await loadRolesByKeysInTransaction(transaction, input.roleKeys)
            const nextRoleKeys = selectedRoles.map((role) => role.key)
            await assertRoleAssignmentAllowedInTransaction(
                transaction,
                transactionActor,
                selectedRoles,
            )

            const existingUserRows = await transaction
                .select({
                    displayName: users.displayName,
                    id: users.id,
                    status: users.status,
                })
                .from(users)
                .where(eq(sql<string>`lower(${users.email})`, email))
                .limit(1)
                .for('update')
            const existingUser = existingUserRows.at(0)
            let userId: string
            let deliveryDisplayName = input.displayName === undefined ? '' : pendingDisplayName
            let currentRoleKeys: Array<string> = []

            if (existingUser) {
                if (existingUser.status !== 'pending') {
                    throw new AuthDomainError('email_conflict', 'Email address is already in use.')
                }

                userId = existingUser.id
                deliveryDisplayName =
                    input.displayName === undefined
                        ? existingUser.displayName === PENDING_DISPLAY_NAME
                            ? ''
                            : existingUser.displayName
                        : pendingDisplayName
                currentRoleKeys = await getUserRoleKeysInTransaction(transaction, userId)

                if (input.displayName !== undefined) {
                    await transaction
                        .update(users)
                        .set({ displayName: pendingDisplayName, updatedAt: new Date() })
                        .where(eq(users.id, userId))
                }
            } else {
                const insertedUsers = await transaction
                    .insert(users)
                    .values({
                        displayName: pendingDisplayName,
                        email,
                        passwordHash: null,
                        status: 'pending',
                    })
                    .returning({ id: users.id })
                const insertedUser = insertedUsers.at(0)

                if (!insertedUser) {
                    throw new AuthDomainError(
                        'service_unavailable',
                        'Pending user could not be created.',
                    )
                }

                userId = insertedUser.id
            }

            if (
                (hasOwnerRole(currentRoleKeys) || hasOwnerRole(nextRoleKeys)) &&
                !hasOwnerRole(transactionActor.roles)
            ) {
                throw new AuthDomainError('owner_required', 'Only an owner may invite owners.')
            }

            await replaceUserRolesInTransaction(transaction, userId, selectedRoles)
            await transaction.delete(userInvites).where(eq(userInvites.userId, userId))
            await transaction.insert(userInvites).values({
                expiresAt,
                invitedByUserId: actor.id,
                tokenHash,
                userId,
            })
            await appendAuditEventInTransaction(transaction, {
                actorUserId: actor.id,
                actorKind: 'user',
                action: 'create',
                resource: 'invite',
                targetId: userId,
                result: 'success',
            })

            return {
                displayName: deliveryDisplayName,
                email,
                token,
                expiresAt,
                userId,
            }
        })
    } catch (error) {
        await recordAuditEventBestEffort({
            actorUserId: actor.id,
            actorKind: 'user',
            action: 'create',
            resource: 'invite',
            targetId: null,
            result:
                error instanceof AuthDomainError &&
                (error.code === 'permission_denied' || error.code === 'owner_required')
                    ? 'denied'
                    : 'failure',
        })
        if (isUniqueConstraintViolation(error)) {
            throw new AuthDomainError('email_conflict', 'Email address is already in use.')
        }

        throw error
    }
}

export async function acceptInviteService(input: {
    displayName: string
    token: string
    password: string
}): Promise<TokenConsumptionResult> {
    return auditAuthOperation(
        {
            actorUserId: null,
            actorKind: 'anonymous',
            action: 'accept',
            resource: 'invite',
            targetId: null,
        },
        async () => {
            const displayName = normalizeDisplayName(input.displayName)

            if (!isValidOpaqueToken(input.token)) {
                return { success: false, code: 'invalid_or_expired_token' }
            }

            const tokenHash = await hashOpaqueToken(input.token)
            const now = new Date()
            const db = getAuthDatabase()

            return db.transaction(async (transaction) => {
                const inviteRows = await transaction
                    .select({ id: userInvites.id, userId: userInvites.userId })
                    .from(userInvites)
                    .where(
                        and(
                            eq(userInvites.tokenHash, tokenHash),
                            gt(userInvites.expiresAt, now),
                            isNull(userInvites.acceptedAt),
                        ),
                    )
                    .limit(1)
                const invite = inviteRows.at(0)

                if (!invite) {
                    return { success: false as const, code: 'invalid_or_expired_token' as const }
                }

                const userRows = await transaction
                    .select({ id: users.id, status: users.status })
                    .from(users)
                    .where(eq(users.id, invite.userId))
                    .limit(1)
                    .for('update')
                const user = userRows.at(0)

                if (!user || user.status !== 'pending') {
                    return { success: false as const, code: 'invalid_or_expired_token' as const }
                }

                const lockedInviteRows = await transaction
                    .select({ id: userInvites.id })
                    .from(userInvites)
                    .where(
                        and(
                            eq(userInvites.id, invite.id),
                            eq(userInvites.tokenHash, tokenHash),
                            gt(userInvites.expiresAt, now),
                            isNull(userInvites.acceptedAt),
                        ),
                    )
                    .limit(1)
                    .for('update')

                if (lockedInviteRows.length !== 1) {
                    return { success: false as const, code: 'invalid_or_expired_token' as const }
                }

                const passwordHash = await hashPassword(input.password)

                const acceptedInvites = await transaction
                    .update(userInvites)
                    .set({ acceptedAt: now })
                    .where(and(eq(userInvites.id, invite.id), isNull(userInvites.acceptedAt)))
                    .returning({ id: userInvites.id })

                if (acceptedInvites.length !== 1) {
                    return { success: false as const, code: 'invalid_or_expired_token' as const }
                }

                const activatedUsers = await transaction
                    .update(users)
                    .set({
                        displayName,
                        emailVerifiedAt: now,
                        passwordHash,
                        status: 'active',
                        updatedAt: now,
                    })
                    .where(and(eq(users.id, user.id), eq(users.status, 'pending')))
                    .returning({ id: users.id })

                if (activatedUsers.length !== 1) {
                    throw new AuthDomainError(
                        'service_unavailable',
                        'Invitation could not be accepted.',
                    )
                }

                await appendAuditEventInTransaction(transaction, {
                    actorUserId: user.id,
                    actorKind: 'user',
                    action: 'accept',
                    resource: 'invite',
                    targetId: user.id,
                    result: 'success',
                    metadata: { authenticationMethod: 'invite' },
                })
                return { success: true as const, userId: user.id }
            })
        },
    )
}
