import { expect, test } from 'bun:test'
import {
    createMemoryHistory,
    createRootRoute,
    createRouter,
    RouterProvider,
} from '@tanstack/react-router'
import { renderToString } from 'react-dom/server'
import { Window } from 'happy-dom'

import RootDocument from '@/layouts/RootDocument/index.tsx'

test('initial server HTML contains the saved accent before hydration', async () => {
    const root = createRootRoute({
        beforeLoad: () => ({ accentColor: '#3366cc' }),
        component: () => (
            <RootDocument>
                <p>Styled page</p>
            </RootDocument>
        ),
    })
    const router = createRouter({
        routeTree: root,
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
