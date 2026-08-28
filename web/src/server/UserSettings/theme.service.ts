import '@tanstack/react-start/server-only'

import { PERMISSIONS } from '../../config/permissions.config'
import type { UserThemeMode } from '../../config/theme.config'
import { userSettings } from '../../db/schema'
import { getAuthDatabase } from '../Auth/Core/database.server'
import { AuthDomainError } from '../Auth/Core/errors.server'
import { getCurrentSessionService } from '../Auth/Access/sessions.service'

export async function updateCurrentUserThemeModeService(
    themeMode: UserThemeMode,
): Promise<UserThemeMode> {
    const session = await getCurrentSessionService()

    if (!session) {
        throw new AuthDomainError('authentication_required', 'Authentication is required.')
    }

    if (!session.user.permissions.includes(PERMISSIONS.APP_ACCESS)) {
        throw new AuthDomainError('permission_denied', 'Application access is required.')
    }

    const rows = await getAuthDatabase()
        .insert(userSettings)
        .values({ userId: session.user.id, themeMode })
        .onConflictDoUpdate({
            target: userSettings.userId,
            set: { themeMode },
        })
        .returning({ themeMode: userSettings.themeMode })
    const updated = rows.at(0)

    if (!updated) {
        throw new AuthDomainError('service_unavailable', 'Theme could not be updated.')
    }

    return themeMode
}
