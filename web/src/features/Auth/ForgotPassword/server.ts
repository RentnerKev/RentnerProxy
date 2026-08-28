import { createServerFn } from '@tanstack/react-start'

import { requestPasswordResetService } from '../../../server/Auth/PasswordReset/password-reset.service'
import {
    actionFailure,
    AUTH_UNAVAILABLE_MESSAGE,
    enforceSensitiveLimit,
    GENERIC_RESET_MESSAGE,
    type AuthActionResult,
    waitForResetTimingFloor,
} from '../serverHelpers'
import { forgotPasswordInputSchema } from './validation'

export const requestPasswordResetHandler = createServerFn({ method: 'POST' })
    .validator(forgotPasswordInputSchema)
    .handler(async ({ data }): Promise<AuthActionResult> => {
        try {
            await enforceSensitiveLimit('reset', data.email)
        } catch (error) {
            return actionFailure(error, AUTH_UNAVAILABLE_MESSAGE)
        }

        const startedAt = Date.now()

        try {
            await requestPasswordResetService(data.email)
        } catch {
            console.warn('[auth] password reset delivery unavailable')
        } finally {
            await waitForResetTimingFloor(startedAt)
        }

        return { success: true, message: GENERIC_RESET_MESSAGE }
    })
