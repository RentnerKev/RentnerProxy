import '@tanstack/react-start/server-only'

import { PERMISSIONS } from '../../config/permissions.config'
import type { AppLanguage } from '../../language/useTranslationStore'
import { userSettings } from '../../db/schema'
import { getAuthDatabase } from '../Auth/Core/database.server'
import { AuthDomainError } from '../Auth/Core/errors.server'
import { getCurrentSessionService } from '../Auth/Access/sessions.service'

export async function updateCurrentUserLanguageService(
    language: AppLanguage,
): Promise<AppLanguage> {
    const session = await getCurrentSessionService()

    if (!session) {
        throw new AuthDomainError('authentication_required', 'Authentication is required.')
    }

    if (!session.user.permissions.includes(PERMISSIONS.APP_ACCESS)) {
        throw new AuthDomainError('permission_denied', 'Application access is required.')
    }

    const rows = await getAuthDatabase()
        .insert(userSettings)
        .values({ language, userId: session.user.id })
        .onConflictDoUpdate({
            target: userSettings.userId,
            set: { language },
        })
        .returning({ language: userSettings.language })
    const updated = rows.at(0)

    if (!updated) {
        throw new AuthDomainError('service_unavailable', 'Language could not be updated.')
    }

    return language
}
