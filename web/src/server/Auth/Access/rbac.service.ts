import '@tanstack/react-start/server-only'

import { and, count, eq, inArray } from 'drizzle-orm'

import {
    PERMISSION_REGISTRY,
    SYSTEM_ROLES,
    type PermissionKey,
} from '../../../config/permissions.config'
import { DEFAULT_USER_THEME_MODE, isUserThemeMode } from '../../../config/theme.config'
import {
    permissions,
    rolePermissions,
    roles,
    userRoles,
    users,
    userSettings,
} from '../../../db/schema'
import type { AuthenticatedUser } from '../../../shared/Types/auth.types'
import type { AuthTransaction } from '../Core/database.server'
import { AuthDomainError } from '../Core/errors.server'

const registeredPermissionKeys = new Set<PermissionKey>(
    PERMISSION_REGISTRY.map((permission) => permission.key),
)

export function isRegisteredPermissionKey(value: string): value is PermissionKey {
    return registeredPermissionKeys.has(value as PermissionKey)
}

export function normalizeKeys(keys: ReadonlyArray<string>): Array<string> {
    return [...new Set(keys.map((key) => key.trim()).filter(Boolean))]
}

export async function getUserRoleKeysInTransaction(
    transaction: AuthTransaction,
    userId: string,
): Promise<Array<string>> {
    const rows = await transaction
        .select({ key: roles.key })
        .from(userRoles)
        .innerJoin(roles, eq(roles.id, userRoles.roleId))
        .where(eq(userRoles.userId, userId))

    return rows.map((row) => row.key)
}

export async function getUserPermissionKeysInTransaction(
    transaction: AuthTransaction,
    userId: string,
    roleKeys?: ReadonlyArray<string>,
): Promise<Array<PermissionKey>> {
    const effectiveRoleKeys = roleKeys ?? (await getUserRoleKeysInTransaction(transaction, userId))

    if (effectiveRoleKeys.includes(SYSTEM_ROLES.OWNER)) {
        return PERMISSION_REGISTRY.map((permission) => permission.key)
    }

    const rows = await transaction
        .select({ key: permissions.key })
        .from(userRoles)
        .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
        .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
        .where(eq(userRoles.userId, userId))

    return normalizeKeys(rows.map((row) => row.key)).filter(isRegisteredPermissionKey)
}

export async function resolveActiveUserAccessInTransaction(
    transaction: AuthTransaction,
    userId: string,
): Promise<AuthenticatedUser | null> {
    const userRows = await transaction
        .select({
            displayName: users.displayName,
            id: users.id,
            email: users.email,
            profileImageVersion: users.profileImageVersion,
            status: users.status,
            themeMode: userSettings.themeMode,
        })
        .from(users)
        .leftJoin(userSettings, eq(userSettings.userId, users.id))
        .where(eq(users.id, userId))
        .limit(1)
    const user = userRows.at(0)

    if (!user || user.status !== 'active') {
        return null
    }

    const roleKeys = await getUserRoleKeysInTransaction(transaction, user.id)
    const permissionKeys = await getUserPermissionKeysInTransaction(transaction, user.id, roleKeys)

    return {
        displayName: user.displayName,
        id: user.id,
        email: user.email,
        profileImageVersion: user.profileImageVersion > 0 ? user.profileImageVersion : null,
        roles: roleKeys,
        permissions: permissionKeys,
        themeMode: isUserThemeMode(user.themeMode) ? user.themeMode : DEFAULT_USER_THEME_MODE,
    }
}

export async function requirePermissionInTransaction(
    transaction: AuthTransaction,
    userId: string,
    permission: PermissionKey,
): Promise<AuthenticatedUser> {
    const user = await resolveActiveUserAccessInTransaction(transaction, userId)

    if (!user) {
        throw new AuthDomainError('authentication_required', 'Authentication is required.')
    }

    if (!user.permissions.includes(permission)) {
        throw new AuthDomainError('permission_denied', 'Permission is required.')
    }

    return user
}

export async function loadRolesByKeysInTransaction(
    transaction: AuthTransaction,
    requestedRoleKeys: ReadonlyArray<string>,
) {
    const roleKeys = normalizeKeys(requestedRoleKeys)

    if (roleKeys.length === 0) {
        return []
    }

    const selectedRoles = await transaction
        .select({ id: roles.id, key: roles.key, isSystem: roles.isSystem })
        .from(roles)
        .where(inArray(roles.key, roleKeys))
        .for('share')

    if (selectedRoles.length !== roleKeys.length) {
        throw new AuthDomainError('unknown_role', 'At least one role is unknown.')
    }

    return selectedRoles
}

export async function replaceUserRolesInTransaction(
    transaction: AuthTransaction,
    userId: string,
    selectedRoles: ReadonlyArray<{ id: string }>,
): Promise<void> {
    await transaction.delete(userRoles).where(eq(userRoles.userId, userId))

    if (selectedRoles.length === 0) {
        return
    }

    await transaction.insert(userRoles).values(
        selectedRoles.map((role) => ({
            roleId: role.id,
            userId,
        })),
    )
}

export async function assertRoleAssignmentAllowedInTransaction(
    transaction: AuthTransaction,
    actor: AuthenticatedUser,
    selectedRoles: ReadonlyArray<{ id: string; key: string }>,
): Promise<void> {
    if (hasOwnerRole(actor.roles)) {
        return
    }

    if (selectedRoles.some((role) => role.key === SYSTEM_ROLES.OWNER)) {
        throw new AuthDomainError('owner_required', 'Only an owner may assign the owner role.')
    }

    if (selectedRoles.length === 0) {
        return
    }

    const assignedPermissionRows = await transaction
        .select({ key: permissions.key })
        .from(rolePermissions)
        .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
        .where(
            inArray(
                rolePermissions.roleId,
                selectedRoles.map((role) => role.id),
            ),
        )
    const actorPermissions = new Set<string>(actor.permissions)

    if (assignedPermissionRows.some((permission) => !actorPermissions.has(permission.key))) {
        throw new AuthDomainError(
            'permission_denied',
            'Roles may only grant permissions held by the assigning user.',
        )
    }
}

export async function countActiveOwnersInTransaction(
    transaction: AuthTransaction,
): Promise<number> {
    const rows = await transaction
        .select({ value: count() })
        .from(userRoles)
        .innerJoin(roles, eq(roles.id, userRoles.roleId))
        .innerJoin(users, eq(users.id, userRoles.userId))
        .where(and(eq(roles.key, SYSTEM_ROLES.OWNER), eq(users.status, 'active')))

    return rows.at(0)?.value ?? 0
}

export function hasOwnerRole(roleKeys: ReadonlyArray<string>): boolean {
    return roleKeys.includes(SYSTEM_ROLES.OWNER)
}
