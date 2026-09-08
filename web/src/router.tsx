import { createRouter } from '@tanstack/react-router'

import { routeTree } from './routeTree.gen'
import GlobalErrorPage from './layout/Components/SystemStatePage/GlobalErrorPage'
import NotFoundPage from './layout/Components/SystemStatePage/NotFoundPage'
import { isCspNonce } from './shared/Helpers/cspNonce'

export function getRouter() {
    const router = createRouter({
        routeTree,
        scrollRestoration: true,
        notFoundMode: 'root',
        defaultNotFoundComponent: NotFoundPage,
        defaultErrorComponent: GlobalErrorPage,
    })
    router.subscribe('onBeforeLoad', () => {
        const serverContext = router.options.additionalContext?.serverContext as
            | { cspNonce?: unknown }
            | undefined
        const nonce = serverContext?.cspNonce
        if (isCspNonce(nonce)) {
            router.update({ ssr: { ...router.options.ssr, nonce } })
        }
    })
    return router
}
