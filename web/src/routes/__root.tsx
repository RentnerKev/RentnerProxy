import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router'

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
        ],
        links: [{ rel: 'stylesheet', href: stylesUrl }],
    }),
    shellComponent: RootDocument,
    component: RootComponent,
})

function RootComponent() {
    return <Outlet />
}

function RootDocument({ children }: RootDocumentProps) {
    return (
        <html lang="en">
            <head>
                <HeadContent />
            </head>
            <body>
                {children}
                <Scripts />
            </body>
        </html>
    )
}
