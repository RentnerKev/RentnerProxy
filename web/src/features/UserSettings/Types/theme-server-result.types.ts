import type { UserThemeMode } from '@/config/Types/theme-config.types.ts'

export type ThemeModeUpdateResult =
    | { readonly success: true; readonly themeMode: UserThemeMode }
    | { readonly success: false; readonly message: string }
