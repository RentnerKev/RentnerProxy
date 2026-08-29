import { afterEach, describe, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { ReactElement } from 'react'
import type { Root } from 'react-dom/client'

if (!GlobalRegistrator.isRegistered) {
    GlobalRegistrator.register()
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { default: ApplicationTopbar } =
    await import('../shared/ApplicationShell/Components/ApplicationTopbar')
const { default: useApplicationNavigationLogic } =
    await import('../shared/ApplicationShell/Hooks/useApplicationNavigationLogic')

let activeRoot: Root | null = null

async function render(element: ReactElement): Promise<HTMLElement> {
    const container = document.createElement('div')
    document.body.append(container)
    activeRoot = createRoot(container)

    await act(async () => {
        activeRoot?.render(element)
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
        expect(collapseButton?.getAttribute('aria-expanded')).toBe('true')

        await click(collapseButton!)

        const expandButton = container.querySelector<HTMLButtonElement>(
            'button[aria-label="Expand navigation"]',
        )
        expect(expandButton).not.toBeNull()
        expect(expandButton?.getAttribute('aria-expanded')).toBe('false')
    })
})
