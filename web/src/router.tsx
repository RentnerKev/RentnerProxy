import { createRouter } from '@tanstack/react-router'

import { routeTree } from './routeTree.gen'
import GlobalErrorPage from './shared/SystemStatePage/GlobalErrorPage'
import NotFoundPage from './shared/SystemStatePage/NotFoundPage'

export function getRouter() {
    return createRouter({
        routeTree,
        scrollRestoration: true,
        notFoundMode: 'root',
        defaultNotFoundComponent: NotFoundPage,
        defaultErrorComponent: GlobalErrorPage,
    })
}
