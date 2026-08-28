import { createServerFn } from '@tanstack/react-start'

import { PERMISSIONS } from '../../../config/permissions.config'
import { changeCurrentPasswordService } from '../../../server/Auth/Account/account.service'
import { requirePermissionService } from '../../../server/Auth/Access/authorization.service'
import { actionFailure, type AuthActionResult } from '../serverHelpers'
import { changePasswordInputSchema } from './validation'

export const changePasswordHandler = createServerFn({ method: 'POST' })
    .validator(changePasswordInputSchema)
    .handler(async ({ data }): Promise<AuthActionResult> => {
        try {
            await requirePermissionService(PERMISSIONS.ACCOUNT_UPDATE)
            const result = await changeCurrentPasswordService({
                currentPassword: data.currentPassword,
                password: data.password,
            })

            return result.success
                ? { success: true, message: 'Password changed. Other sessions were revoked.' }
                : { success: false, message: 'The current password is incorrect.' }
        } catch (error) {
            return actionFailure(error, 'The password could not be changed.')
        }
    })
