import type { RefObject } from 'react'
import type { ApplicationUpdateResult } from '@/features/ApplicationVersion/Types/application-update.types.ts'
import type { ApplicationNavigationItem } from './application-shell.types.ts'

export interface ApplicationShellLogicResult {
    readonly state: {
        readonly update: ApplicationUpdateResult | undefined
        readonly isUpdateOpen: boolean
        readonly canViewAccount: boolean
        readonly navigationItems: readonly ApplicationNavigationItem[]
        readonly isNavigationExpanded: boolean
        readonly isMobileNavigationOpen: boolean
        readonly navigationToggleLabel: string
        readonly mobileNavigationToggleLabel: string
    }
    readonly handler: {
        readonly openUpdate: () => void
        readonly handleUpdateOpenChange: (open: boolean) => void
        readonly toggleNavigation: () => void
        readonly toggleMobileNavigation: () => void
        readonly closeMobileNavigation: () => void
        readonly handleMobileNavigationOpenChange: (open: boolean) => void
        readonly restoreMobileNavigationFocus: (event: Event) => void
    }
    readonly refs: {
        readonly sidebar: RefObject<HTMLElement | null>
        readonly sidebarScroll: RefObject<HTMLDivElement | null>
        readonly mobileNavigationToggle: RefObject<HTMLButtonElement | null>
        readonly desktopNavigationToggle: RefObject<HTMLButtonElement | null>
    }
}
