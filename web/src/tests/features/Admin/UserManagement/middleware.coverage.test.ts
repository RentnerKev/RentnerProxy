import { beforeEach, describe, expect, test } from 'bun:test'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { createMiddlewareHarness } from '@/tests/Helpers/middlewareCoverage.ts'

const boundary = createMiddlewareHarness()
boundary.mockServices('@/server/Admin/UserManagement/users.service.ts', [
    'createUserService',
    'disableUserService',
    'enableUserService',
    'listUsersService',
    'updateUserService',
])
const handlers = await import('@/features/Admin/UserManagement/middleware.ts')
const id = '0198d98a-0000-7000-8000-000000000881'
beforeEach(() => boundary.reset())

describe('user management authorization boundary', () => {
    test.each([
        [
            handlers.createUserHandler,
            'createUserService',
            { email: 'fixture@example.test', roleKeys: ['viewer'] },
            PERMISSIONS.USERS_CREATE,
        ],
        [
            handlers.updateUserHandler,
            'updateUserService',
            { userId: id, displayName: 'Fixture', email: 'fixture@example.test' },
            PERMISSIONS.USERS_UPDATE,
        ],
        [
            handlers.disableUserHandler,
            'disableUserService',
            { userId: id },
            PERMISSIONS.USERS_DISABLE,
        ],
        [handlers.enableUserHandler, 'enableUserService', { userId: id }, PERMISSIONS.USERS_ENABLE],
    ])(
        'requires the operation-specific permission before %s',
        async (handler, service, input, permission) => {
            boundary.failures.set('requirePermissionService', new Error('denied'))
            expect(await boundary.invoke(handler, input)).toMatchObject({ success: false })
            expect(boundary.argumentsFor(service)).toEqual([])
            expect(boundary.argumentsFor('requirePermissionService')).toEqual([[permission]])
            boundary.failures.clear()
            boundary.values.set(service, { status: 'active' })
            expect(await boundary.invoke(handler, input)).toMatchObject({ success: true })
            expect(boundary.argumentsFor(service)).toEqual([
                [service === 'disableUserService' || service === 'enableUserService' ? id : input],
            ])
            boundary.failures.set(service, new Error('private user detail'))
            expect(await boundary.invoke(handler, input)).toMatchObject({ success: false })
        },
    )

    test('does not expose the user list without view permission', async () => {
        boundary.failures.set('requirePermissionService', new Error('denied'))
        await expect(boundary.invoke(handlers.getUsersHandler)).rejects.toThrow(
            'admin.users.errors.loadFailed',
        )
        expect(boundary.argumentsFor('listUsersService')).toEqual([])
        boundary.failures.clear()
        boundary.values.set('listUsersService', [])
        expect(await boundary.invoke(handlers.getUsersHandler)).toEqual([])
    })
})
