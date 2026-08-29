import '@tanstack/react-start/server-only'

import { and, asc, eq, ne, sql } from 'drizzle-orm'

import { ACTIVE_OWNER_ADVISORY_LOCK_ID } from '../../../config/auth.config'
import { PERMISSIONS } from '../../../config/permissions.config'
import { passwordResetTokens, roles, userInvites, userRoles, users } from '../../../db/schema'
import type { UserSummary } from '../../../shared/Types/auth.types'
import { sendUserInviteEmailService } from '../../Mail/mail.service'
import { requirePermissionService } from '../../Auth/Access/authorization.service'
import { getAuthDatabase, type AuthTransaction } from '../../Auth/Core/database.server'
import { AuthDomainError } from '../../Auth/Core/errors.server'
import { normalizeDisplayName, normalizeEmail } from '../../Auth/Core/identity.server'
import { issueInviteService } from '../../Auth/Setup/invites.service'
import {
    assertRoleAssignmentAllowedInTransaction,
    countActiveOwnersInTransaction,
    getUserRoleKeysInTransaction,
    hasOwnerRole,
    loadRolesByKeysInTransaction,
    replaceUserRolesInTransaction,
    requirePermissionInTransaction,
} from '../../Auth/Access/rbac.service'
import { revokeAllUserSessionsInTransaction } from '../../Auth/Access/sessions.service'

function isUniqueConstraintViolation(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505'
}

async function lockOwnerPolicy(transaction: AuthTransaction): Promise<void> {
    await transaction.execute(sql`select pg_advisory_xact_lock(${ACTIVE_OWNER_ADVISORY_LOCK_ID})`)
}

async function loadUserForUpdate(transaction: AuthTransaction, userId: string) {
    const rows = await transaction
        .select({
            createdAt: users.createdAt,
            displayName: users.displayName,
            email: users.email,
            id: users.id,
            profileImageVersion: users.profileImageVersion,
            status: users.status,
            updatedAt: users.updatedAt,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1)
        .for('update')

    return rows.at(0) ?? null
}

function assertOwnerManagementAllowed(
    actorRoleKeys: ReadonlyArray<string>,
    currentRoleKeys: ReadonlyArray<string>,
    nextRoleKeys: ReadonlyArray<string>,
): void {
    if (
        (hasOwnerRole(currentRoleKeys) || hasOwnerRole(nextRoleKeys)) &&
        !hasOwnerRole(actorRoleKeys)
    ) {
        throw new AuthDomainError('owner_required', 'Only an owner may manage owner accounts.')
    }
}

async function assertActiveOwnerRemains(
    transaction: AuthTransaction,
    input: {
        currentRoleKeys: ReadonlyArray<string>
        currentStatus: 'pending' | 'active' | 'disabled'
        nextRoleKeys: ReadonlyArray<string>
        nextStatus: 'pending' | 'active' | 'disabled'
    },
): Promise<void> {
    const removesActiveOwner =
        input.currentStatus === 'active' &&
        hasOwnerRole(input.currentRoleKeys) &&
        !(input.nextStatus === 'active' && hasOwnerRole(input.nextRoleKeys))

    if (removesActiveOwner && (await countActiveOwnersInTransaction(transaction)) <= 1) {
        throw new AuthDomainError(
            'last_active_owner',
            'The last active owner cannot be disabled or have the owner role removed.',
        )
    }
}

function toUserSummary(
    user: Omit<UserSummary, 'profileImageVersion' | 'roleKeys'> & {
        profileImageVersion: number
    },
    roleKeys: ReadonlyArray<string>,
): UserSummary {
    return {
        ...user,
        profileImageVersion: user.profileImageVersion > 0 ? user.profileImageVersion : null,
        roleKeys,
    }
}

export async function listUsersService(): Promise<Array<UserSummary>> {
    await requirePermissionService(PERMISSIONS.USERS_VIEW)
    const db = getAuthDatabase()
    const [userRows, roleRows] = await Promise.all([
        db
            .select({
                createdAt: users.createdAt,
                displayName: users.displayName,
                email: users.email,
                id: users.id,
                profileImageVersion: users.profileImageVersion,
                status: users.status,
                updatedAt: users.updatedAt,
            })
            .from(users)
            .orderBy(asc(users.email)),
        db
            .select({ roleKey: roles.key, userId: userRoles.userId })
            .from(userRoles)
            .innerJoin(roles, eq(roles.id, userRoles.roleId)),
    ])
    const roleKeysByUserId = new Map<string, Array<string>>()

    for (const row of roleRows) {
        const roleKeys = roleKeysByUserId.get(row.userId) ?? []
        roleKeys.push(row.roleKey)
        roleKeysByUserId.set(row.userId, roleKeys)
    }

    return userRows.map((user) => toUserSummary(user, roleKeysByUserId.get(user.id) ?? []))
}

export async function createUserService(input: {
    displayName?: string | undefined
    email: string
    roleKeys: ReadonlyArray<string>
}): Promise<void> {
    const delivery = await issueInviteService(input)

    await sendUserInviteEmailService({
        displayName: delivery.displayName,
        to: delivery.email,
        token: delivery.token,
    })
}

export async function updateUserService(input: {
    userId: string
    displayName?: string | undefined
    email?: string | undefined
    roleKeys?: ReadonlyArray<string> | undefined
}): Promise<UserSummary> {
    if (
        input.displayName === undefined &&
        input.email === undefined &&
        input.roleKeys === undefined
    ) {
        throw new AuthDomainError('invalid_input', 'No user changes were provided.')
    }

    const actor = await requirePermissionService(PERMISSIONS.USERS_UPDATE)
    const normalizedDisplayName =
        input.displayName === undefined ? undefined : normalizeDisplayName(input.displayName)
    const normalizedEmail = input.email === undefined ? undefined : normalizeEmail(input.email)
    const db = getAuthDatabase()

    try {
        return await db.transaction(async (transaction) => {
            await lockOwnerPolicy(transaction)
            const transactionActor = await requirePermissionInTransaction(
                transaction,
                actor.id,
                PERMISSIONS.USERS_UPDATE,
            )
            const user = await loadUserForUpdate(transaction, input.userId)

            if (!user) {
                throw new AuthDomainError('user_not_found', 'User was not found.')
            }

            const currentRoleKeys = await getUserRoleKeysInTransaction(transaction, user.id)
            let nextRoleKeys = currentRoleKeys
            let selectedRoles: Awaited<ReturnType<typeof loadRolesByKeysInTransaction>> | null =
                null

            if (input.roleKeys !== undefined) {
                await requirePermissionInTransaction(
                    transaction,
                    actor.id,
                    PERMISSIONS.USERS_ASSIGN_ROLES,
                )
                selectedRoles = await loadRolesByKeysInTransaction(transaction, input.roleKeys)
                await assertRoleAssignmentAllowedInTransaction(
                    transaction,
                    transactionActor,
                    selectedRoles,
                )
                nextRoleKeys = selectedRoles.map((role) => role.key)
            }

            assertOwnerManagementAllowed(transactionActor.roles, currentRoleKeys, nextRoleKeys)
            await assertActiveOwnerRemains(transaction, {
                currentRoleKeys,
                currentStatus: user.status,
                nextRoleKeys,
                nextStatus: user.status,
            })

            const now = new Date()
            const emailChanged = normalizedEmail !== undefined && normalizedEmail !== user.email
            const updatedRows = await transaction
                .update(users)
                .set({
                    ...(normalizedDisplayName === undefined
                        ? {}
                        : { displayName: normalizedDisplayName }),
                    ...(normalizedEmail === undefined ? {} : { email: normalizedEmail }),
                    ...(emailChanged ? { emailVerifiedAt: null } : {}),
                    updatedAt: now,
                })
                .where(eq(users.id, user.id))
                .returning({
                    createdAt: users.createdAt,
                    displayName: users.displayName,
                    email: users.email,
                    id: users.id,
                    profileImageVersion: users.profileImageVersion,
                    status: users.status,
                    updatedAt: users.updatedAt,
                })
            const updatedUser = updatedRows.at(0)

            if (!updatedUser) {
                throw new AuthDomainError('user_not_found', 'User was not found.')
            }

            if (selectedRoles) {
                await replaceUserRolesInTransaction(transaction, user.id, selectedRoles)
            }

            if (emailChanged) {
                await revokeAllUserSessionsInTransaction(transaction, user.id)
                await transaction
                    .delete(passwordResetTokens)
                    .where(eq(passwordResetTokens.userId, user.id))
                await transaction.delete(userInvites).where(eq(userInvites.userId, user.id))
            }

            return toUserSummary(updatedUser, nextRoleKeys)
        })
    } catch (error) {
        if (isUniqueConstraintViolation(error)) {
            throw new AuthDomainError('email_conflict', 'Email address is already in use.')
        }

        throw error
    }
}

export async function disableUserService(userId: string): Promise<UserSummary> {
    const actor = await requirePermissionService(PERMISSIONS.USERS_DISABLE)
    const db = getAuthDatabase()

    return db.transaction(async (transaction) => {
        await lockOwnerPolicy(transaction)
        const transactionActor = await requirePermissionInTransaction(
            transaction,
            actor.id,
            PERMISSIONS.USERS_DISABLE,
        )
        const user = await loadUserForUpdate(transaction, userId)

        if (!user) {
            throw new AuthDomainError('user_not_found', 'User was not found.')
        }

        if (user.id === actor.id) {
            throw new AuthDomainError(
                'permission_denied',
                'Users cannot disable their own account.',
            )
        }

        const roleKeys = await getUserRoleKeysInTransaction(transaction, user.id)
        assertOwnerManagementAllowed(transactionActor.roles, roleKeys, roleKeys)
        await assertActiveOwnerRemains(transaction, {
            currentRoleKeys: roleKeys,
            currentStatus: user.status,
            nextRoleKeys: roleKeys,
            nextStatus: 'disabled',
        })

        const updatedRows = await transaction
            .update(users)
            .set({ status: 'disabled', updatedAt: new Date() })
            .where(and(eq(users.id, user.id), ne(users.status, 'disabled')))
            .returning({
                createdAt: users.createdAt,
                displayName: users.displayName,
                email: users.email,
                id: users.id,
                profileImageVersion: users.profileImageVersion,
                status: users.status,
                updatedAt: users.updatedAt,
            })
        const updatedUser = updatedRows.at(0) ?? { ...user, status: 'disabled' as const }

        await revokeAllUserSessionsInTransaction(transaction, user.id)
        await transaction.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, user.id))
        await transaction.delete(userInvites).where(eq(userInvites.userId, user.id))

        return toUserSummary(updatedUser, roleKeys)
    })
}
