import { HeadContent, Scripts } from '@tanstack/react-router'

import { useDocumentLanguage } from '../../language/useTranslationStore'
import type { RootDocumentProps } from '../Types/root-document.types'

export default function RootDocument({ children }: RootDocumentProps) {
    const language = useDocumentLanguage()

    return (
        <html
            lang={language}
            className="min-h-full min-w-80 [font-synthesis:none] [scrollbar-gutter:stable] [text-rendering:optimizeLegibility]"
        >
            <head>
                <HeadContent />
            </head>
            <body className="min-h-screen bg-navy-950 font-sans text-white antialiased selection:bg-brand-500 selection:text-navy-950">
                {children}
                <Scripts />
            </body>
        </html>
    )
}
