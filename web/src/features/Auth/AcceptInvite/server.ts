import { createServerFn } from '@tanstack/react-start'

import { PERMISSIONS } from '../../../config/permissions.config'
import { setSessionCookie } from '../../../server/Auth/Access/cookies.server'
import { acceptInviteService } from '../../../server/Auth/Setup/invites.service'
import {
    createSessionService,
    revokeSessionByTokenService,
} from '../../../server/Auth/Access/sessions.service'
import {
    actionFailure,
    AUTH_UNAVAILABLE_MESSAGE,
    enforceSensitiveLimit,
    type AuthActionResult,
} from '../serverHelpers'
import { acceptInviteInputSchema } from './validation'

export const acceptInviteHandler = createServerFn({ method: 'POST' })
    .validator(acceptInviteInputSchema)
    .handler(async ({ data }): Promise<AuthActionResult> => {
        try {
            await enforceSensitiveLimit('invite', data.token)
            const result = await acceptInviteService({
                displayName: data.displayName,
                token: data.token,
                password: data.password,
            })

            if (!result.success) {
                return { success: false, message: 'This invitation is invalid or has expired.' }
            }

            const session = await createSessionService(result.userId)

            if (session.user.permissions.includes(PERMISSIONS.APP_ACCESS)) {
                setSessionCookie(session.token, session.expiresAt)
            } else {
                await revokeSessionByTokenService(session.token)
            }

            return { success: true, message: 'Account activated.' }
        } catch (error) {
            return actionFailure(error, AUTH_UNAVAILABLE_MESSAGE)
        }
    })
