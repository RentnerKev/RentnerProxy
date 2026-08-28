export const USER_THEME_MODES = ['light', 'dark'] as const
export type UserThemeMode = (typeof USER_THEME_MODES)[number]

export const DEFAULT_USER_THEME_MODE: UserThemeMode = 'light'

export function isUserThemeMode(value: unknown): value is UserThemeMode {
    return USER_THEME_MODES.includes(value as UserThemeMode)
}
