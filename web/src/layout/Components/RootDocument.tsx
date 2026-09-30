import { HeadContent, Scripts, useRouterState } from '@tanstack/react-router'
import { useMemo, useState, type CSSProperties } from 'react'

import { DEFAULT_ACCENT_COLOR } from '../../config/appearance.config'
import { useDocumentLanguage } from '../../language/useTranslationStore'
import { getClientCspNonce, isCspNonce, setClientCspNonce } from '../../shared/Helpers/cspNonce'
import { accentCssVariables } from '../../theme/accentPalette'
import { SystemAccentContext } from '../../theme/systemAccentContext'
import type { RootDocumentProps } from '../Types/root-document.types'

export default function RootDocument({ children }: RootDocumentProps) {
    const language = useDocumentLanguage()
    const routeNonce = useRouterState({
        select: (state) => {
            const rootMatch = state.matches.find((match) => match.routeId === '__root__')
            const nonce = (rootMatch?.context as { cspNonce?: unknown } | undefined)?.cspNonce
            return isCspNonce(nonce) ? nonce : undefined
        },
    })
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

    const nonce = getClientCspNonce() ?? routeNonce
    setClientCspNonce(nonce)

    return (
        <SystemAccentContext.Provider value={accentContext}>
            <html
                lang={language}
                className="min-h-full min-w-80 [font-synthesis:none] [scrollbar-gutter:stable] [text-rendering:optimizeLegibility]"
                style={accentCssVariables(accentColor) as CSSProperties}
            >
                <head>
                    {}
                    {nonce ? <meta property="csp-nonce" content={nonce} nonce={nonce} /> : null}
                    <HeadContent />
                </head>
                <body className="min-h-screen bg-navy-950 font-sans text-white antialiased selection:bg-accent selection:text-accent-foreground">
                    {children}
                    <Scripts />
                </body>
            </html>
        </SystemAccentContext.Provider>
    )
}
