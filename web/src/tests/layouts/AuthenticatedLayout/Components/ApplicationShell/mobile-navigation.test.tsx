import { afterEach, expect, mock, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Root } from 'react-dom/client'

import { PERMISSIONS } from '@/config/permissions.config.ts'
import { withLanguageRoot } from '@/tests/Helpers/withTestLanguage.tsx'
import type { ApplicationUpdateResult } from '@/features/ApplicationVersion/Types/application-update.types.ts'

let updateResult: ApplicationUpdateResult = {
    status: 'current',
    checkedAt: null,
    currentChannel: 'beta',
    latest: null,
}

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

mock.module('@/features/QuickSearch/index.tsx', () => ({
    default: () => <button type="button">Search</button>,
}))
mock.module('@/features/ApplicationVersion/middleware.ts', () => ({
    getApplicationUpdateHandler: async () => updateResult,
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

function setRendered(toggle: HTMLButtonElement, visible: boolean) {
    // Happy DOM does not lay out CSS; model the browser's rendered boxes at each breakpoint.
    toggle.getClientRects = () =>
        (visible ? [new DOMRect(0, 0, 44, 44)] : []) as unknown as DOMRectList
}

async function mount(desktopExpanded = true) {
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
    const desktopToggle = container.querySelector<HTMLButtonElement>(
        'button[aria-controls="application-navigation"]',
    )!
    setRendered(toggle, true)
    setRendered(desktopToggle, false)
    await act(async () => {
        if (!desktopExpanded) desktopToggle.click()
        toggle.focus()
        toggle.click()
    })
    await flush()
    return {
        toggle,
        desktopToggle,
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
    updateResult = { status: 'current', checkedAt: null, currentChannel: 'beta', latest: null }
})

for (const desktopExpanded of [true, false]) {
    for (const closeMethod of ['Escape', 'Close'] as const) {
        test(`${closeMethod} restores the visible desktop toggle after resizing with navigation ${desktopExpanded ? 'expanded' : 'collapsed'}`, async () => {
            const { toggle, desktopToggle, dialog } = await mount(desktopExpanded)
            expect(dialog.contains(document.activeElement)).toBeTrue()
            await act(async () => {
                setRendered(toggle, false)
                setRendered(desktopToggle, true)
                window.dispatchEvent(new Event('resize'))
                if (closeMethod === 'Escape') {
                    document.activeElement?.dispatchEvent(
                        new KeyboardEvent('keydown', {
                            key: 'Escape',
                            bubbles: true,
                            cancelable: true,
                        }),
                    )
                } else {
                    dialog
                        .querySelector<HTMLButtonElement>(
                            'button[aria-label="Collapse navigation"]',
                        )!
                        .click()
                }
            })
            await flush()
            expect(document.querySelector('#application-mobile-navigation')).toBeNull()
            expect(toggle.getClientRects()).toHaveLength(0)
            expect(desktopToggle.getClientRects()).toHaveLength(1)
            expect(document.activeElement).toBe(desktopToggle)
            expect(toggle.getAttribute('aria-expanded')).toBe('false')
            expect(desktopToggle.getAttribute('aria-expanded')).toBe(String(desktopExpanded))
            expect(
                document.getElementById('background-action')?.closest('[aria-hidden="true"]'),
            ).toBeNull()
            expect(logout).not.toHaveBeenCalled()
        })
    }
}

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

for (const checkFailed of [false, true])
    test(`mobile ${checkFailed ? 'failed check' : 'update'} closes navigation before opening one update dialog and returns focus to its toggle`, async () => {
        updateResult = {
            status: 'available',
            checkedAt: null,
            currentChannel: 'beta',
            latest: {
                version: '1.0.0-beta.2',
                tag: 'v1.0.0-beta.2',
                channel: 'beta',
                url: 'https://github.com/RentnerKev/RentnerProxy/releases/tag/v1.0.0-beta.2',
                notes: null,
                image: {
                    status: 'pending',
                    reference: null,
                    digest: null,
                    platform: 'linux/amd64',
                },
                compatibility: {
                    status: 'unsupported',
                    minimumVersion: null,
                    intermediateVersion: null,
                },
            },
        }
        if (checkFailed)
            updateResult = {
                status: 'unavailable',
                checkedAt: null,
                currentChannel: null,
                latest: null,
            }
        const { dialog, toggle } = await mount()
        const update = dialog.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!
        expect(update).not.toBeNull()
        expect(update.classList.contains('size-11')).toBeTrue()
        await act(async () => {
            update.focus()
            update.click()
        })
        await flush()
        expect(document.querySelector('#application-mobile-navigation')).toBeNull()
        expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
        const updateDialog = document.querySelector<HTMLElement>('[role="dialog"]')!
        expect(updateDialog.textContent).toContain('Update RentnerProxy')
        if (checkFailed) {
            expect(updateDialog.textContent).toContain('Update information is unavailable')
            expect(updateDialog.querySelector('textarea')).toBeNull()
        }
        expect(updateDialog.contains(document.activeElement)).toBeTrue()
        await act(async () => {
            document.activeElement?.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
            )
        })
        await flush()
        expect(document.querySelector('[role="dialog"]')).toBeNull()
        expect(document.activeElement).toBe(toggle)
    })
