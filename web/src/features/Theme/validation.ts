import { z } from 'zod'

import { USER_THEME_MODES } from '../../config/theme.config'

export const updateThemeModeInputSchema = z.object({
    themeMode: z.enum(USER_THEME_MODES),
})
