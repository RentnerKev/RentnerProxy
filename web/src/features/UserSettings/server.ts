import { createServerFn } from '@tanstack/react-start'

import { PERMISSIONS } from '../../config/permissions.config'
import { requirePermissionService } from '../../server/Auth/Access/authorization.service'
import { updateCurrentUserLanguageService } from '../../server/UserSettings/language.service'
import { updateCurrentUserThemeModeService } from '../../server/UserSettings/theme.service'
import { localizedActionFailure } from '../Auth/serverHelpers'
import type { LanguageUpdateResult } from './Types/language-server-result.types'
import type { ThemeModeUpdateResult } from './Types/theme-server-result.types'
import { updateLanguageInputSchema, updateThemeModeInputSchema } from './validation'

export const updateCurrentUserLanguageHandler = createServerFn({ method: 'POST' })
    .validator(updateLanguageInputSchema)
    .handler(async ({ data }): Promise<LanguageUpdateResult> => {
        try {
            await requirePermissionService(PERMISSIONS.APP_ACCESS)
            const language = await updateCurrentUserLanguageService(data.language)
            return { success: true, language, message: 'language.saved' }
        } catch (error) {
            return localizedActionFailure(error, 'language.saveFailed')
        }
    })

export const updateCurrentUserThemeModeHandler = createServerFn({ method: 'POST' })
    .validator(updateThemeModeInputSchema)
    .handler(async ({ data }): Promise<ThemeModeUpdateResult> => {
        try {
            await requirePermissionService(PERMISSIONS.APP_ACCESS)
            const themeMode = await updateCurrentUserThemeModeService(data.themeMode)
            return { success: true, themeMode }
        } catch (error) {
            return localizedActionFailure(error, 'theme.saveFailed')
        }
    })
