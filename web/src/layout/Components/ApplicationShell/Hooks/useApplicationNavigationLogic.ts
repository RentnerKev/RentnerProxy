import { useState } from 'react'

import useTranslationStore from '../../../../language/useTranslationStore'

export default function useApplicationNavigationLogic() {
    const { t } = useTranslationStore()
    const [isNavigationExpanded, setIsNavigationExpanded] = useState(true)

    return {
        state: {
            isNavigationExpanded,
            navigationToggleLabel: t(
                isNavigationExpanded ? 'shell.collapseNavigation' : 'shell.expandNavigation',
            ),
        },
        handler: {
            toggleNavigation: () => setIsNavigationExpanded((isExpanded) => !isExpanded),
        },
    }
}
