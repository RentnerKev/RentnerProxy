import { createServerFn } from '@tanstack/react-start'

import { PERMISSIONS } from '../../config/permissions.config'
import { requirePermissionService } from '../../server/Auth/Access/authorization.service'
import { updateCurrentUserThemeModeService } from '../../server/UserSettings/theme.service'
import { localizedActionFailure } from '../Auth/serverHelpers'
import type { ThemeModeUpdateResult } from './Types/theme-server-result.types'
import { updateThemeModeInputSchema } from './validation'

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
