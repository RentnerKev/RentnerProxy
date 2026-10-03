import type { InputMessages } from '@rentnerkev/inputs'
import type { SelectMessages } from '@rentnerkev/select'

import type { AppLanguage } from '@/shared/Language/Types/language.types.ts'
import type {
    NavigationGroupChange,
    NavigationGroupPreferences,
} from '@/config/Types/navigation-config.types.ts'
import type { UserThemeMode } from '@/config/Types/theme-config.types.ts'

export interface AuthenticatedLayoutLogicResult {
    readonly state: {
        readonly isLoggingOut: boolean
        readonly themeMode: UserThemeMode
        readonly isSavingTheme: boolean
        readonly navigationGroupPreferences: NavigationGroupPreferences
        readonly language: AppLanguage
        readonly inputMessages: InputMessages
        readonly selectMessages: SelectMessages
        readonly selectNonce: string | undefined
        readonly toastMessages: {
            readonly regionLabel: string
            readonly closeNotification: string
            readonly copyError: string
            readonly errorCopied: string
        }
    }
    readonly handler: {
        readonly handleLogout: () => void
        readonly handleToggleTheme: () => void
        readonly handleNavigationGroupChange: (change: NavigationGroupChange) => void
    }
}
