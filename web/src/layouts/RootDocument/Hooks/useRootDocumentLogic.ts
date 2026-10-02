import { useRouterState } from '@tanstack/react-router'
import type { CSSProperties } from 'react'

import { DEFAULT_ACCENT_COLOR } from '@/config/appearance.config.ts'
import { getClientCspNonce, isCspNonce, setClientCspNonce } from '@/lib/Security/cspNonce.ts'
import { accentCssVariables } from '@/lib/Theme/accentPalette.ts'
import { useDocumentLanguage } from '@/shared/Language/Hooks/useTranslationStore.ts'
import { useDocumentAccent } from '@/shared/Theme/Hooks/useDocumentAccent.ts'
import type { RootDocumentLogicResult } from '../Types/root-document-logic.types.ts'

export default function useRootDocumentLogic(): RootDocumentLogicResult {
    const language = useDocumentLanguage()
    const routeNonce = useRouterState({
        select: (state) => {
            const rootMatch = state.matches.find((match) => match.routeId === '__root__')
            const nonce = (rootMatch?.context as { cspNonce?: unknown } | undefined)?.cspNonce
            return isCspNonce(nonce) ? nonce : undefined
        },
    })
    const { accentColor, accentContext } = useDocumentAccent()
    const nonce = getClientCspNonce() ?? routeNonce
    setClientCspNonce(nonce)

    return {
        state: {
            language,
            nonce,
            hasCustomAccent: accentColor.toLowerCase() !== DEFAULT_ACCENT_COLOR,
            accentStyles: accentCssVariables(accentColor) as CSSProperties,
        },
        accentContext,
    }
}
