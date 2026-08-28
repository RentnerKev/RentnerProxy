import { createServerFn } from '@tanstack/react-start'

import { PERMISSIONS } from '../../../config/permissions.config'
import { setSessionCookie } from '../../../server/Auth/Access/cookies.server'
import { loginService } from '../../../server/Auth/Login/login.service'
import { revokeSessionByTokenService } from '../../../server/Auth/Access/sessions.service'
import {
    actionFailure,
    AUTH_UNAVAILABLE_MESSAGE,
    enforceSensitiveLimit,
    GENERIC_LOGIN_MESSAGE,
    type AuthActionResult,
} from '../serverHelpers'
import { loginInputSchema } from './validation'

export const loginHandler = createServerFn({ method: 'POST' })
    .validator(loginInputSchema)
    .handler(async ({ data }): Promise<AuthActionResult> => {
        try {
            await enforceSensitiveLimit('login', data.email)
            const result = await loginService(data)

            if (!result.success) {
                return { success: false, message: GENERIC_LOGIN_MESSAGE }
            }

            if (!result.user.permissions.includes(PERMISSIONS.APP_ACCESS)) {
                await revokeSessionByTokenService(result.session.token)
                return { success: false, message: GENERIC_LOGIN_MESSAGE }
            }

            setSessionCookie(result.session.token, result.session.expiresAt)
            return { success: true, message: 'Signed in.' }
        } catch (error) {
            return actionFailure(error, AUTH_UNAVAILABLE_MESSAGE)
        }
    })
