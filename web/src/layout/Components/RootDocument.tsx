import { HeadContent, Scripts, useRouterState } from '@tanstack/react-router'

import { useDocumentLanguage } from '../../language/useTranslationStore'
import { getClientCspNonce, isCspNonce, setClientCspNonce } from '../../shared/Helpers/cspNonce'
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
    // Client navigation must retain the nonce from the current document's CSP.
    const nonce = getClientCspNonce() ?? routeNonce
    setClientCspNonce(nonce)

    return (
        <html
            lang={language}
            className="min-h-full min-w-80 [font-synthesis:none] [scrollbar-gutter:stable] [text-rendering:optimizeLegibility]"
        >
            <head>
                {/* Vite reads .nonce; the router's own meta only provides .content. */}
                {nonce ? <meta property="csp-nonce" content={nonce} nonce={nonce} /> : null}
                <HeadContent />
            </head>
            <body className="min-h-screen bg-navy-950 font-sans text-white antialiased selection:bg-brand-500 selection:text-navy-950">
                {children}
                <Scripts />
            </body>
        </html>
    )
}
