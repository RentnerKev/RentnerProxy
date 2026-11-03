import { beforeEach, describe, expect, test } from 'bun:test'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { createMiddlewareHarness } from '@/tests/Helpers/middlewareCoverage.ts'

const boundary = createMiddlewareHarness()
boundary.mockServices('@/server/Admin/RoleManagement/roles.service.ts', [
    'createRoleService',
    'deleteRoleService',
    'listRolesService',
    'updateRoleService',
])
const handlers = await import('@/features/Admin/RoleManagement/middleware.ts')
const id = '0198d98a-0000-7000-8000-000000000881'
beforeEach(() => boundary.reset())

describe('role management permission boundary', () => {
    test.each([
        [
            handlers.createRoleHandler,
            'createRoleService',
            { key: 'fixture', name: 'Fixture', description: '', permissionKeys: [] },
            PERMISSIONS.ROLES_CREATE,
        ],
        [
            handlers.updateRoleHandler,
            'updateRoleService',
            { roleId: id, name: 'Fixture', description: '', permissionKeys: [] },
            PERMISSIONS.ROLES_UPDATE,
        ],
        [handlers.deleteRoleHandler, 'deleteRoleService', { roleId: id }, PERMISSIONS.ROLES_DELETE],
    ])(
        'checks operation permission before %s and forwards only validated fields',
        async (handler, service, data, permission) => {
            boundary.failures.set('requirePermissionService', new Error('denied'))
            expect(await boundary.invoke(handler, data)).toMatchObject({ success: false })
            expect(boundary.argumentsFor(service)).toEqual([])
            expect(boundary.argumentsFor('requirePermissionService')).toEqual([[permission]])
            boundary.failures.clear()
            expect(await boundary.invoke(handler, data)).toMatchObject({ success: true })
            expect(boundary.argumentsFor(service)).toEqual([
                [service === 'deleteRoleService' ? id : data],
            ])
            boundary.failures.set(service, new Error('private role detail'))
            expect(await boundary.invoke(handler, data)).toMatchObject({ success: false })
        },
    )

    test('does not synthesize permission updates when the field is omitted', async () => {
        await boundary.invoke(handlers.updateRoleHandler, {
            roleId: id,
            name: 'Fixture',
            description: '',
        })
        expect(boundary.argumentsFor('updateRoleService')).toEqual([
            [{ roleId: id, name: 'Fixture', description: '' }],
        ])
    })

    test('requires view permission before exposing roles and localizes forbidden reads', async () => {
        boundary.failures.set('requirePermissionService', new Error('denied'))
        await expect(boundary.invoke(handlers.getRolesHandler)).rejects.toThrow(
            'admin.roles.errors.loadFailed',
        )
        expect(boundary.argumentsFor('listRolesService')).toEqual([])
        boundary.failures.clear()
        boundary.values.set('listRolesService', [{ key: 'fixture' }])
        expect(await boundary.invoke(handlers.getRolesHandler)).toEqual([{ key: 'fixture' }])
        expect(boundary.argumentsFor('requirePermissionService')).toEqual([
            [PERMISSIONS.ROLES_VIEW],
            [PERMISSIONS.ROLES_VIEW],
        ])
    })
})
