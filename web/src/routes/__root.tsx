import { createRootRoute } from '@tanstack/react-router'

import RootLayout from '../layout'
import RootDocument from '../layout/Components/RootDocument'
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
    component: RootLayout,
})
