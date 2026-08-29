import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router'

import QueryProvider from '../integrations/TanstackQuery'
import type { RootDocumentProps } from '../shared/Types/root-document.types'
import stylesUrl from '../styles.css?url'

export const Route = createRootRoute({
    head: () => ({
        meta: [
            { charSet: 'utf-8' },
            {
                name: 'viewport',
                content: 'width=device-width, initial-scale=1',
            },
            { title: 'RentnerProxy' },
            {
                name: 'description',
                content: 'Secure, self-hosted reverse proxy management.',
            },
            { name: 'referrer', content: 'no-referrer' },
        ],
        links: [{ rel: 'stylesheet', href: stylesUrl }],
    }),
    shellComponent: RootDocument,
    component: RootComponent,
})

function RootComponent() {
    return (
        <QueryProvider>
            <Outlet />
        </QueryProvider>
    )
}

function RootDocument({ children }: RootDocumentProps) {
    return (
        <html
            lang="en"
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
