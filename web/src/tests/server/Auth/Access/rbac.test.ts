import { describe, expect, test } from 'bun:test'

import { PERMISSIONS, SYSTEM_ROLES } from '@/config/permissions.config.ts'
import type { PermissionKey } from '@/config/Types/permissions-config.types.ts'
import type { AuthenticatedUser } from '@/lib/Auth/Types/auth.types.ts'
import { assertRoleAssignmentAllowedInTransaction } from '@/server/Auth/Access/rbac.service.ts'
import type { AuthTransaction } from '@/server/Auth/Core/Types/database.types.ts'

function transactionWithPermissions(keys: ReadonlyArray<string>): AuthTransaction {
    const query = {
        from: () => query,
        innerJoin: () => query,
        where: async () => keys.map((key) => ({ key })),
    }
    return { select: () => query } as unknown as AuthTransaction
}

function actorWithPermissions(permissions: ReadonlyArray<PermissionKey>): AuthenticatedUser {
    return {
        id: '6f355778-511f-467b-ad8f-8c4a29b84510',
        displayName: 'Administrator',
        email: 'administrator@example.invalid',
        profileImageVersion: null,
        roles: [SYSTEM_ROLES.ADMIN],
        permissions,
        language: 'en',
        themeMode: 'light',
    }
}

describe('role assignment with retired permissions', () => {
    test('ignores inert legacy permissions when every current permission is held', async () => {
        await expect(
            assertRoleAssignmentAllowedInTransaction(
                transactionWithPermissions(['system_appearance.update', PERMISSIONS.APP_ACCESS]),
                actorWithPermissions([PERMISSIONS.APP_ACCESS]),
                [{ id: 'legacy-role', key: 'custom' }],
            ),
        ).resolves.toBeUndefined()
    })

    test('still rejects current permissions the assigning administrator does not hold', async () => {
        await expect(
            assertRoleAssignmentAllowedInTransaction(
                transactionWithPermissions([
                    'system_appearance.update',
                    PERMISSIONS.APP_ACCESS,
                    PERMISSIONS.USERS_CREATE,
                ]),
                actorWithPermissions([PERMISSIONS.APP_ACCESS]),
                [{ id: 'legacy-role', key: 'custom' }],
            ),
        ).rejects.toMatchObject({ code: 'permission_denied' })
    })

    test('still restricts owner-role assignment to owners', async () => {
        await expect(
            assertRoleAssignmentAllowedInTransaction(
                transactionWithPermissions([]),
                actorWithPermissions([PERMISSIONS.APP_ACCESS]),
                [{ id: 'owner-role', key: SYSTEM_ROLES.OWNER }],
            ),
        ).rejects.toMatchObject({ code: 'owner_required' })
    })
})
