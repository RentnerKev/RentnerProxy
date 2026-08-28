import { createServerFn } from '@tanstack/react-start'

import { PERMISSIONS } from '../../../config/permissions.config'
import { requirePermissionService } from '../../../server/Auth/Access/authorization.service'
import {
    createUserService,
    disableUserService,
    listUsersService,
    updateUserService,
} from '../../../server/Admin/UserManagement/users.service'
import {
    actionFailure,
    throwPublicQueryError,
    type AuthActionResult,
} from '../../Auth/serverHelpers'
import { inviteUserInputSchema, updateUserInputSchema, userIdInputSchema } from './validation'

export const getUsersHandler = createServerFn({ method: 'GET' }).handler(async () => {
    try {
        await requirePermissionService(PERMISSIONS.USERS_VIEW)
        return await listUsersService()
    } catch (error) {
        throwPublicQueryError(error)
    }
})

export const createUserHandler = createServerFn({ method: 'POST' })
    .validator(inviteUserInputSchema)
    .handler(async ({ data }): Promise<AuthActionResult> => {
        try {
            await requirePermissionService(PERMISSIONS.USERS_CREATE)
            await createUserService(data)
            return { success: true, message: 'User created and invitation sent.' }
        } catch (error) {
            return actionFailure(error, 'The user could not be invited.')
        }
    })

export const updateUserHandler = createServerFn({ method: 'POST' })
    .validator(updateUserInputSchema)
    .handler(async ({ data }): Promise<AuthActionResult> => {
        try {
            await requirePermissionService(PERMISSIONS.USERS_UPDATE)
            await updateUserService(data)
            return { success: true, message: 'User updated.' }
        } catch (error) {
            return actionFailure(error, 'The user could not be updated.')
        }
    })

export const disableUserHandler = createServerFn({ method: 'POST' })
    .validator(userIdInputSchema)
    .handler(async ({ data }): Promise<AuthActionResult> => {
        try {
            await requirePermissionService(PERMISSIONS.USERS_DISABLE)
            await disableUserService(data.userId)
            return { success: true, message: 'User disabled and sessions revoked.' }
        } catch (error) {
            return actionFailure(error, 'The user could not be disabled.')
        }
    })
