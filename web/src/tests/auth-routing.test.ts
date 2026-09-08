import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import {
    createMemoryHistory,
    createRootRoute,
    createRoute,
    createRouter,
    RouterProvider,
} from '@tanstack/react-router'

import { getRouter } from '../router'
import { Route as LoginRoute } from '../routes/_public/login'

for (const [path, visiblePage, hiddenPage] of [
    ['/login', 'Password form', 'Second factor form'],
    ['/login/two-factor', 'Second factor form', 'Password form'],
] as const) {
    test(`renders the selected child form at ${path}`, async () => {
        const rootRoute = createRootRoute()
        const loginComponent = LoginRoute.options.component
        if (!loginComponent) throw new Error('Login route has no rendering component.')
        const loginRoute = createRoute({
            getParentRoute: () => rootRoute,
            path: '/login',
            component: loginComponent,
        })
        const passwordRoute = createRoute({
            getParentRoute: () => loginRoute,
            path: '/',
            component: () => createElement('form', { 'aria-label': 'Password form' }),
        })
        const twoFactorRoute = createRoute({
            getParentRoute: () => loginRoute,
            path: '/two-factor',
            component: () => createElement('form', { 'aria-label': 'Second factor form' }),
        })
        const router = createRouter({
            history: createMemoryHistory({ initialEntries: [path] }),
            routeTree: rootRoute.addChildren([
                loginRoute.addChildren([passwordRoute, twoFactorRoute]),
            ]),
        })

        await router.load()
        const html = renderToString(createElement(RouterProvider, { router }))

        expect(html).toContain(`aria-label="${visiblePage}"`)
        expect(html).not.toContain(`aria-label="${hiddenPage}"`)
    })
}

test('matches the password and two-factor URLs to their distinct child routes', () => {
    const router = getRouter()

    expect(router.matchRoutes('/login').map(({ routeId }) => routeId)).toEqual([
        '__root__',
        '/_public',
        '/_public/login',
        '/_public/login/',
    ])
    expect(router.matchRoutes('/login/two-factor').map(({ routeId }) => routeId)).toEqual([
        '__root__',
        '/_public',
        '/_public/login',
        '/_public/login/two-factor',
    ])
})
