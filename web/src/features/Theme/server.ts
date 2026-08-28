import { createServerFn } from '@tanstack/react-start'
import { setResponseStatus } from '@tanstack/react-start/server'

import { PERMISSIONS } from '../../config/permissions.config'
import { requirePermissionService } from '../../server/Auth/Access/authorization.service'
import { isAuthDomainError } from '../../server/Auth/Core/errors.server'
import { updateCurrentUserThemeModeService } from '../../server/UserSettings/theme.service'
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
            if (isAuthDomainError(error)) {
                if (error.code === 'authentication_required') {
                    setResponseStatus(401)
                    return { success: false, message: 'Your session has expired.' }
                }

                if (error.code === 'permission_denied') {
                    setResponseStatus(403)
                    return { success: false, message: 'Theme access is unavailable.' }
                }
            }

            setResponseStatus(503)
            return { success: false, message: 'The theme could not be saved.' }
        }
    })
