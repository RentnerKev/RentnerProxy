import { createRouter } from '@tanstack/react-router'

import { routeTree } from './routeTree.gen'
import GlobalErrorPage from './layout/Components/SystemStatePage/GlobalErrorPage'
import NotFoundPage from './layout/Components/SystemStatePage/NotFoundPage'

export function getRouter() {
    return createRouter({
        routeTree,
        scrollRestoration: true,
        notFoundMode: 'root',
        defaultNotFoundComponent: NotFoundPage,
        defaultErrorComponent: GlobalErrorPage,
    })
}
