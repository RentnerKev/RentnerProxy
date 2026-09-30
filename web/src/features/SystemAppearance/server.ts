import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'

import { systemAccentColorUpdateSchema } from '../../config/appearance.config'
import {
    getSystemAccentColorService,
    updateSystemAccentColorService,
} from '../../server/SystemAppearance/system-appearance.service'
import { localizedActionFailure, throwLocalizedQueryError } from '../Auth/serverHelpers'

export type UpdateSystemAccentColorResult =
    | { readonly success: true; readonly accentColor: string }
    | { readonly success: false; readonly message: string }

function noStore(): void {
    setResponseHeader('Cache-Control', 'no-store')
}

export const getSystemAccentColorHandler = createServerFn({ method: 'GET' }).handler(async () => {
    noStore()
    try {
        return { accentColor: await getSystemAccentColorService() }
    } catch (error) {
        throwLocalizedQueryError(error, 'systemAppearance.errors.loadFailed')
    }
})

export const updateSystemAccentColorHandler = createServerFn({ method: 'POST' })
    // Keep validation inside the handler so callers receive a structured failure.
    .validator((data: unknown) => data)
    .handler(async ({ data }): Promise<UpdateSystemAccentColorResult> => {
        noStore()
        const parsed = systemAccentColorUpdateSchema.safeParse(data)
        if (!parsed.success) {
            return { success: false, message: 'systemAppearance.errors.invalidColor' }
        }
        try {
            return {
                success: true,
                accentColor: await updateSystemAccentColorService(parsed.data),
            }
        } catch (error) {
            return localizedActionFailure(error, 'systemAppearance.errors.saveFailed')
        }
    })
