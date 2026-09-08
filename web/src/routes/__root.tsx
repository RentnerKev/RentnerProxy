import { createRootRoute } from '@tanstack/react-router'

import RootLayout from '../layout'
import RootDocument from '../layout/Components/RootDocument'
import { isCspNonce } from '../shared/Helpers/cspNonce'
// oxlint-disable-next-line import/no-unassigned-import -- Vite collects the stylesheet into the production asset manifest.
import '../styles.css'

function readCspNonce(context: unknown): string | undefined {
    if (typeof context !== 'object' || context === null) return undefined

    const serverContext = (context as { serverContext?: unknown }).serverContext
    if (typeof serverContext !== 'object' || serverContext === null) return undefined

    const nonce = (serverContext as { cspNonce?: unknown }).cspNonce
    return isCspNonce(nonce) ? nonce : undefined
}

export const Route = createRootRoute({
    beforeLoad: (context) => {
        const cspNonce = readCspNonce(context)
        return cspNonce ? { cspNonce } : {}
    },
    head: () => ({
        links: [{ rel: 'icon', type: 'image/png', href: '/rentnerproxy-logo.png' }],
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
    }),
    shellComponent: RootDocument,
    component: RootLayout,
})
