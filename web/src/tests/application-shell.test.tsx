import { afterEach, describe, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { ReactElement } from 'react'
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
            isNavigationExpanded={navigation.state.isNavigationExpanded}
            navigationToggleLabel={navigation.state.navigationToggleLabel}
            onToggleNavigation={navigation.handler.toggleNavigation}
            themeControl={<button type="button">Theme</button>}
        />
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
            'button[aria-label="Collapse navigation"]',
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
            'button[aria-label="Expand navigation"]',
        )
        expect(expandButton).not.toBeNull()
        expect(expandButton?.getAttribute('aria-expanded')).toBe('false')
    })
})
