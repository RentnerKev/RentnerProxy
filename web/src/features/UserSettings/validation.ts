import { z } from 'zod'

import { AVAILABLE_LANGUAGES } from '../../config/language.config'
import { USER_THEME_MODES } from '../../config/theme.config'

export const updateLanguageInputSchema = z.object({
    language: z.enum(AVAILABLE_LANGUAGES),
})

export const updateThemeModeInputSchema = z.object({
    themeMode: z.enum(USER_THEME_MODES),
})
