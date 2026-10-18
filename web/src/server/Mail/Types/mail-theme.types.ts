import type { UserThemeMode } from '@/config/Types/theme-config.types.ts'
import type { MAIL_BASE_THEMES } from '@/config/mail.config.ts'

export type MailAppearance = Readonly<{
    themeMode: UserThemeMode
    accentColor: string
}>

export type MailTheme = (typeof MAIL_BASE_THEMES)[UserThemeMode] &
    Readonly<{
        mode: UserThemeMode
        accent: string
        accentText: string
        accentForeground: string
    }>

export type MailLayoutInput = Readonly<{
    appUrl: string
    heading: string
    eyebrow: string
    preview: string
    contentRowsHtml: string
    footerText?: string | undefined
    appearance?: MailAppearance | undefined
}>
