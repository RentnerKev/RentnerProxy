import { describe, expect, mock, test } from 'bun:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
    createMemoryHistory,
    createRootRoute,
    createRouter,
    RouterProvider,
} from '@tanstack/react-router'
import { Window } from 'happy-dom'
import { renderToString } from 'react-dom/server'

import { AccentContext } from '@/shared/Theme/accentContext.ts'
import withTestLanguage from '@/tests/Helpers/withTestLanguage.tsx'

mock.module('@/features/UserSettings/middleware.ts', () => ({
    updateCurrentUserAccentColorHandler: async () => ({
        success: true,
        userId: '6f355778-511f-467b-ad8f-8c4a29b84510',
        accentColor: '#30ee61',
    }),
}))
const { default: UserAppearancePanel } =
    await import('@/features/UserSettings/Components/UserAppearancePanel/index.tsx')

const TEST_ACCENT_CONTEXTS = {
    '#3366cc': { accentColor: '#3366cc' },
    '#30ee61': { accentColor: '#30ee61' },
} as const

async function renderPanel(accentColor: keyof typeof TEST_ACCENT_CONTEXTS): Promise<Window> {
    const queryClient = new QueryClient()
    const root = createRootRoute({
        component: () => (
            <QueryClientProvider client={queryClient}>
                <AccentContext.Provider value={TEST_ACCENT_CONTEXTS[accentColor]}>
                    <UserAppearancePanel userId="6f355778-511f-467b-ad8f-8c4a29b84510" />
                </AccentContext.Provider>
            </QueryClientProvider>
        ),
    })
    const router = createRouter({
        routeTree: root,
        history: createMemoryHistory({ initialEntries: ['/'] }),
    })
    await router.load()
    const html = renderToString(withTestLanguage(<RouterProvider router={router} />))
    const window = new Window()
    window.document.write(html)
    return window
}

describe('user appearance settings UI', () => {
    test('shows editing controls for a personal accent without an administrator restriction', async () => {
        const window = await renderPanel('#3366cc')
        try {
            const panel = window.document.querySelector(
                '[aria-labelledby="user-appearance-heading"]',
            )
            expect(panel?.textContent).toContain('#3366cc')
            expect(panel?.textContent).not.toContain('Only administrators')
            expect(panel?.querySelector('form')).not.toBeNull()
        } finally {
            await window.happyDOM.close()
        }
    })

    test('renders the package picker, light/dark previews, and reset for the current user', async () => {
        const window = await renderPanel('#30ee61')
        try {
            const panel = window.document.querySelector('section')
            expect(panel?.getAttribute('style')).toContain('#30ee61')
            expect(panel?.querySelector('[data-theme="light"]')).not.toBeNull()
            expect(panel?.querySelector('[data-theme="dark"]')).not.toBeNull()
            expect(panel?.querySelector('input')).not.toBeNull()
            expect(panel?.querySelector('input[placeholder]')?.className).toContain('text-ink')
            expect(panel?.querySelector('button[type="submit"]')).not.toBeNull()
            expect(panel?.textContent).toContain('Reset to default')
        } finally {
            await window.happyDOM.close()
        }
    })
})
