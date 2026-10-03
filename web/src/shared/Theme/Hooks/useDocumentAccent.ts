import { useRouterState } from '@tanstack/react-router'
import { useMemo } from 'react'

import { DEFAULT_ACCENT_COLOR } from '@/config/appearance.config.ts'
import type { AuthenticatedUser } from '@/lib/Auth/Types/auth.types.ts'

export function useDocumentAccent() {
    const accentColor = useRouterState({
        select: (state) => {
            const authenticatedMatch = state.matches.find(
                (match) => match.routeId === '/_authenticated',
            )
            const user = (authenticatedMatch?.context as { user?: AuthenticatedUser } | undefined)
                ?.user
            return user?.accentColor ?? DEFAULT_ACCENT_COLOR
        },
    })
    const accentContext = useMemo(() => ({ accentColor }), [accentColor])

    return { accentColor, accentContext }
}
