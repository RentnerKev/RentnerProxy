import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import getApplicationShellViewModel from '@/lib/ApplicationShell/applicationShell.ts'
import type { ApplicationUserSummary } from '../Types/application-shell.types.ts'
import type { ApplicationShellLogicResult } from '../Types/application-shell-logic.types.ts'
import useApplicationSidebarRefs from './useApplicationSidebarRefs.ts'
import useNavigationExpansion from './useNavigationExpansion.ts'

export default function useApplicationShellLogic(
    user: ApplicationUserSummary,
): ApplicationShellLogicResult {
    const { t } = useTranslationStore()
    const navigation = useNavigationExpansion()
    const { sidebarRef, sidebarScrollRef } = useApplicationSidebarRefs()
    const view = getApplicationShellViewModel(user, t)

    return {
        state: {
            canViewAccount: view.canViewAccount,
            navigationItems: view.navigationItems,
            isNavigationExpanded: navigation.state.isNavigationExpanded,
            isMobileNavigationOpen: navigation.state.isMobileNavigationOpen,
            navigationToggleLabel: navigation.state.navigationToggleLabel,
            mobileNavigationToggleLabel: navigation.state.mobileNavigationToggleLabel,
        },
        handler: {
            toggleNavigation: navigation.handler.toggleNavigation,
            toggleMobileNavigation: navigation.handler.toggleMobileNavigation,
            closeMobileNavigation: navigation.handler.closeMobileNavigation,
            handleMobileNavigationOpenChange: navigation.handler.handleMobileNavigationOpenChange,
            restoreMobileNavigationFocus: navigation.handler.restoreMobileNavigationFocus,
        },
        refs: {
            sidebar: sidebarRef,
            sidebarScroll: sidebarScrollRef,
            mobileNavigationToggle: navigation.refs.mobileNavigationToggle,
            desktopNavigationToggle: navigation.refs.desktopNavigationToggle,
        },
    }
}
