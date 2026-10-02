import type { AuthActionResult } from '@/server/Auth/Types/auth-transport.types.ts'
import { createServerFn } from '@tanstack/react-start'

import { clearSessionCookie } from '@/server/Auth/Access/cookies.server.ts'
import { consumePasswordResetService } from '@/server/Auth/PasswordReset/password-reset.service.ts'
import {
    actionFailure,
    AUTH_UNAVAILABLE_MESSAGE,
    enforceSensitiveLimit,
} from '@/server/Auth/transport.server.ts'
import { tokenPasswordInputSchema } from './validation.ts'

export const resetPasswordHandler = createServerFn({ method: 'POST' })
    .validator(tokenPasswordInputSchema)
    .handler(async ({ data }): Promise<AuthActionResult> => {
        try {
            await enforceSensitiveLimit('reset', data.token)
            const result = await consumePasswordResetService({
                token: data.token,
                password: data.password,
            })

            if (!result.success) {
                return {
                    success: false,
                    message: 'This password reset link is invalid or has expired.',
                }
            }

            clearSessionCookie()
            return { success: true, message: 'Password updated. Sign in with your new password.' }
        } catch (error) {
            return actionFailure(error, AUTH_UNAVAILABLE_MESSAGE)
        }
    })
