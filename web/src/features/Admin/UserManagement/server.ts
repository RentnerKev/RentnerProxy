import { createServerFn } from '@tanstack/react-start'

import { PERMISSIONS } from '../../../config/permissions.config'
import { requirePermissionService } from '../../../server/Auth/Access/authorization.service'
import {
    createUserService,
    disableUserService,
    enableUserService,
    listUsersService,
    updateUserService,
} from '../../../server/Admin/UserManagement/users.service'
import {
    localizedActionFailure,
    throwLocalizedQueryError,
    type AuthActionResult,
} from '../../Auth/serverHelpers'
import { inviteUserInputSchema, updateUserInputSchema, userIdInputSchema } from './validation'

export const getUsersHandler = createServerFn({ method: 'GET' }).handler(async () => {
    try {
        await requirePermissionService(PERMISSIONS.USERS_VIEW)
        return await listUsersService()
    } catch (error) {
        throwLocalizedQueryError(error, 'admin.users.errors.loadFailed')
    }
})

export const createUserHandler = createServerFn({ method: 'POST' })
    .validator(inviteUserInputSchema)
    .handler(async ({ data }): Promise<AuthActionResult> => {
        try {
            await requirePermissionService(PERMISSIONS.USERS_CREATE)
            await createUserService(data)
            return { success: true, message: 'admin.users.messages.created' }
        } catch (error) {
            return localizedActionFailure(error, 'admin.users.errors.inviteFailed')
        }
    })

export const updateUserHandler = createServerFn({ method: 'POST' })
    .validator(updateUserInputSchema)
    .handler(async ({ data }): Promise<AuthActionResult> => {
        try {
            await requirePermissionService(PERMISSIONS.USERS_UPDATE)
            await updateUserService(data)
            return { success: true, message: 'admin.users.messages.updated' }
        } catch (error) {
            return localizedActionFailure(error, 'admin.users.errors.updateFailed')
        }
    })

export const disableUserHandler = createServerFn({ method: 'POST' })
    .validator(userIdInputSchema)
    .handler(async ({ data }): Promise<AuthActionResult> => {
        try {
            await requirePermissionService(PERMISSIONS.USERS_DISABLE)
            await disableUserService(data.userId)
            return { success: true, message: 'admin.users.messages.disabled' }
        } catch (error) {
            return localizedActionFailure(error, 'admin.users.errors.disableFailed')
        }
    })

export const enableUserHandler = createServerFn({ method: 'POST' })
    .validator(userIdInputSchema)
    .handler(async ({ data }): Promise<AuthActionResult> => {
        try {
            await requirePermissionService(PERMISSIONS.USERS_ENABLE)
            await enableUserService(data.userId)
            return { success: true, message: 'admin.users.messages.enabled' }
        } catch (error) {
            return localizedActionFailure(error, 'admin.users.errors.enableFailed')
        }
    })
