import type { RefObject } from 'react'
import type { ApplicationNavigationItem } from './application-shell.types.ts'

export interface ApplicationShellLogicResult {
    readonly state: {
        readonly canViewAccount: boolean
        readonly navigationItems: readonly ApplicationNavigationItem[]
        readonly isNavigationExpanded: boolean
        readonly isMobileNavigationOpen: boolean
        readonly navigationToggleLabel: string
        readonly mobileNavigationToggleLabel: string
    }
    readonly handler: {
        readonly toggleNavigation: () => void
        readonly toggleMobileNavigation: () => void
        readonly closeMobileNavigation: () => void
    }
    readonly refs: {
        readonly sidebar: RefObject<HTMLElement | null>
        readonly sidebarScroll: RefObject<HTMLDivElement | null>
    }
}
