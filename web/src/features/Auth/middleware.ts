import { createServerFn } from '@tanstack/react-start'

import { getAuthStateService } from '@/server/Auth/Access/auth-state.service.ts'
import { clearSessionCookie } from '@/server/Auth/Access/cookies.server.ts'
import { revokeCurrentSessionService } from '@/server/Auth/Access/sessions.service.ts'
import type { AuthActionResult } from '@/server/Auth/Types/auth-transport.types.ts'
import { throwPageError } from '@/server/Auth/transport.server.ts'

export const getAuthStateHandler = createServerFn({ method: 'GET' }).handler(async () => {
    const state = await getAuthStateService().catch(throwPageError)

    return {
        setupRequired: state.setupRequired,
        user: state.user
            ? {
                  id: state.user.id,
                  displayName: state.user.displayName,
                  email: state.user.email,
                  profileImageVersion: state.user.profileImageVersion,
                  roles: state.user.roles,
                  permissions: state.user.permissions,
                  language: state.user.language,
                  themeMode: state.user.themeMode,
                  navigationGroupPreferences: state.user.navigationGroupPreferences ?? {},
              }
            : null,
    }
})

export const logoutHandler = createServerFn({ method: 'POST' }).handler(
    async (): Promise<AuthActionResult> => {
        try {
            await revokeCurrentSessionService()
            return { success: true, message: 'Signed out.' }
        } catch {
            return { success: false, message: 'The server session could not be revoked.' }
        } finally {
            clearSessionCookie()
        }
    },
)
