import { describe, expect, test } from 'bun:test'

import { PERMISSIONS, SYSTEM_ROLES } from '@/config/permissions.config.ts'
import type { PermissionKey } from '@/config/Types/permissions-config.types.ts'
import type { AuthenticatedUser } from '@/lib/Auth/Types/auth.types.ts'
import {
    assertRecoveryEmailChangeAllowedInTransaction,
    assertRoleAssignmentAllowedInTransaction,
} from '@/server/Auth/Access/rbac.service.ts'
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

describe('recovery email permission delegation', () => {
    const targetId = '13ac9c56-d69c-45d4-b63f-da6984b6628d'
    const retainedRoles = [{ id: 'resource-role', key: 'resource-manager' }]

    test('rejects taking recovery control of a distinct user with an unheld resource permission', async () => {
        await expect(
            assertRecoveryEmailChangeAllowedInTransaction(
                transactionWithPermissions([
                    PERMISSIONS.APP_ACCESS,
                    PERMISSIONS.PROXY_HOSTS_UPDATE,
                ]),
                actorWithPermissions([PERMISSIONS.APP_ACCESS, PERMISSIONS.USERS_UPDATE]),
                targetId,
                retainedRoles,
            ),
        ).rejects.toMatchObject({ code: 'permission_denied' })
    })

    test.each([
        { label: 'equal', permissions: [PERMISSIONS.APP_ACCESS, PERMISSIONS.USERS_UPDATE] },
        { label: 'lesser', permissions: [PERMISSIONS.APP_ACCESS, 'system_appearance.update'] },
        { label: 'empty', permissions: [] },
    ])(
        'allows $label permissions without requiring role-assignment authority',
        async ({ permissions }) => {
            const actor = actorWithPermissions([PERMISSIONS.APP_ACCESS, PERMISSIONS.USERS_UPDATE])

            await expect(
                assertRecoveryEmailChangeAllowedInTransaction(
                    transactionWithPermissions(permissions),
                    actor,
                    targetId,
                    retainedRoles,
                ),
            ).resolves.toBeUndefined()
        },
    )

    test('allows the current user and owners without querying delegated permissions', async () => {
        const transaction = {
            select: () => {
                throw new Error('No delegated permission query should be necessary.')
            },
        } as unknown as AuthTransaction
        const actor = actorWithPermissions([PERMISSIONS.APP_ACCESS, PERMISSIONS.USERS_UPDATE])

        await expect(
            assertRecoveryEmailChangeAllowedInTransaction(
                transaction,
                actor,
                actor.id,
                retainedRoles,
            ),
        ).resolves.toBeUndefined()
        await expect(
            assertRecoveryEmailChangeAllowedInTransaction(
                transaction,
                { ...actor, roles: [SYSTEM_ROLES.OWNER] },
                targetId,
                retainedRoles,
            ),
        ).resolves.toBeUndefined()
    })

    test('retains the owner-only boundary for another owner account', async () => {
        await expect(
            assertRecoveryEmailChangeAllowedInTransaction(
                transactionWithPermissions([]),
                actorWithPermissions([PERMISSIONS.APP_ACCESS, PERMISSIONS.USERS_UPDATE]),
                targetId,
                [{ id: 'owner-role', key: SYSTEM_ROLES.OWNER }],
            ),
        ).rejects.toMatchObject({ code: 'owner_required' })
    })
})
