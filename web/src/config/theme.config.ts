import type { UserThemeMode } from '@/shared/Types/theme-config.types.ts'
export const USER_THEME_MODES = ['light', 'dark'] as const

export const DEFAULT_USER_THEME_MODE: UserThemeMode = 'light'
