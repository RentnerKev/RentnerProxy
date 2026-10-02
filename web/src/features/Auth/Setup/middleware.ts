import type { AuthActionResult } from '@/server/Auth/Types/auth-transport.types.ts'
import { createServerFn } from '@tanstack/react-start'

import { setSessionCookie } from '@/server/Auth/Access/cookies.server.ts'
import { createSessionService } from '@/server/Auth/Access/sessions.service.ts'
import { setupFirstOwnerService } from '@/server/Auth/Setup/setup.service.ts'
import {
    actionFailure,
    AUTH_UNAVAILABLE_MESSAGE,
    enforceSensitiveLimit,
} from '@/server/Auth/transport.server.ts'
import { setupInputSchema } from './validation.ts'

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

            const session = await createSessionService(result.userId, 'setup')
            setSessionCookie(session.token, session.expiresAt)
            return { success: true, message: 'Owner account created.' }
        } catch (error) {
            return actionFailure(error, AUTH_UNAVAILABLE_MESSAGE)
        }
    })
