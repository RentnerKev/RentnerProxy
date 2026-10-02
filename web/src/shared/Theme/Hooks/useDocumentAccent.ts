import { useRouterState } from '@tanstack/react-router'
import { useMemo, useState } from 'react'

import { DEFAULT_ACCENT_COLOR } from '@/config/appearance.config.ts'

export function useDocumentAccent() {
    const routeAccentColor = useRouterState({
        select: (state) => {
            const rootMatch = state.matches.find((match) => match.routeId === '__root__')
            const accentColor = (rootMatch?.context as { accentColor?: unknown } | undefined)
                ?.accentColor
            return typeof accentColor === 'string' ? accentColor : DEFAULT_ACCENT_COLOR
        },
    })
    const [overrideAccentColor, setAccentColor] = useState<string | null>(null)
    const accentColor = overrideAccentColor ?? routeAccentColor
    const accentContext = useMemo(() => ({ accentColor, setAccentColor }), [accentColor])

    return { accentColor, accentContext }
}
