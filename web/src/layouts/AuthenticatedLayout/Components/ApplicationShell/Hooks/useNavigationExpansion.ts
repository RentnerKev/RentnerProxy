import { useRef, useState } from 'react'

import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'

export default function useNavigationExpansion() {
    const { t } = useTranslationStore()
    const [isNavigationExpanded, setIsNavigationExpanded] = useState(true)
    const [isMobileNavigationOpen, setIsMobileNavigationOpen] = useState(false)
    const mobileNavigationToggle = useRef<HTMLButtonElement>(null)

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
            handleMobileNavigationOpenChange: (open: boolean) => setIsMobileNavigationOpen(open),
            restoreMobileNavigationFocus: (event: Event) => {
                event.preventDefault()
                mobileNavigationToggle.current?.focus()
            },
        },
        refs: { mobileNavigationToggle },
    }
}
