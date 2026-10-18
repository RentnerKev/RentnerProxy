import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import getApplicationShellViewModel from '@/lib/ApplicationShell/applicationShell.ts'
import type { ApplicationUserSummary } from '../Types/application-shell.types.ts'
import type { ApplicationShellLogicResult } from '../Types/application-shell-logic.types.ts'
import useApplicationSidebarRefs from './useApplicationSidebarRefs.ts'
import useNavigationExpansion from './useNavigationExpansion.ts'
import { useRef, useState } from 'react'
import useApplicationUpdateQuery from '@/features/ApplicationVersion/Hooks/useApplicationUpdateQuery.ts'

export default function useApplicationShellLogic(
    user: ApplicationUserSummary,
): ApplicationShellLogicResult {
    const { t } = useTranslationStore()
    const navigation = useNavigationExpansion()
    const { sidebarRef, sidebarScrollRef } = useApplicationSidebarRefs()
    const view = getApplicationShellViewModel(user, t)
    const update = useApplicationUpdateQuery()
    const [isUpdateOpen, setIsUpdateOpen] = useState(false)
    const pendingUpdate = useRef(false)

    const openUpdate = () => {
        if (navigation.state.isMobileNavigationOpen) {
            pendingUpdate.current = true
            navigation.handler.closeMobileNavigation()
        } else {
            setIsUpdateOpen(true)
        }
    }

    const restoreMobileNavigationFocus = (event: Event) => {
        navigation.handler.restoreMobileNavigationFocus(event)
        if (pendingUpdate.current) {
            pendingUpdate.current = false
            // Wait until the navigation focus scope has unmounted.
            queueMicrotask(() => setIsUpdateOpen(true))
        }
    }

    return {
        state: {
            update,
            isUpdateOpen,
            canViewAccount: view.canViewAccount,
            navigationItems: view.navigationItems,
            isNavigationExpanded: navigation.state.isNavigationExpanded,
            isMobileNavigationOpen: navigation.state.isMobileNavigationOpen,
            navigationToggleLabel: navigation.state.navigationToggleLabel,
            mobileNavigationToggleLabel: navigation.state.mobileNavigationToggleLabel,
        },
        handler: {
            openUpdate,
            handleUpdateOpenChange: setIsUpdateOpen,
            toggleNavigation: navigation.handler.toggleNavigation,
            toggleMobileNavigation: navigation.handler.toggleMobileNavigation,
            closeMobileNavigation: navigation.handler.closeMobileNavigation,
            handleMobileNavigationOpenChange: navigation.handler.handleMobileNavigationOpenChange,
            restoreMobileNavigationFocus,
        },
        refs: {
            sidebar: sidebarRef,
            sidebarScroll: sidebarScrollRef,
            mobileNavigationToggle: navigation.refs.mobileNavigationToggle,
            desktopNavigationToggle: navigation.refs.desktopNavigationToggle,
        },
    }
}
