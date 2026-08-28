import { createServerFn } from '@tanstack/react-start'

import { setSessionCookie } from '../../../server/Auth/Access/cookies.server'
import { createSessionService } from '../../../server/Auth/Access/sessions.service'
import { setupFirstOwnerService } from '../../../server/Auth/Setup/setup.service'
import {
    actionFailure,
    AUTH_UNAVAILABLE_MESSAGE,
    enforceSensitiveLimit,
    type AuthActionResult,
} from '../serverHelpers'
import { setupInputSchema } from './validation'

export const setupOwnerHandler = createServerFn({ method: 'POST' })
    .validator(setupInputSchema)
    .handler(async ({ data }): Promise<AuthActionResult> => {
        try {
            await enforceSensitiveLimit('setup', data.email)
            const result = await setupFirstOwnerService({
                displayName: data.displayName,
                email: data.email,
                password: data.password,
            })

            if (!result.success) {
                return { success: false, message: 'Setup is no longer available.' }
            }

            const session = await createSessionService(result.userId)
            setSessionCookie(session.token, session.expiresAt)
            return { success: true, message: 'Owner account created.' }
        } catch (error) {
            return actionFailure(error, AUTH_UNAVAILABLE_MESSAGE)
        }
    })
