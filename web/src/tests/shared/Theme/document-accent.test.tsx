import { afterAll, describe, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

import { DEFAULT_ACCENT_COLOR } from '@/config/appearance.config.ts'
import { useDocumentAccent } from '@/shared/Theme/Hooks/useDocumentAccent.ts'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { renderToString } = await import('react-dom/server')
const {
    createMemoryHistory,
    createRootRoute,
    createRoute,
    createRouter,
    redirect,
    RouterProvider,
} = await import('@tanstack/react-router')

interface Fixture {
    user: { id: string; accentColor?: string } | null
}

function AccentProbe() {
    const { accentColor } = useDocumentAccent()
    return <output data-accent={accentColor}>{accentColor}</output>
}

function createAccentRouter(path: string, fixture: Fixture) {
    const root = createRootRoute({
        beforeLoad: () => ({ accentColor: '#ff0000' }),
        component: AccentProbe,
    })
    const authenticated = createRoute({
        getParentRoute: () => root,
        id: '_authenticated',
        beforeLoad: () => {
            if (!fixture.user) throw redirect({ to: '/login' })
            return { user: fixture.user }
        },
    })
    const account = createRoute({ getParentRoute: () => authenticated, path: '/account' })
    const login = createRoute({ getParentRoute: () => root, path: '/login' })
    return createRouter({
        routeTree: root.addChildren([authenticated.addChildren([account]), login]),
        history: createMemoryHistory({ initialEntries: [path] }),
    })
}

afterAll(async () => {
    await GlobalRegistrator.unregister()
})

describe('document accent ownership', () => {
    test('renders public login in default green even with a legacy root accent or a signed-in fixture', async () => {
        const router = createAccentRouter('/login', {
            user: { id: 'first', accentColor: '#abcdef' },
        })
        await router.load()
        expect(renderToString(<RouterProvider router={router} />)).toContain(
            `data-accent="${DEFAULT_ACCENT_COLOR}"`,
        )
    })

    test('renders the authenticated personal accent and defaults accounts without a preference', async () => {
        await Promise.all(
            (
                [
                    [{ id: 'first', accentColor: '#abcdef' }, '#abcdef'],
                    [{ id: 'second', accentColor: '#123456' }, '#123456'],
                    [{ id: 'new' }, DEFAULT_ACCENT_COLOR],
                ] as const
            ).map(async ([user, expected]) => {
                const router = createAccentRouter('/account', { user })
                await router.load()
                expect(renderToString(<RouterProvider router={router} />)).toContain(
                    `data-accent="${expected}"`,
                )
            }),
        )
    })

    test('refreshes saved accents, clears them on logout, and switches accounts in the same document', async () => {
        const fixture: Fixture = { user: { id: 'first', accentColor: '#abcdef' } }
        const router = createAccentRouter('/account', fixture)
        await router.load()
        const container = document.createElement('div')
        document.body.append(container)
        const root = createRoot(container)
        try {
            await act(async () => root.render(<RouterProvider router={router} />))
            const accent = () => container.querySelector('output')?.getAttribute('data-accent')
            expect(accent()).toBe('#abcdef')

            fixture.user = { id: 'first', accentColor: '#3366cc' }
            await act(async () => {
                await router.invalidate()
            })
            expect(accent()).toBe('#3366cc')

            fixture.user = null
            await act(async () => {
                await router.invalidate()
            })
            expect(router.state.location.pathname).toBe('/login')
            expect(accent()).toBe(DEFAULT_ACCENT_COLOR)

            fixture.user = { id: 'second', accentColor: '#123456' }
            await act(async () => {
                await router.navigate({ to: '/account', search: { section: 'profile' } })
            })
            expect(accent()).toBe('#123456')

            fixture.user = { id: 'first', accentColor: '#3366cc' }
            await act(async () => {
                await router.invalidate()
            })
            expect(accent()).toBe('#3366cc')
        } finally {
            await act(async () => root.unmount())
            container.remove()
        }
    })
})
