import { expect, test } from 'bun:test'
import {
    createMemoryHistory,
    createRootRoute,
    createRoute,
    createRouter,
    RouterProvider,
} from '@tanstack/react-router'
import { renderToString } from 'react-dom/server'
import { Window } from 'happy-dom'

import RootDocument from '@/layouts/RootDocument/index.tsx'

test('initial authenticated server HTML contains the personal accent before hydration', async () => {
    const root = createRootRoute({
        component: () => (
            <RootDocument>
                <p>Styled page</p>
            </RootDocument>
        ),
    })
    const authenticated = createRoute({
        getParentRoute: () => root,
        id: '_authenticated',
        beforeLoad: () => ({ user: { accentColor: '#3366cc' } }),
    })
    const index = createRoute({ getParentRoute: () => authenticated, path: '/' })
    const router = createRouter({
        routeTree: root.addChildren([authenticated.addChildren([index])]),
        history: createMemoryHistory({ initialEntries: ['/'] }),
    })
    await router.load()
    const html = renderToString(<RouterProvider router={router} />)
    const window = new Window()
    try {
        window.document.write(html)
        const rootElement = window.document.documentElement
        expect(rootElement.style.getPropertyValue('--accent')).toBe('#3366cc')
        expect(rootElement.style.getPropertyValue('--accent-500')).toBe('#3366cc')
        expect(rootElement.style.getPropertyValue('--accent-rgb')).toBe('51 102 204')
        expect(rootElement.style.getPropertyValue('--accent-foreground')).toBe('#ffffff')
        expect(rootElement.getAttribute('data-accent-custom')).toBe('true')
    } finally {
        await window.happyDOM.close()
    }
})

test('public server HTML ignores the legacy system accent and starts in green', async () => {
    const root = createRootRoute({
        beforeLoad: () => ({ accentColor: '#3366cc' }),
        component: () => (
            <RootDocument>
                <p>Login page</p>
            </RootDocument>
        ),
    })
    const router = createRouter({
        routeTree: root,
        history: createMemoryHistory({ initialEntries: ['/'] }),
    })
    await router.load()
    const window = new Window()
    try {
        window.document.write(renderToString(<RouterProvider router={router} />))
        const rootElement = window.document.documentElement
        expect(rootElement.style.getPropertyValue('--accent')).toBe('#30ee61')
        expect(rootElement.getAttribute('data-accent-custom')).toBe('false')
    } finally {
        await window.happyDOM.close()
    }
})
