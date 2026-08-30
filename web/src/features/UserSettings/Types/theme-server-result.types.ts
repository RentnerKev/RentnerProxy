import type { UserThemeMode } from '../../../config/theme.config'

export type ThemeModeUpdateResult =
    | { readonly success: true; readonly themeMode: UserThemeMode }
    | { readonly success: false; readonly message: string }
