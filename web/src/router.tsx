import { createRouter } from '@tanstack/react-router'
import { GlobalErrorPage, NotFoundPage } from './components/system-state-page'
import { routeTree } from './routeTree.gen'

export function getRouter() {
  return createRouter({
    routeTree,
    scrollRestoration: true,
    notFoundMode: 'root',
    defaultNotFoundComponent: NotFoundPage,
    defaultErrorComponent: GlobalErrorPage,
  })
}
