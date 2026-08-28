import { createServerFn } from '@tanstack/react-start'

import { PERMISSIONS } from '../../../config/permissions.config'
import { requirePermissionService } from '../../../server/Auth/Access/authorization.service'
import {
    createRoleService,
    deleteRoleService,
    listRolesService,
    updateRoleService,
} from '../../../server/Admin/RoleManagement/roles.service'
import {
    actionFailure,
    throwPublicQueryError,
    type AuthActionResult,
} from '../../Auth/serverHelpers'
import { createRoleInputSchema, roleIdInputSchema, updateRoleInputSchema } from './validation'

export const getRolesHandler = createServerFn({ method: 'GET' }).handler(async () => {
    try {
        await requirePermissionService(PERMISSIONS.ROLES_VIEW)
        return await listRolesService()
    } catch (error) {
        throwPublicQueryError(error)
    }
})

export const createRoleHandler = createServerFn({ method: 'POST' })
    .validator(createRoleInputSchema)
    .handler(async ({ data }): Promise<AuthActionResult> => {
        try {
            await requirePermissionService(PERMISSIONS.ROLES_CREATE)
            await createRoleService(data)
            return { success: true, message: 'Role created.' }
        } catch (error) {
            return actionFailure(error, 'The role could not be created.')
        }
    })

export const updateRoleHandler = createServerFn({ method: 'POST' })
    .validator(updateRoleInputSchema)
    .handler(async ({ data }): Promise<AuthActionResult> => {
        try {
            await requirePermissionService(PERMISSIONS.ROLES_UPDATE)
            await updateRoleService(data)
            return { success: true, message: 'Role updated.' }
        } catch (error) {
            return actionFailure(error, 'The role could not be updated.')
        }
    })

export const deleteRoleHandler = createServerFn({ method: 'POST' })
    .validator(roleIdInputSchema)
    .handler(async ({ data }): Promise<AuthActionResult> => {
        try {
            await requirePermissionService(PERMISSIONS.ROLES_DELETE)
            await deleteRoleService(data.roleId)
            return { success: true, message: 'Role deleted.' }
        } catch (error) {
            return actionFailure(error, 'The role could not be deleted.')
        }
    })
