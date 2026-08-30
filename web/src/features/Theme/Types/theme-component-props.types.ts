import type { UserThemeMode } from '../../../config/theme.config'

export interface ThemeModeSwitchProps {
    readonly errorMessage: string | null
    readonly isSaving: boolean
    readonly onToggle: () => void
    readonly themeMode: UserThemeMode
}

export interface ThemeModeSwitchViewModel {
    readonly currentLabel: string
    readonly isDark: boolean
    readonly targetLabel: 'dark' | 'light'
}
