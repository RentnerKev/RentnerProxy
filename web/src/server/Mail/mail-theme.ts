import { MAIL_BASE_THEMES } from '@/config/mail.config.ts'
import { DEFAULT_ACCENT_COLOR } from '@/config/appearance.config.ts'
import { DEFAULT_USER_THEME_MODE } from '@/config/theme.config.ts'
import { deriveAccentPalette } from '@/lib/Theme/accentPalette.ts'
import { isUserThemeMode } from '@/lib/Theme/themeMode.ts'
import type { MailAppearance, MailTheme } from './Types/mail-theme.types.ts'

export function createMailTheme(appearance?: MailAppearance): MailTheme {
    const mode = isUserThemeMode(appearance?.themeMode)
        ? appearance.themeMode
        : DEFAULT_USER_THEME_MODE
    const palette = deriveAccentPalette(appearance?.accentColor ?? DEFAULT_ACCENT_COLOR)
    return {
        ...MAIL_BASE_THEMES[mode],
        mode,
        accent: palette.accent,
        accentText: mode === 'dark' ? palette.textDark : palette.textLight,
        accentForeground: palette.foreground,
    }
}
