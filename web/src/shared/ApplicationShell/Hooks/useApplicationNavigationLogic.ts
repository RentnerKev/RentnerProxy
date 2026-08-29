import { useState } from 'react'

export default function useApplicationNavigationLogic() {
    const [isNavigationExpanded, setIsNavigationExpanded] = useState(true)

    return {
        state: {
            isNavigationExpanded,
            navigationToggleLabel: isNavigationExpanded
                ? 'Collapse navigation'
                : 'Expand navigation',
        },
        handler: {
            toggleNavigation: () => setIsNavigationExpanded((isExpanded) => !isExpanded),
        },
    }
}
