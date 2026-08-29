import type { UserThemeMode } from '../../../config/theme.config'
import type { ThemeModeSwitchViewModel } from '../Types/theme-component-props.types'

export default function getThemeModeSwitchViewModel(
    themeMode: UserThemeMode,
): ThemeModeSwitchViewModel {
    const isDark = themeMode === 'dark'

    return {
        currentLabel: isDark ? 'Dark' : 'Light',
        isDark,
        targetLabel: isDark ? 'light' : 'dark',
    }
}
