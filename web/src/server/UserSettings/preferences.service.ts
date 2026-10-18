import '@tanstack/react-start/server-only'

import { PERMISSIONS } from '@/config/permissions.config.ts'
import type { UserThemeMode } from '@/config/Types/theme-config.types.ts'
import type { AppLanguage } from '@/shared/Language/Types/language.types.ts'
import { userSettings } from '@/db/schema.ts'
import { getAuthDatabase } from '@/server/Auth/Core/database.server.ts'
import { AuthDomainError } from '@/server/Auth/Core/errors.server.ts'
import { getCurrentSessionService } from '@/server/Auth/Access/sessions.service.ts'
import type { UserPreference } from './Types/preferences.types.ts'

async function saveCurrentUserPreference(
    preference: UserPreference,
    unavailableMessage: string,
): Promise<void> {
    const session = await getCurrentSessionService()
    if (!session) {
        throw new AuthDomainError('authentication_required', 'Authentication is required.')
    }
    if (!session.user.permissions.includes(PERMISSIONS.APP_ACCESS)) {
        throw new AuthDomainError('permission_denied', 'Application access is required.')
    }

    const rows = await getAuthDatabase()
        .insert(userSettings)
        .values({ userId: session.user.id, ...preference })
        .onConflictDoUpdate({ target: userSettings.userId, set: preference })
        .returning({ userId: userSettings.userId })
    if (rows.length === 0) {
        throw new AuthDomainError('service_unavailable', unavailableMessage)
    }
}

export async function updateCurrentUserLanguageService(
    language: AppLanguage,
): Promise<AppLanguage> {
    await saveCurrentUserPreference({ language }, 'Language could not be updated.')
    return language
}

export async function updateCurrentUserThemeModeService(
    themeMode: UserThemeMode,
): Promise<UserThemeMode> {
    await saveCurrentUserPreference({ themeMode }, 'Theme could not be updated.')
    return themeMode
}
