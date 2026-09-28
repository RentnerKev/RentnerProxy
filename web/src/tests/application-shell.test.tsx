import { afterEach, describe, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { useRef, type ReactElement } from 'react'
import type { Root } from 'react-dom/client'

import { TOOLTIP_PROVIDER_PROPS } from '../config/tooltip.config'
import { withLanguageRoot } from './Helpers/withTestLanguage'

if (!GlobalRegistrator.isRegistered) {
    GlobalRegistrator.register()
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { default: ApplicationTopbar } =
    await import('../layout/Components/ApplicationShell/Components/ApplicationTopbar')
const { default: ApplicationSidebarScrollIndicator } =
    await import('../layout/Components/ApplicationShell/Components/ApplicationSidebarScrollIndicator')
const { default: useApplicationNavigationLogic } =
    await import('../layout/Components/ApplicationShell/Hooks/useApplicationNavigationLogic')
const { TooltipProvider } = await import('@rentnerkev/tooltips/tooltip')

let activeRoot: Root | null = null

async function render(element: ReactElement): Promise<HTMLElement> {
    const container = document.createElement('div')
    document.body.append(container)
    activeRoot = withLanguageRoot(createRoot(container))

    await act(async () => {
        activeRoot?.render(<TooltipProvider {...TOOLTIP_PROVIDER_PROPS}>{element}</TooltipProvider>)
    })

    return container
}

async function click(element: Element): Promise<void> {
    await act(async () => {
        element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
        await Promise.resolve()
    })
}

function ApplicationTopbarHarness() {
    const navigation = useApplicationNavigationLogic()

    return (
        <ApplicationTopbar
            isMobileNavigationOpen={navigation.state.isMobileNavigationOpen}
            isNavigationExpanded={navigation.state.isNavigationExpanded}
            mobileNavigationToggleLabel={navigation.state.mobileNavigationToggleLabel}
            navigationToggleLabel={navigation.state.navigationToggleLabel}
            onToggleMobileNavigation={navigation.handler.toggleMobileNavigation}
            onToggleNavigation={navigation.handler.toggleNavigation}
            themeControl={<button type="button">Theme</button>}
        />
    )
}

function SidebarScrollHarness() {
    const sidebarRef = useRef<HTMLElement>(null)
    const scrollContainerRef = useRef<HTMLDivElement>(null)

    return (
        <aside ref={sidebarRef}>
            <div id="application-navigation-links" ref={scrollContainerRef}>
                <div>Navigation</div>
            </div>
            <ApplicationSidebarScrollIndicator
                scrollContainerRef={scrollContainerRef}
                sidebarRef={sidebarRef}
            />
        </aside>
    )
}

afterEach(async () => {
    await act(async () => {
        activeRoot?.unmount()
    })
    activeRoot = null
    document.body.replaceChildren()
})

describe('application topbar', () => {
    test('replaces session metadata with an accessible navigation toggle', async () => {
        const container = await render(<ApplicationTopbarHarness />)
        const collapseButton = container.querySelector<HTMLButtonElement>(
            'button[aria-controls="application-navigation"]',
        )

        expect(container.textContent).not.toContain('Authenticated session')
        expect(collapseButton).not.toBeNull()
        expect(collapseButton?.hasAttribute('title')).toBe(false)
        expect(collapseButton?.getAttribute('aria-expanded')).toBe('true')

        await act(async () => {
            collapseButton?.focus()
            await Promise.resolve()
        })

        const tooltip = document.querySelector('[role="tooltip"]')
        expect(tooltip?.textContent).toContain('Collapse navigation')
        expect(tooltip?.classList.contains('rentnerproxy-tooltip')).toBe(true)
        expect(tooltip?.classList.contains('border-border')).toBe(true)
        expect(tooltip?.classList.contains('bg-surface-raised')).toBe(true)
        expect(tooltip?.classList.contains('text-ink')).toBe(true)
        expect(TOOLTIP_PROVIDER_PROPS).toEqual({ delayDuration: 80, skipDelayDuration: 50 })

        await click(collapseButton!)

        const expandButton = container.querySelector<HTMLButtonElement>(
            'button[aria-controls="application-navigation"]',
        )
        expect(expandButton).not.toBeNull()
        expect(expandButton?.getAttribute('aria-expanded')).toBe('false')
    })

    test('opens the mobile page menu without changing the desktop sidebar', async () => {
        const container = await render(<ApplicationTopbarHarness />)
        const mobileButton = container.querySelector<HTMLButtonElement>(
            'button[aria-controls="application-mobile-navigation"]',
        )
        const desktopButton = container.querySelector<HTMLButtonElement>(
            'button[aria-controls="application-navigation"]',
        )

        expect(mobileButton?.getAttribute('aria-expanded')).toBe('false')
        expect(desktopButton?.getAttribute('aria-expanded')).toBe('true')

        await click(mobileButton!)

        expect(mobileButton?.getAttribute('aria-expanded')).toBe('true')
        expect(desktopButton?.getAttribute('aria-expanded')).toBe('true')
    })
})

describe('sidebar scroll indicator', () => {
    test('moves with navigation scrolling and can be dragged', async () => {
        const container = await render(<SidebarScrollHarness />)
        const sidebar = container.querySelector('aside')!
        const scrollContainer = container.querySelector<HTMLDivElement>(
            '#application-navigation-links',
        )!

        sidebar.getBoundingClientRect = () => new DOMRect(0, 0, 304, 800)
        scrollContainer.getBoundingClientRect = () => new DOMRect(0, 160, 304, 400)
        Object.defineProperty(scrollContainer, 'clientHeight', { value: 400 })
        Object.defineProperty(scrollContainer, 'scrollHeight', { value: 1000 })

        await act(async () => {
            window.dispatchEvent(new Event('resize'))
        })

        const indicator = container.querySelector<HTMLElement>('[role="scrollbar"]')!
        expect(indicator).not.toBeNull()
        expect(indicator.getAttribute('aria-valuemax')).toBe('600')
        const initialTransform = indicator.style.transform

        await act(async () => {
            scrollContainer.scrollTop = 300
            scrollContainer.dispatchEvent(new Event('scroll'))
        })

        expect(indicator.style.transform).not.toBe(initialTransform)
        expect(indicator.getAttribute('aria-valuenow')).toBe('300')

        indicator.setPointerCapture = () => undefined
        indicator.hasPointerCapture = () => false

        await act(async () => {
            indicator.dispatchEvent(
                new PointerEvent('pointerdown', {
                    bubbles: true,
                    button: 0,
                    clientY: 200,
                    pointerId: 1,
                }),
            )
            indicator.dispatchEvent(
                new PointerEvent('pointermove', { bubbles: true, clientY: 250, pointerId: 1 }),
            )
        })

        expect(scrollContainer.scrollTop).toBeGreaterThan(300)
    })
})
