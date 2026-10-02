import type { UserThemeMode } from '@/shared/Types/theme-config.types.ts'

export interface ThemeModeSwitchProps {
    readonly isSaving: boolean
    readonly onToggle: () => void
    readonly themeMode: UserThemeMode
}

export interface ThemeModeSwitchViewModel {
    readonly currentLabel: string
    readonly isDark: boolean
    readonly targetLabel: 'dark' | 'light'
}
