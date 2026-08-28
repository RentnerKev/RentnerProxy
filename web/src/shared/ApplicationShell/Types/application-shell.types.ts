import type { ReactNode } from 'react'

import type { UserThemeMode } from '../../../config/theme.config'

export interface ApplicationFooterProps {
    readonly label: string
}

export interface ApplicationHeaderProps {
    readonly label: string
}

export interface ApplicationUserSummary {
    readonly displayName: string
    readonly email: string
    readonly roles: readonly string[]
    readonly permissions: readonly string[]
}

export interface AuthenticatedShellProps {
    readonly children: ReactNode
    readonly isLoggingOut: boolean
    readonly isThemeModeSaving: boolean
    readonly onLogout: () => void
    readonly onThemeModeToggle: () => void
    readonly themeMode: UserThemeMode
    readonly themeModeError: string | null
    readonly user: ApplicationUserSummary
}
