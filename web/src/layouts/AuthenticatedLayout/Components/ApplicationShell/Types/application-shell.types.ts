import type { ReactNode, RefObject } from 'react'

import type { UserThemeMode } from '@/config/Types/theme-config.types.ts'
import type {
    NavigationGroupChange,
    NavigationGroupPreferences,
} from '@/config/Types/navigation-config.types.ts'

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
    readonly navigationGroupPreferences?: NavigationGroupPreferences
    readonly onNavigationGroupChange?: (change: NavigationGroupChange) => void
    readonly user: ApplicationUserSummary
}

export interface ApplicationNavigationItem {
    readonly exact?: boolean
    readonly label: string
    readonly to:
        | '/'
        | '/operations'
        | '/proxy-hosts'
        | '/redirect-hosts'
        | '/certificates'
        | '/access-policies'
        | '/proxy-access-logs'
        | '/crowdsec'
        | '/security'
        | '/audit-logs'
        | '/npm-import'
        | '/migration'
        | '/roles'
        | '/users'
}

export interface ApplicationNavigationProps {
    readonly items: readonly ApplicationNavigationItem[]
    readonly groupPreferences?: NavigationGroupPreferences | undefined
    readonly onGroupChange?: ((change: NavigationGroupChange) => void) | undefined
    readonly onNavigate?: () => void
}

export interface ApplicationUserPanelProps {
    readonly canViewAccount: boolean
    readonly isLoggingOut: boolean
    readonly onLogout: () => void
    readonly onNavigate?: () => void
    readonly user: ApplicationUserSummary
}

export interface ApplicationTopbarProps {
    readonly mobileNavigationToggleRef?: RefObject<HTMLButtonElement | null>
    readonly desktopNavigationToggleRef?: RefObject<HTMLButtonElement | null>
    readonly isMobileNavigationOpen: boolean
    readonly isNavigationExpanded: boolean
    readonly mobileNavigationToggleLabel: string
    readonly navigationToggleLabel: string
    readonly onToggleMobileNavigation: () => void
    readonly onToggleNavigation: () => void
    readonly themeControl: ReactNode
    readonly searchControl?: ReactNode
}

export interface ApplicationMobileNavigationProps {
    readonly open: boolean
    readonly onOpenChange: (open: boolean) => void
    readonly onCloseAutoFocus: (event: Event) => void
    readonly children: ReactNode
}

export interface ApplicationShellViewModel {
    readonly canViewAccount: boolean
    readonly navigationItems: readonly ApplicationNavigationItem[]
}
