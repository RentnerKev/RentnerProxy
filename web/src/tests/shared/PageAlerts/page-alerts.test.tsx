import { afterEach, describe, expect, mock, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { ReactElement } from 'react'
import type { Root } from 'react-dom/client'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const { act, StrictMode } = await import('react')
const { createRoot } = await import('react-dom/client')
const { default: withTestLanguage } = await import('@/tests/Helpers/withTestLanguage.tsx')
const { default: withTestPageAlerts, openPageAlerts } =
    await import('@/tests/Helpers/withTestPageAlerts.tsx')
const { default: PageAlert } = await import('@/shared/PageAlerts/PageAlert.tsx')
const { default: RuntimeStatusPanel } = await import('@/shared/RuntimeStatus/index.tsx')
const { default: PageAlertsProvider } = await import('@/shared/PageAlerts/PageAlertsProvider.tsx')
const { default: ApplicationTopbar } =
    await import('@/layouts/AuthenticatedLayout/Components/ApplicationShell/Components/ApplicationTopbar.tsx')
const { TooltipProvider } = await import('@rentnerkev/tooltips/tooltip')

let root: Root | null = null
let container: HTMLElement

async function render(element: ReactElement) {
    if (!root) {
        container = document.createElement('div')
        document.body.append(container)
        root = createRoot(container)
    }
    await act(async () => root?.render(withTestLanguage(withTestPageAlerts(element))))
    return container
}

function triangle() {
    return document.querySelector<HTMLButtonElement>('button[data-severity]')
}

afterEach(async () => {
    await act(async () => root?.unmount())
    root = null
    document.body.replaceChildren()
})

describe('navbar page alerts', () => {
    test('hides healthy/loading state and keeps page content free of alert banners', async () => {
        await render(<main>Page content</main>)
        expect(triangle()).toBeNull()
        await render(
            <main>
                <PageAlert
                    severity="warning"
                    title="Pending changes"
                    description="Saved changes are queued."
                />
                Page content
            </main>,
        )
        expect(triangle()?.dataset.severity).toBe('warning')
        expect(triangle()?.getAttribute('aria-label')).toBe('1 warning on this page')
        expect(container.querySelector('main')?.textContent).toBe('Page content')
        expect(document.body.textContent).not.toContain('Saved changes are queued.')
    })

    test('combines messages, prioritizes errors, and downgrades when an error recovers', async () => {
        const warning = (
            <PageAlert
                key="warning"
                severity="warning"
                title="Pending"
                description="Apply saved changes."
            />
        )
        await render(
            <>
                {warning}
                <PageAlert
                    severity="error"
                    title="Runtime offline"
                    description="Try again later."
                />
            </>,
        )
        expect(document.querySelectorAll('button[data-severity]')).toHaveLength(1)
        expect(triangle()?.dataset.severity).toBe('error')
        expect(triangle()?.getAttribute('aria-label')).toBe(
            '2 alerts on this page, including errors',
        )
        const details = await openPageAlerts()
        expect(details.textContent).toContain('Runtime offline')
        expect(details.textContent).toContain('Apply saved changes.')
        expect(details.querySelector('li')?.textContent).toContain('Runtime offline')
        await render(<>{warning}</>)
        expect(triangle()?.dataset.severity).toBe('warning')
        await render(<main>Next page</main>)
        expect(triangle()).toBeNull()
        expect(document.querySelector('[role="dialog"]')).toBeNull()
        await act(async () => {
            triangle()?.dispatchEvent(
                new PointerEvent('pointerout', {
                    bubbles: true,
                    pointerType: 'mouse',
                    relatedTarget: document.body,
                }),
            )
            await new Promise((resolve) => setTimeout(resolve, 100))
        })
    })

    test('does not reopen recovered or previous-page details for a new alert', async () => {
        await render(
            <PageAlert key="first" severity="error" title="First page" description="Unavailable" />,
        )
        await openPageAlerts()
        await render(<main>No alerts</main>)
        await render(
            <PageAlert key="second" severity="warning" title="Second page" description="Pending" />,
        )
        expect(triangle()?.getAttribute('aria-expanded')).toBe('false')
        expect(document.body.textContent).not.toContain('First page')
    })

    test('explains warnings on pointer hover without opening the action dialog', async () => {
        await render(
            <PageAlert
                severity="warning"
                title="Pending changes"
                description="Saved changes are waiting for application."
            />,
        )
        await act(async () => {
            triangle()?.dispatchEvent(
                new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse' }),
            )
            await new Promise((resolve) => setTimeout(resolve, 100))
        })
        expect(document.querySelector('[role="tooltip"]')?.textContent).toContain(
            'Saved changes are waiting for application.',
        )
        expect(document.querySelector('[role="dialog"]')).toBeNull()
    })

    test('shows details on keyboard focus and keeps interactive actions in the click panel', async () => {
        const retry = mock(() => undefined)
        await render(
            <PageAlert
                severity="error"
                title="Offline"
                description="The controller cannot be reached."
                action={
                    <button type="button" onClick={retry}>
                        Retry connection
                    </button>
                }
            />,
        )
        await act(async () => {
            triangle()?.focus()
            await new Promise((resolve) => setTimeout(resolve, 100))
        })
        const tooltip = document.querySelector('[role="tooltip"]')
        expect(tooltip?.textContent).toContain('The controller cannot be reached.')
        expect(tooltip?.querySelector('button')).toBeNull()
        const details = await openPageAlerts()
        await act(async () => details.querySelector<HTMLButtonElement>('li button')?.click())
        expect(retry).toHaveBeenCalledTimes(1)
        await act(async () =>
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
        )
        expect(document.querySelector('[role="dialog"]')).toBeNull()
    })

    test('keeps registrations correct during StrictMode replay and translation updates', async () => {
        await render(
            <StrictMode>
                <PageAlert severity="warning" title="Pending" description="Before refresh" />
            </StrictMode>,
        )
        expect(triangle()?.getAttribute('aria-label')).toBe('1 warning on this page')
        await render(
            <StrictMode>
                <PageAlert
                    severity="warning"
                    title="Ausstehend"
                    description="Nach Aktualisierung"
                />
            </StrictMode>,
        )
        const details = await openPageAlerts()
        expect(details.textContent).toContain('Nach Aktualisierung')
        expect(details.textContent).not.toContain('Before refresh')
    })

    test('puts the icon immediately before Search in the real topbar', async () => {
        await render(
            <TooltipProvider>
                <PageAlertsProvider>
                    <ApplicationTopbar
                        isMobileNavigationOpen={false}
                        isNavigationExpanded
                        mobileNavigationToggleLabel="Open navigation"
                        navigationToggleLabel="Collapse navigation"
                        onToggleMobileNavigation={() => undefined}
                        onToggleNavigation={() => undefined}
                        searchControl={<button type="button">Search</button>}
                        themeControl={<button type="button">Theme</button>}
                    />
                    <PageAlert severity="warning" title="Pending" description="Queued changes" />
                </PageAlertsProvider>
            </TooltipProvider>,
        )
        const icon = container.querySelector('header button[data-severity]')
        expect(icon?.nextElementSibling?.textContent).toBe('Search')
    })
})

describe('runtime alert integration', () => {
    const pending = {
        available: true,
        running: true,
        activeRevision: 'old',
        desiredRevision: 'new',
        lastApplyAt: null,
        state: 'pending' as const,
    }
    test('preserves apply permissions and busy state', async () => {
        const apply = mock(() => undefined)
        await render(
            <RuntimeStatusPanel
                translationPrefix="admin.proxyHosts.runtime"
                canApply={false}
                isApplying={false}
                onApply={apply}
                status={pending}
            />,
        )
        expect((await openPageAlerts()).textContent).not.toContain('Apply changes')
        await render(
            <RuntimeStatusPanel
                translationPrefix="admin.proxyHosts.runtime"
                canApply
                isApplying
                onApply={apply}
                status={pending}
            />,
        )
        const busy = document.querySelector<HTMLButtonElement>('li button')
        expect(busy?.disabled).toBeTrue()
        await render(
            <RuntimeStatusPanel
                translationPrefix="admin.proxyHosts.runtime"
                canApply
                isApplying={false}
                onApply={apply}
                status={pending}
            />,
        )
        await act(async () => document.querySelector<HTMLButtonElement>('li button')?.click())
        expect(apply).toHaveBeenCalledTimes(1)
    })

    test('distinguishes a refresh failure from loading and clears synchronized status', async () => {
        const retry = mock(() => undefined)
        await render(
            <RuntimeStatusPanel
                translationPrefix="admin.proxyHosts.runtime"
                canApply
                isApplying={false}
                onApply={() => undefined}
                status={undefined}
            />,
        )
        expect(triangle()).toBeNull()
        await render(
            <RuntimeStatusPanel
                translationPrefix="admin.proxyHosts.runtime"
                canApply
                isApplying={false}
                isError
                onApply={() => undefined}
                onRetry={retry}
                status={pending}
            />,
        )
        expect(triangle()?.dataset.severity).toBe('error')
        const details = await openPageAlerts()
        expect(details.textContent).toContain('Proxy runtime unavailable.')
        expect(details.textContent).not.toContain('Apply changes')
        await act(async () => details.querySelector<HTMLButtonElement>('li button')?.click())
        expect(retry).toHaveBeenCalledTimes(1)
        await render(
            <RuntimeStatusPanel
                translationPrefix="admin.proxyHosts.runtime"
                canApply
                isApplying={false}
                onApply={() => undefined}
                status={{ ...pending, activeRevision: 'new', state: 'synced' }}
            />,
        )
        expect(triangle()).toBeNull()
    })
})
