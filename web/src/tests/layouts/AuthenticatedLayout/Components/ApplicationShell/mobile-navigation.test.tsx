import { afterEach, expect, mock, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Root } from 'react-dom/client'

import { PERMISSIONS } from '@/config/permissions.config.ts'
import { withLanguageRoot } from '@/tests/Helpers/withTestLanguage.tsx'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

mock.module('@/features/QuickSearch/index.tsx', () => ({
    default: () => <button type="button">Search</button>,
}))
mock.module('@/features/ApplicationVersion/middleware.ts', () => ({
    getApplicationUpdateHandler: async () => ({ latestVersion: null }),
}))

const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterContextProvider } =
    await import('@tanstack/react-router')
const { TooltipProvider } = await import('@rentnerkev/tooltips/tooltip')
const { default: ApplicationShell } =
    await import('@/layouts/AuthenticatedLayout/Components/ApplicationShell/index.tsx')

let root: Root | null = null
let client: QueryClient | null = null
const logout = mock(() => {})

async function flush() {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 15))
    })
}

async function mount() {
    const container = document.createElement('div')
    document.body.append(container)
    root = withLanguageRoot(createRoot(container))
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const routeRoot = createRootRoute()
    const router = createRouter({
        routeTree: routeRoot.addChildren(
            ['/', '/proxy-hosts', '/account'].map((path) =>
                createRoute({ getParentRoute: () => routeRoot, path }),
            ),
        ),
        history: createMemoryHistory({ initialEntries: ['/'] }),
    })
    await router.load()
    await act(async () => {
        root!.render(
            <QueryClientProvider client={client!}>
                <RouterContextProvider router={router}>
                    <TooltipProvider>
                        <ApplicationShell
                            user={{
                                id: 'test-user',
                                displayName: 'Owner',
                                email: 'owner@example.test',
                                permissions: Object.values(PERMISSIONS),
                                profileImageVersion: null,
                            }}
                            themeMode="light"
                            themeControl={<button type="button">Theme</button>}
                            isLoggingOut={false}
                            onLogout={logout}
                        >
                            <button type="button" id="background-action">
                                Download support report
                            </button>
                        </ApplicationShell>
                    </TooltipProvider>
                </RouterContextProvider>
            </QueryClientProvider>,
        )
    })
    await flush()
    const toggle = container.querySelector<HTMLButtonElement>(
        'button[aria-controls="application-mobile-navigation"]',
    )!
    await act(async () => {
        toggle.focus()
        toggle.click()
    })
    await flush()
    return {
        toggle,
        container,
        router,
        dialog: document.querySelector<HTMLElement>('#application-mobile-navigation')!,
    }
}

afterEach(async () => {
    await act(async () => root?.unmount())
    root = null
    client?.clear()
    client = null
    document.body.replaceChildren()
    logout.mockClear()
})

test('mobile navigation is a named modal, hides the background and restores toggle focus on Escape', async () => {
    const { toggle, dialog } = await mount()
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(toggle.getAttribute('aria-haspopup')).toBe('dialog')
    expect(dialog.getAttribute('role')).toBe('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent).toBe(
        'Application navigation',
    )
    expect(
        document.getElementById('background-action')?.closest('[aria-hidden="true"]'),
    ).not.toBeNull()
    expect(dialog.contains(document.activeElement)).toBeTrue()
    await act(async () => {
        document.activeElement?.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
        )
    })
    await flush()
    expect(document.querySelector('#application-mobile-navigation')).toBeNull()
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(toggle)
    expect(document.getElementById('background-action')?.closest('[aria-hidden="true"]')).toBeNull()
    expect(logout).not.toHaveBeenCalled()
})

test('Tab and Shift+Tab stay inside the mobile navigation, and background focus is recovered', async () => {
    const { dialog } = await mount()
    const close = dialog.querySelector<HTMLButtonElement>(
        'button[aria-label="Collapse navigation"]',
    )!
    const signout = [...dialog.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
        button.textContent?.includes('Logout'),
    )!
    await act(async () => {
        signout.focus()
        signout.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
        )
    })
    expect(document.activeElement).toBe(close)
    await act(async () => {
        close.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'Tab',
                shiftKey: true,
                bubbles: true,
                cancelable: true,
            }),
        )
    })
    expect(document.activeElement).toBe(signout)
    await act(async () => document.getElementById('background-action')!.focus())
    expect(dialog.contains(document.activeElement)).toBeTrue()
    expect(logout).not.toHaveBeenCalled()
})

test('choosing a mobile navigation link closes the dialog without changing desktop expansion', async () => {
    const { dialog, toggle, container, router } = await mount()
    const desktopToggle = container.querySelector('button[aria-controls="application-navigation"]')!
    expect(desktopToggle.getAttribute('aria-expanded')).toBe('true')
    await act(async () => {
        dialog.querySelector<HTMLAnchorElement>('a[href="/proxy-hosts"]')!.click()
    })
    await flush()
    expect(router.state.location.pathname).toBe('/proxy-hosts')
    expect(document.querySelector('#application-mobile-navigation')).toBeNull()
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(desktopToggle.getAttribute('aria-expanded')).toBe('true')
})
