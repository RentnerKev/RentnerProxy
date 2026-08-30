import { createServerFn } from '@tanstack/react-start'

import { getAuthStateService } from '../../server/Auth/Access/auth-state.service'
import { clearSessionCookie } from '../../server/Auth/Access/cookies.server'
import { revokeCurrentSessionService } from '../../server/Auth/Access/sessions.service'
import type { AuthActionResult } from './serverHelpers'
import { throwPageError } from './serverHelpers'

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
