import useRootDocumentLogic from './Hooks/useRootDocumentLogic.ts'
import { HeadContent, Scripts } from '@tanstack/react-router'

import { AccentContext } from '@/shared/Theme/accentContext.ts'
import type { RootDocumentProps } from './Types/root-document.types.ts'

export default function RootDocument({ children }: RootDocumentProps) {
    const { state, accentContext } = useRootDocumentLogic()

    return (
        <AccentContext.Provider value={accentContext}>
            <html
                lang={state.language}
                className="group min-h-full min-w-80 [font-synthesis:none] [scrollbar-gutter:stable] [text-rendering:optimizeLegibility]"
                data-accent-custom={state.hasCustomAccent}
                style={state.accentStyles}
            >
                <head>
                    {}
                    {state.nonce ? (
                        <meta property="csp-nonce" content={state.nonce} nonce={state.nonce} />
                    ) : null}
                    <HeadContent />
                </head>
                <body className="min-h-screen bg-navy-950 font-sans text-white antialiased selection:bg-accent selection:text-accent-foreground">
                    {children}
                    <Scripts />
                </body>
            </html>
        </AccentContext.Provider>
    )
}
