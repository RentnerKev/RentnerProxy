import { createServerFn } from '@tanstack/react-start'

import { consumePasswordResetService } from '../../../server/Auth/PasswordReset/password-reset.service'
import {
    actionFailure,
    AUTH_UNAVAILABLE_MESSAGE,
    enforceSensitiveLimit,
    type AuthActionResult,
} from '../serverHelpers'
import { tokenPasswordInputSchema } from './validation'

export const resetPasswordHandler = createServerFn({ method: 'POST' })
    .validator(tokenPasswordInputSchema)
    .handler(async ({ data }): Promise<AuthActionResult> => {
        try {
            await enforceSensitiveLimit('reset', data.token)
            const result = await consumePasswordResetService({
                token: data.token,
                password: data.password,
            })

            return result.success
                ? { success: true, message: 'Password updated. Sign in with your new password.' }
                : {
                      success: false,
                      message: 'This password reset link is invalid or has expired.',
                  }
        } catch (error) {
            return actionFailure(error, AUTH_UNAVAILABLE_MESSAGE)
        }
    })
