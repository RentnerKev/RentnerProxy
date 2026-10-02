import type { AuthActionResult } from '@/server/Auth/Types/auth-transport.types.ts'
import { createServerFn } from '@tanstack/react-start'

import { PERMISSIONS } from '@/config/permissions.config.ts'
import { requirePermissionService } from '@/server/Auth/Access/authorization.service.ts'
import {
    createRoleService,
    deleteRoleService,
    listRolesService,
    updateRoleService,
} from '@/server/Admin/RoleManagement/roles.service.ts'
import { localizedActionFailure, throwLocalizedQueryError } from '@/server/Auth/transport.server.ts'
import { createRoleInputSchema, roleIdInputSchema, updateRoleInputSchema } from './validation.ts'

export const getRolesHandler = createServerFn({ method: 'GET' }).handler(async () => {
    try {
        await requirePermissionService(PERMISSIONS.ROLES_VIEW)
        return await listRolesService()
    } catch (error) {
        throwLocalizedQueryError(error, 'admin.roles.errors.loadFailed')
    }
})

export const createRoleHandler = createServerFn({ method: 'POST' })
    .validator(createRoleInputSchema)
    .handler(async ({ data }): Promise<AuthActionResult> => {
        try {
            await requirePermissionService(PERMISSIONS.ROLES_CREATE)
            await createRoleService(data)
            return { success: true, message: 'admin.roles.messages.created' }
        } catch (error) {
            return localizedActionFailure(error, 'admin.roles.errors.createFailed')
        }
    })

export const updateRoleHandler = createServerFn({ method: 'POST' })
    .validator(updateRoleInputSchema)
    .handler(async ({ data }): Promise<AuthActionResult> => {
        try {
            await requirePermissionService(PERMISSIONS.ROLES_UPDATE)
            await updateRoleService({
                roleId: data.roleId,
                name: data.name,
                description: data.description,
                ...(data.permissionKeys ? { permissionKeys: data.permissionKeys } : {}),
            })
            return { success: true, message: 'admin.roles.messages.updated' }
        } catch (error) {
            return localizedActionFailure(error, 'admin.roles.errors.updateFailed')
        }
    })

export const deleteRoleHandler = createServerFn({ method: 'POST' })
    .validator(roleIdInputSchema)
    .handler(async ({ data }): Promise<AuthActionResult> => {
        try {
            await requirePermissionService(PERMISSIONS.ROLES_DELETE)
            await deleteRoleService(data.roleId)
            return { success: true, message: 'admin.roles.messages.deleted' }
        } catch (error) {
            return localizedActionFailure(error, 'admin.roles.errors.deleteFailed')
        }
    })
