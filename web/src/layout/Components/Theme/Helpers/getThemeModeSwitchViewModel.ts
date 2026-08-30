import type { UserThemeMode } from '../../../../config/theme.config'
import type { Translate } from '../../../../language/useTranslationStore'
import type { ThemeModeSwitchViewModel } from '../Types/theme-component-props.types'

export default function getThemeModeSwitchViewModel(
    themeMode: UserThemeMode,
    t: Translate,
): ThemeModeSwitchViewModel {
    const isDark = themeMode === 'dark'

    return {
        currentLabel: t(isDark ? 'theme.dark' : 'theme.light'),
        isDark,
        targetLabel: isDark ? 'light' : 'dark',
    }
}
