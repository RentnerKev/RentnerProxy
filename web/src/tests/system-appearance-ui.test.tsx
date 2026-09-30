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

import { SystemAccentContext } from '../theme/systemAccentContext'
import withTestLanguage from './Helpers/withTestLanguage'

mock.module('../features/SystemAppearance/server.ts', () => ({
    updateSystemAccentColorHandler: async () => ({ success: true, accentColor: '#30ee61' }),
}))
const { default: SystemAppearancePanel } =
    await import('../features/UserSettings/Components/SystemAppearancePanel')

const TEST_ACCENT_CONTEXTS = {
    '#3366cc': { accentColor: '#3366cc', setAccentColor: () => undefined },
    '#30ee61': { accentColor: '#30ee61', setAccentColor: () => undefined },
} as const

async function renderPanel(
    accentColor: keyof typeof TEST_ACCENT_CONTEXTS,
    canUpdate: boolean,
): Promise<Window> {
    const queryClient = new QueryClient()
    const root = createRootRoute({
        component: () => (
            <QueryClientProvider client={queryClient}>
                <SystemAccentContext.Provider value={TEST_ACCENT_CONTEXTS[accentColor]}>
                    <SystemAppearancePanel canUpdate={canUpdate} />
                </SystemAccentContext.Provider>
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

describe('system appearance settings UI', () => {
    test('shows the current accent without editing controls to viewers', async () => {
        const window = await renderPanel('#3366cc', false)
        try {
            const panel = window.document.querySelector(
                '[aria-labelledby="system-appearance-heading"]',
            )
            expect(panel?.textContent).toContain('#3366cc')
            expect(panel?.textContent).toContain('Only administrators')
            expect(panel?.querySelector('form')).toBeNull()
        } finally {
            await window.happyDOM.close()
        }
    })

    test('renders the package picker, light/dark previews, and reset for admins', async () => {
        const window = await renderPanel('#30ee61', true)
        try {
            const panel = window.document.querySelector('section')
            expect(panel?.getAttribute('style')).toContain('#30ee61')
            expect(panel?.querySelector('[data-theme="light"]')).not.toBeNull()
            expect(panel?.querySelector('[data-theme="dark"]')).not.toBeNull()
            expect(panel?.querySelector('input')).not.toBeNull()
            expect(panel?.querySelector('button[type="submit"]')).not.toBeNull()
            expect(panel?.textContent).toContain('Reset to default')
        } finally {
            await window.happyDOM.close()
        }
    })
})
