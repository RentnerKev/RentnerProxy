import { createRouter } from '@tanstack/react-router'

import { routeTree } from '@/routeTree.gen.ts'
import GlobalErrorPage from '@/shared/SystemStatePage/GlobalErrorPage.tsx'
import NotFoundPage from '@/shared/SystemStatePage/NotFoundPage.tsx'
import LoadingPage from '@/shared/SystemStatePage/LoadingPage.tsx'
import { isCspNonce } from '@/lib/Security/cspNonce.ts'

export function getRouter() {
    const router = createRouter({
        routeTree,
        scrollRestoration: true,
        notFoundMode: 'root',
        defaultNotFoundComponent: NotFoundPage,
        defaultErrorComponent: GlobalErrorPage,
        defaultPendingComponent: LoadingPage,
    })
    router.subscribe('onBeforeLoad', () => {
        const serverContext = router.options.additionalContext?.serverContext as
            { cspNonce?: unknown } | undefined
        const nonce = serverContext?.cspNonce
        if (isCspNonce(nonce)) {
            router.update({ ssr: { ...router.options.ssr, nonce } })
        }
    })
    return router
}
