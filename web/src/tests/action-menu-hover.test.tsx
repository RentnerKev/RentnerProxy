import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { ReactElement } from 'react'
import type { Root } from 'react-dom/client'

import withTestLanguage, { withLanguageRoot } from './Helpers/withTestLanguage'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { ActionMenu } = await import('../shared/ActionMenu')

let activeRoot: Root | null = null

async function render(element: ReactElement): Promise<HTMLElement> {
    const container = document.createElement('div')
    document.body.append(container)
    activeRoot = withLanguageRoot(createRoot(container))
    await act(async () => {
        activeRoot?.render(withTestLanguage(element))
    })
    return container
}

async function waitFor(condition: () => boolean, timeoutMs = 1_000): Promise<void> {
    const waitUntil = async (deadline: number): Promise<void> => {
        if (condition()) return
        if (Date.now() >= deadline) {
            expect(condition()).toBeTrue()
            return
        }
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 10))
        })
        await waitUntil(deadline)
    }

    await waitUntil(Date.now() + timeoutMs)
}

beforeEach(() => {
    document.body.replaceChildren()
})

afterEach(async () => {
    if (activeRoot) {
        await act(async () => activeRoot?.unmount())
    }
    activeRoot = null
    document.body.replaceChildren()
})

describe('ActionMenu hover behavior', () => {
    test('opens on mouse hover without moving focus from another control', async () => {
        await render(
            <>
                <input aria-label="Search" />
                <ActionMenu
                    openOnHover
                    ariaLabel="Open proxy host actions"
                    items={[{ label: 'Edit', onSelect: () => undefined }]}
                />
            </>,
        )
        const search = document.querySelector<HTMLInputElement>('input')!
        const trigger = document.querySelector<HTMLButtonElement>(
            '[aria-label="Open proxy host actions"]',
        )!
        search.focus()

        await act(async () => {
            trigger.dispatchEvent(
                new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }),
            )
            await Promise.resolve()
        })

        await waitFor(() => document.querySelector('[role="menu"]') !== null)
        expect(document.activeElement === search).toBeTrue()
    })

    test('stays open across the trigger gap and closes after leaving the menu', async () => {
        await render(
            <ActionMenu
                openOnHover
                ariaLabel="Actions"
                items={[{ label: 'Edit', onSelect: () => undefined }]}
            />,
        )
        const trigger = document.querySelector<HTMLButtonElement>('button')!
        await act(async () => {
            trigger.dispatchEvent(
                new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }),
            )
        })
        await waitFor(() => document.querySelector('[role="menu"]') !== null)
        const menu = document.querySelector<HTMLElement>('[role="menu"]')!
        expect(document.body.style.pointerEvents).not.toBe('none')
        await act(async () => {
            trigger.dispatchEvent(
                new PointerEvent('pointerout', {
                    bubbles: true,
                    pointerType: 'mouse',
                    relatedTarget: menu,
                }),
            )
            menu.dispatchEvent(
                new PointerEvent('pointerover', {
                    bubbles: true,
                    pointerType: 'mouse',
                    relatedTarget: trigger,
                }),
            )
            await new Promise((resolve) => setTimeout(resolve, 200))
        })
        expect(document.querySelector('[role="menu"]')).not.toBeNull()
        await act(async () => {
            menu.dispatchEvent(
                new PointerEvent('pointerout', {
                    bubbles: true,
                    pointerType: 'mouse',
                    relatedTarget: document.body,
                }),
            )
        })
        await waitFor(() => document.querySelector('[role="menu"]') === null)
    })

    test('ignores touch hover and compatibility mouse events but still opens on touch press', async () => {
        await render(
            <ActionMenu
                openOnHover
                ariaLabel="Actions"
                items={[{ label: 'Edit', onSelect: () => undefined }]}
            />,
        )
        const trigger = document.querySelector<HTMLButtonElement>('button')!
        await act(async () => {
            trigger.dispatchEvent(
                new PointerEvent('pointerover', { bubbles: true, pointerType: 'touch' }),
            )
            trigger.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
        })
        expect(document.querySelector('[role="menu"]')).toBeNull()
        await act(async () => {
            trigger.dispatchEvent(
                new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'touch' }),
            )
        })
        await waitFor(() => document.querySelector('[role="menu"]') !== null)
    })

    test('retains keyboard opening and Escape dismissal for hover-enabled menus', async () => {
        await render(
            <ActionMenu
                openOnHover
                ariaLabel="Actions"
                items={[{ label: 'Edit', onSelect: () => undefined }]}
            />,
        )
        const trigger = document.querySelector<HTMLButtonElement>('button')!
        await act(async () => {
            trigger.focus()
            trigger.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' }))
        })
        await waitFor(() => document.querySelector('[role="menu"]') !== null)
        await act(async () => {
            document
                .querySelector('[role="menu"]')!
                .dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }))
        })
        await waitFor(() => document.querySelector('[role="menu"]') === null)
        await waitFor(() => document.activeElement === trigger)
        expect(document.activeElement === trigger).toBeTrue()
    })

    test('does not add hover opening to menus that did not opt in', async () => {
        await render(
            <ActionMenu
                ariaLabel="Actions"
                items={[{ label: 'Edit', onSelect: () => undefined }]}
            />,
        )
        const trigger = document.querySelector<HTMLButtonElement>('button')!
        await act(async () => {
            trigger.dispatchEvent(
                new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }),
            )
        })
        expect(document.querySelector('[role="menu"]')).toBeNull()
        await act(async () => {
            trigger.dispatchEvent(
                new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }),
            )
        })
        await waitFor(() => document.querySelector('[role="menu"]') !== null)
    })
})
