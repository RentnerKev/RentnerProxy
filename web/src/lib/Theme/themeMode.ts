import { USER_THEME_MODES } from '@/config/theme.config.ts'
import type { UserThemeMode } from '@/shared/Types/theme-config.types.ts'
export function isUserThemeMode(value: unknown): value is UserThemeMode {
    return USER_THEME_MODES.includes(value as UserThemeMode)
}
