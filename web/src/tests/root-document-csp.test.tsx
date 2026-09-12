import { describe, expect, test } from 'bun:test'
import {
    createMemoryHistory,
    createRootRoute,
    createRouter,
    RouterProvider,
} from '@tanstack/react-router'
import { renderToString } from 'react-dom/server'
import { Window } from 'happy-dom'

import RootDocument from '../layout/Components/RootDocument'

describe('document CSP nonce', () => {
    test('exposes the response nonce to Vite before the router content-only meta', async () => {
        const nonce = 'test_response-nonce'
        const root = createRootRoute({
            beforeLoad: () => ({ cspNonce: nonce }),
            component: () => (
                <RootDocument>
                    <p>Styled page</p>
                </RootDocument>
            ),
        })
        const router = createRouter({
            routeTree: root,
            history: createMemoryHistory({ initialEntries: ['/'] }),
            ssr: { nonce },
        })
        await router.load()
        const html = renderToString(<RouterProvider router={router} />)
        const window = new Window()
        try {
            window.document.write(html)

            const meta = window.document.querySelector('meta[property="csp-nonce"]')
            expect(meta?.getAttribute('nonce')).toBe(nonce)

            expect(meta?.getAttribute('content')).toBe(nonce)
        } finally {
            await window.happyDOM.close()
        }
    })
})
