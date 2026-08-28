import '@tanstack/react-start/server-only'

import { asc, eq, inArray } from 'drizzle-orm'

import {
    PERMISSIONS,
    SYSTEM_ROLE_REGISTRY,
    type PermissionKey,
} from '../../../config/permissions.config'
import { permissions, rolePermissions, roles, userRoles } from '../../../db/schema'
import type { RoleSummary } from '../../../shared/Types/auth.types'
import { requirePermissionService } from '../../Auth/Access/authorization.service'
import { getAuthDatabase, type AuthTransaction } from '../../Auth/Core/database.server'
import { AuthDomainError } from '../../Auth/Core/errors.server'
import {
    hasOwnerRole,
    isRegisteredPermissionKey,
    normalizeKeys,
    requirePermissionInTransaction,
} from '../../Auth/Access/rbac.service'

const roleKeyPattern = /^[a-z][a-z0-9_.-]{1,99}$/
const systemRoleKeys = new Set<string>(SYSTEM_ROLE_REGISTRY.map((role) => role.key))

function normalizeRoleKey(key: string): string {
    const normalizedKey = key.trim().toLowerCase()

    if (!roleKeyPattern.test(normalizedKey)) {
        throw new AuthDomainError('invalid_input', 'Role key is invalid.')
    }

    return normalizedKey
}

function normalizeRoleName(name: string): string {
    const normalizedName = name.trim()

    if (normalizedName.length < 1 || normalizedName.length > 100) {
        throw new AuthDomainError('invalid_input', 'Role name is invalid.')
    }

    return normalizedName
}

function normalizeRoleDescription(description: string): string {
    const normalizedDescription = description.trim()

    if (normalizedDescription.length > 1_000) {
        throw new AuthDomainError('invalid_input', 'Role description is too long.')
    }

    return normalizedDescription
}

function isUniqueConstraintViolation(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505'
}

async function loadPermissionsByKeysInTransaction(
    transaction: AuthTransaction,
    requestedPermissionKeys: ReadonlyArray<string>,
) {
    const permissionKeys = normalizeKeys(requestedPermissionKeys)

    if (!permissionKeys.every(isRegisteredPermissionKey)) {
        throw new AuthDomainError('unknown_permission', 'At least one permission is unknown.')
    }

    if (permissionKeys.length === 0) {
        return []
    }

    const selectedPermissions = await transaction
        .select({ id: permissions.id, key: permissions.key })
        .from(permissions)
        .where(inArray(permissions.key, permissionKeys))
        .for('share')

    if (selectedPermissions.length !== permissionKeys.length) {
        throw new AuthDomainError('unknown_permission', 'At least one permission is unavailable.')
    }

    return selectedPermissions.filter(
        (permission): permission is { id: string; key: PermissionKey } =>
            isRegisteredPermissionKey(permission.key),
    )
}

async function replaceRolePermissionsInTransaction(
    transaction: AuthTransaction,
    roleId: string,
    selectedPermissions: ReadonlyArray<{ id: string }>,
): Promise<void> {
    await transaction.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId))

    if (selectedPermissions.length === 0) {
        return
    }

    await transaction.insert(rolePermissions).values(
        selectedPermissions.map((permission) => ({
            permissionId: permission.id,
            roleId,
        })),
    )
}

function assertPermissionAssignmentAllowed(
    actor: Awaited<ReturnType<typeof requirePermissionInTransaction>>,
    selectedPermissions: ReadonlyArray<{ key: PermissionKey }>,
): void {
    if (hasOwnerRole(actor.roles)) {
        return
    }

    const actorPermissions = new Set<PermissionKey>(actor.permissions)

    if (selectedPermissions.some((permission) => !actorPermissions.has(permission.key))) {
        throw new AuthDomainError(
            'permission_denied',
            'Roles may only grant permissions held by the assigning user.',
        )
    }
}

export async function listRolesService(): Promise<Array<RoleSummary>> {
    await requirePermissionService(PERMISSIONS.ROLES_VIEW)
    const db = getAuthDatabase()
    const [roleRows, permissionRows] = await Promise.all([
        db
            .select({
                createdAt: roles.createdAt,
                description: roles.description,
                id: roles.id,
                isSystem: roles.isSystem,
                key: roles.key,
                name: roles.name,
                updatedAt: roles.updatedAt,
            })
            .from(roles)
            .orderBy(asc(roles.key)),
        db
            .select({ permissionKey: permissions.key, roleId: rolePermissions.roleId })
            .from(rolePermissions)
            .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId)),
    ])
    const permissionKeysByRoleId = new Map<string, Array<PermissionKey>>()

    for (const row of permissionRows) {
        if (!isRegisteredPermissionKey(row.permissionKey)) {
            continue
        }

        const permissionKeys = permissionKeysByRoleId.get(row.roleId) ?? []
        permissionKeys.push(row.permissionKey)
        permissionKeysByRoleId.set(row.roleId, permissionKeys)
    }

    return roleRows.map((role) => ({
        createdAt: role.createdAt,
        description: role.description,
        id: role.id,
        isSystem: role.isSystem,
        key: role.key,
        name: role.name,
        permissionKeys: permissionKeysByRoleId.get(role.id) ?? [],
        updatedAt: role.updatedAt,
    }))
}

export async function createRoleService(input: {
    key: string
    name: string
    description: string
    permissionKeys: ReadonlyArray<string>
}): Promise<RoleSummary> {
    const actor = await requirePermissionService(PERMISSIONS.ROLES_CREATE)
    const key = normalizeRoleKey(input.key)
    const name = normalizeRoleName(input.name)
    const description = normalizeRoleDescription(input.description)

    if (systemRoleKeys.has(key)) {
        throw new AuthDomainError('system_role_immutable', 'System role keys are reserved.')
    }

    const db = getAuthDatabase()

    try {
        return await db.transaction(async (transaction) => {
            const transactionActor = await requirePermissionInTransaction(
                transaction,
                actor.id,
                PERMISSIONS.ROLES_CREATE,
            )
            await requirePermissionInTransaction(
                transaction,
                actor.id,
                PERMISSIONS.ROLES_ASSIGN_PERMISSIONS,
            )
            const selectedPermissions = await loadPermissionsByKeysInTransaction(
                transaction,
                input.permissionKeys,
            )
            assertPermissionAssignmentAllowed(transactionActor, selectedPermissions)
            const roleRows = await transaction
                .insert(roles)
                .values({ description, key, name })
                .returning({
                    createdAt: roles.createdAt,
                    description: roles.description,
                    id: roles.id,
                    isSystem: roles.isSystem,
                    key: roles.key,
                    name: roles.name,
                    updatedAt: roles.updatedAt,
                })
            const role = roleRows.at(0)

            if (!role) {
                throw new AuthDomainError('service_unavailable', 'Role could not be created.')
            }

            await replaceRolePermissionsInTransaction(transaction, role.id, selectedPermissions)

            return {
                ...role,
                permissionKeys: selectedPermissions.map((permission) => permission.key),
            }
        })
    } catch (error) {
        if (isUniqueConstraintViolation(error)) {
            throw new AuthDomainError('invalid_input', 'Role key is already in use.')
        }

        throw error
    }
}

export async function updateRoleService(input: {
    roleId: string
    name?: string
    description?: string
    permissionKeys?: ReadonlyArray<string>
}): Promise<RoleSummary> {
    if (
        input.name === undefined &&
        input.description === undefined &&
        input.permissionKeys === undefined
    ) {
        throw new AuthDomainError('invalid_input', 'No role changes were provided.')
    }

    const actor = await requirePermissionService(PERMISSIONS.ROLES_UPDATE)
    const normalizedName = input.name === undefined ? undefined : normalizeRoleName(input.name)
    const normalizedDescription =
        input.description === undefined ? undefined : normalizeRoleDescription(input.description)
    const db = getAuthDatabase()

    return db.transaction(async (transaction) => {
        const transactionActor = await requirePermissionInTransaction(
            transaction,
            actor.id,
            PERMISSIONS.ROLES_UPDATE,
        )
        const roleRows = await transaction
            .select({
                createdAt: roles.createdAt,
                description: roles.description,
                id: roles.id,
                isSystem: roles.isSystem,
                key: roles.key,
                name: roles.name,
                updatedAt: roles.updatedAt,
            })
            .from(roles)
            .where(eq(roles.id, input.roleId))
            .limit(1)
            .for('update')
        const role = roleRows.at(0)

        if (!role) {
            throw new AuthDomainError('role_not_found', 'Role was not found.')
        }

        if (role.isSystem) {
            throw new AuthDomainError('system_role_immutable', 'System roles cannot be changed.')
        }

        let selectedPermissions: Awaited<
            ReturnType<typeof loadPermissionsByKeysInTransaction>
        > | null = null

        if (input.permissionKeys !== undefined) {
            await requirePermissionInTransaction(
                transaction,
                actor.id,
                PERMISSIONS.ROLES_ASSIGN_PERMISSIONS,
            )
            selectedPermissions = await loadPermissionsByKeysInTransaction(
                transaction,
                input.permissionKeys,
            )
            assertPermissionAssignmentAllowed(transactionActor, selectedPermissions)
        }

        const updatedRows = await transaction
            .update(roles)
            .set({
                ...(normalizedDescription === undefined
                    ? {}
                    : { description: normalizedDescription }),
                ...(normalizedName === undefined ? {} : { name: normalizedName }),
                updatedAt: new Date(),
            })
            .where(eq(roles.id, role.id))
            .returning({
                createdAt: roles.createdAt,
                description: roles.description,
                id: roles.id,
                isSystem: roles.isSystem,
                key: roles.key,
                name: roles.name,
                updatedAt: roles.updatedAt,
            })
        const updatedRole = updatedRows.at(0)

        if (!updatedRole) {
            throw new AuthDomainError('role_not_found', 'Role was not found.')
        }

        if (selectedPermissions) {
            await replaceRolePermissionsInTransaction(transaction, role.id, selectedPermissions)
        }

        const effectivePermissionRows =
            selectedPermissions ??
            (await transaction
                .select({ id: permissions.id, key: permissions.key })
                .from(rolePermissions)
                .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
                .where(eq(rolePermissions.roleId, role.id)))

        return {
            ...updatedRole,
            permissionKeys: effectivePermissionRows
                .map((permission) => permission.key)
                .filter(isRegisteredPermissionKey),
        }
    })
}

export async function deleteRoleService(roleId: string): Promise<void> {
    const actor = await requirePermissionService(PERMISSIONS.ROLES_DELETE)
    const db = getAuthDatabase()

    await db.transaction(async (transaction) => {
        await requirePermissionInTransaction(transaction, actor.id, PERMISSIONS.ROLES_DELETE)
        const roleRows = await transaction
            .select({ id: roles.id, isSystem: roles.isSystem })
            .from(roles)
            .where(eq(roles.id, roleId))
            .limit(1)
            .for('update')
        const role = roleRows.at(0)

        if (!role) {
            throw new AuthDomainError('role_not_found', 'Role was not found.')
        }

        if (role.isSystem) {
            throw new AuthDomainError('system_role_immutable', 'System roles cannot be deleted.')
        }

        const assignments = await transaction
            .select({ userId: userRoles.userId })
            .from(userRoles)
            .where(eq(userRoles.roleId, role.id))
            .limit(1)
            .for('share')

        if (assignments.length > 0) {
            throw new AuthDomainError('role_in_use', 'Assigned roles cannot be deleted.')
        }

        await transaction.delete(roles).where(eq(roles.id, role.id))
    })
}
