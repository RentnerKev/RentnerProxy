import { useState } from 'react'

import useTranslationStore from '../../../../language/useTranslationStore'

export default function useApplicationNavigationLogic() {
    const { t } = useTranslationStore()
    const [isNavigationExpanded, setIsNavigationExpanded] = useState(true)
    const [isMobileNavigationOpen, setIsMobileNavigationOpen] = useState(false)

    return {
        state: {
            isNavigationExpanded,
            isMobileNavigationOpen,
            navigationToggleLabel: t(
                isNavigationExpanded ? 'shell.collapseNavigation' : 'shell.expandNavigation',
            ),
            mobileNavigationToggleLabel: t(
                isMobileNavigationOpen ? 'shell.collapseNavigation' : 'shell.expandNavigation',
            ),
        },
        handler: {
            toggleNavigation: () => setIsNavigationExpanded((isExpanded) => !isExpanded),
            toggleMobileNavigation: () => setIsMobileNavigationOpen((isOpen) => !isOpen),
            closeMobileNavigation: () => setIsMobileNavigationOpen(false),
        },
    }
}
