import type { UserThemeMode } from '@/config/Types/theme-config.types.ts'
import type { Translate } from '@/shared/Language/Types/language.types.ts'
import type { ThemeModeSwitchViewModel } from '@/shared/Theme/Types/theme-component-props.types.ts'

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
