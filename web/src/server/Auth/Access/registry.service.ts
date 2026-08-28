import '@tanstack/react-start/server-only'

import { inArray, sql } from 'drizzle-orm'

import { PERMISSION_REGISTRY, SYSTEM_ROLE_REGISTRY } from '../../../config/permissions.config'
import { permissions, rolePermissions, roles } from '../../../db/schema'
import type { AuthTransaction } from '../Core/database.server'
import { AuthDomainError } from '../Core/errors.server'

export async function ensureAuthorizationRegistryInTransaction(
    transaction: AuthTransaction,
): Promise<void> {
    const now = new Date()

    await transaction
        .insert(permissions)
        .values(PERMISSION_REGISTRY.map((definition) => ({ ...definition })))
        .onConflictDoUpdate({
            target: permissions.key,
            set: { name: sql`excluded.name`, updatedAt: now },
        })

    const roleRows = await transaction
        .insert(roles)
        .values(
            SYSTEM_ROLE_REGISTRY.map((definition) => ({
                key: definition.key,
                name: definition.name,
                description: definition.description,
                isSystem: true,
            })),
        )
        .onConflictDoUpdate({
            target: roles.key,
            set: {
                description: sql`excluded.description`,
                isSystem: true,
                name: sql`excluded.name`,
                updatedAt: now,
            },
        })
        .returning({ id: roles.id, key: roles.key })
    const permissionRows = await transaction
        .select({ id: permissions.id, key: permissions.key })
        .from(permissions)
        .where(
            inArray(
                permissions.key,
                PERMISSION_REGISTRY.map((definition) => definition.key),
            ),
        )

    if (
        roleRows.length !== SYSTEM_ROLE_REGISTRY.length ||
        permissionRows.length !== PERMISSION_REGISTRY.length
    ) {
        throw new AuthDomainError(
            'service_unavailable',
            'Authorization registry could not be loaded.',
        )
    }

    const roleIdByKey = new Map(roleRows.map((role) => [role.key, role.id]))
    const permissionIdByKey = new Map(
        permissionRows.map((permission) => [permission.key, permission.id]),
    )
    const assignments = SYSTEM_ROLE_REGISTRY.flatMap((definition) => {
        const roleId = roleIdByKey.get(definition.key)

        if (!roleId) {
            throw new AuthDomainError('service_unavailable', 'System role could not be loaded.')
        }

        return definition.permissionKeys.map((permissionKey) => {
            const permissionId = permissionIdByKey.get(permissionKey)

            if (!permissionId) {
                throw new AuthDomainError(
                    'service_unavailable',
                    'System role permission could not be loaded.',
                )
            }

            return { permissionId, roleId }
        })
    })

    await transaction.delete(rolePermissions).where(
        inArray(
            rolePermissions.roleId,
            roleRows.map((role) => role.id),
        ),
    )
    await transaction.insert(rolePermissions).values(assignments)
}
