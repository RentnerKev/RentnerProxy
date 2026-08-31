import type { ReactNode } from 'react'

import type { UserThemeMode } from '../../../../config/theme.config'

export interface ApplicationFooterProps {
    readonly label: string
}

export interface ApplicationHeaderProps {
    readonly label: string
}

export interface ApplicationUserSummary {
    readonly displayName: string
    readonly email: string
    readonly id: string
    readonly permissions: readonly string[]
    readonly profileImageVersion: number | null
}

export interface AuthenticatedShellProps {
    readonly children: ReactNode
    readonly isLoggingOut: boolean
    readonly onLogout: () => void
    readonly themeControl: ReactNode
    readonly themeMode: UserThemeMode
    readonly user: ApplicationUserSummary
}

export interface ApplicationNavigationItem {
    readonly exact?: boolean
    readonly label: string
    readonly to: '/' | '/proxy-hosts' | '/certificates' | '/roles' | '/users'
}

export interface ApplicationNavigationProps {
    readonly items: readonly ApplicationNavigationItem[]
}

export interface ApplicationUserPanelProps {
    readonly canViewAccount: boolean
    readonly isLoggingOut: boolean
    readonly onLogout: () => void
    readonly user: ApplicationUserSummary
}

export interface ApplicationTopbarProps {
    readonly isNavigationExpanded: boolean
    readonly navigationToggleLabel: string
    readonly onToggleNavigation: () => void
    readonly themeControl: ReactNode
}

export interface ApplicationShellViewModel {
    readonly canViewAccount: boolean
    readonly navigationItems: readonly ApplicationNavigationItem[]
}
