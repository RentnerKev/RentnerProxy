import type { AuthActionResult } from '@/server/Auth/Types/auth-transport.types.ts'
import { createServerFn } from '@tanstack/react-start'

import { PERMISSIONS } from '@/config/permissions.config.ts'
import { setSessionCookie } from '@/server/Auth/Access/cookies.server.ts'
import { acceptInviteService } from '@/server/Auth/Setup/invites.service.ts'
import {
    createSessionService,
    revokeSessionByTokenService,
} from '@/server/Auth/Access/sessions.service.ts'
import {
    actionFailure,
    AUTH_UNAVAILABLE_MESSAGE,
    enforceSensitiveLimit,
} from '@/server/Auth/transport.server.ts'
import { acceptInviteInputSchema } from './validation.ts'

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

            const session = await createSessionService(result.userId, 'invite')

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
