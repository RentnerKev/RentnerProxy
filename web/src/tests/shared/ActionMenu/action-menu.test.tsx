import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { ReactElement } from 'react'
import type { Root } from 'react-dom/client'

import withTestLanguage from '@/tests/Helpers/withTestLanguage.tsx'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const { act, useState } = await import('react')
const { createRoot } = await import('react-dom/client')
const { ActionMenu } = await import('@/shared/ActionMenu/index.tsx')
const { Modal } = await import('@/shared/Modal/index.tsx')

let root: Root | null = null

async function render(element: ReactElement): Promise<void> {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(withTestLanguage(element)))
}

async function click(element: HTMLElement): Promise<void> {
    await act(async () => element.click())
}

async function waitForFocus(element: HTMLElement, deadline = Date.now() + 1_000): Promise<void> {
    if (document.activeElement === element || Date.now() >= deadline) {
        expect(document.activeElement === element).toBeTrue()
        return
    }
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)))
    await waitForFocus(element, deadline)
}

async function key(element: HTMLElement, value: string): Promise<void> {
    await act(async () => {
        element.dispatchEvent(
            new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: value }),
        )
    })
}

function button(label: string): HTMLButtonElement {
    const element = document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
    if (!element) throw new Error(`Missing button: ${label}`)
    return element
}

function item(label: string): HTMLElement {
    const element = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
        (entry) =>
            document.getElementById(entry.getAttribute('aria-labelledby') ?? '')?.textContent ===
            label,
    )
    if (!element) throw new Error(`Missing menu item: ${label}`)
    return element
}

function EditFixture() {
    const [open, setOpen] = useState(false)
    return (
        <>
            <ActionMenu
                ariaLabel="Host actions"
                items={[{ id: 'edit-host', label: 'Edit host', onSelect: () => setOpen(true) }]}
            />
            <Modal open={open} onOpenChange={setOpen} title="Edit host" description="Host settings">
                <input aria-label="Hostname" />
            </Modal>
        </>
    )
}

function NestedFixture({ pending = false }: { readonly pending?: boolean }) {
    const [open, setOpen] = useState(false)
    const [nested, setNested] = useState(false)
    return (
        <>
            <button aria-label="Open accounts" onClick={() => setOpen(true)}>
                Accounts
            </button>
            <Modal
                open={open}
                onOpenChange={setOpen}
                title="Accounts"
                description="Manage accounts"
                closeDisabled={pending}
            >
                <ActionMenu
                    ariaLabel="Account actions"
                    items={[
                        {
                            id: 'edit-account',
                            label: 'Edit account',
                            onSelect: () => setNested(true),
                        },
                    ]}
                />
                <Modal
                    open={nested}
                    onOpenChange={setNested}
                    title="Edit account"
                    description="Account details"
                >
                    <input aria-label="Account name" />
                </Modal>
            </Modal>
        </>
    )
}

beforeEach(() => document.body.replaceChildren())

afterEach(async () => {
    await act(async () => root?.unmount())
    root = null
    document.body.replaceChildren()
})

describe('RentnerMenu action integration', () => {
    test('identically labelled actions dispatch their distinct IDs', async () => {
        const primary = mock(() => undefined)
        const secondary = mock(() => undefined)
        await render(
            <ActionMenu
                ariaLabel="Actions"
                items={[
                    {
                        id: 'primary',
                        label: 'Open',
                        description: 'Primary target',
                        onSelect: primary,
                    },
                    {
                        id: 'secondary',
                        label: 'Open',
                        description: 'Secondary target',
                        onSelect: secondary,
                    },
                ]}
            />,
        )
        await click(button('Actions'))
        const entries = document.querySelectorAll<HTMLElement>('[role="menuitem"]')
        await click(entries[1]!)
        expect(primary).not.toHaveBeenCalled()
        expect(secondary).toHaveBeenCalledTimes(1)
    })

    test('translated labels retain the focused action and invoke the current callback', async () => {
        const oldAction = mock(() => undefined)
        const newAction = mock(() => undefined)
        await render(
            <ActionMenu
                ariaLabel="Actions"
                items={[{ id: 'edit', label: 'Edit', onSelect: oldAction }]}
            />,
        )
        await click(button('Actions'))
        const focused = item('Edit')
        await act(async () =>
            root?.render(
                withTestLanguage(
                    <ActionMenu
                        ariaLabel="Actions"
                        items={[{ id: 'edit', label: 'Bearbeiten', onSelect: newAction }]}
                    />,
                ),
            ),
        )
        expect(item('Bearbeiten') === focused).toBeTrue()
        expect(document.activeElement === focused).toBeTrue()
        await click(focused)
        expect(oldAction).not.toHaveBeenCalled()
        expect(newAction).toHaveBeenCalledTimes(1)
    })
    test('hover opens by default without moving focus and closes after leaving the popup', async () => {
        await render(
            <>
                <input aria-label="Search" />
                <ActionMenu
                    ariaLabel="Actions"
                    items={[{ id: 'edit', label: 'Edit', onSelect: () => undefined }]}
                />
            </>,
        )
        const search = document.querySelector<HTMLInputElement>('input')!
        const trigger = button('Actions')
        await act(async () => {
            search.focus()
            trigger.dispatchEvent(
                new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }),
            )
            await new Promise((resolve) => setTimeout(resolve, 120))
        })
        const menu = document.querySelector<HTMLElement>('[role="menu"]')!
        expect(menu !== null).toBeTrue()
        expect(document.activeElement === search).toBeTrue()
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
            await new Promise((resolve) => setTimeout(resolve, 180))
        })
        expect(document.querySelector('[role="menu"]') === menu).toBeTrue()
        await act(async () => {
            menu.dispatchEvent(
                new PointerEvent('pointerout', {
                    bubbles: true,
                    pointerType: 'mouse',
                    relatedTarget: document.body,
                }),
            )
            await new Promise((resolve) => setTimeout(resolve, 180))
        })
        expect(document.querySelector('[role="menu"]') === null).toBeTrue()
        expect(document.activeElement === search).toBeTrue()
    })

    test('hover keeps the current focus; clicking opens the accessible actions', async () => {
        await render(
            <>
                <input aria-label="Search" />
                <ActionMenu
                    openOnHover={false}
                    items={[{ id: 'edit', label: 'Edit', onSelect: () => undefined }]}
                />
            </>,
        )
        const search = document.querySelector<HTMLInputElement>('input')!
        const trigger = button('Open actions')
        await act(async () => {
            search.focus()
            trigger.dispatchEvent(
                new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }),
            )
        })
        expect(document.querySelector('[role="menu"]') === null).toBeTrue()
        expect(document.activeElement === search).toBeTrue()

        await click(trigger)
        expect(trigger.getAttribute('aria-expanded')).toBe('true')
        expect(document.activeElement === item('Edit')).toBeTrue()
        expect(document.body.style.pointerEvents).not.toBe('none')
    })

    test('touch activates the same native button without hover', async () => {
        await render(
            <ActionMenu
                ariaLabel="Actions"
                items={[{ id: 'edit', label: 'Edit', onSelect: () => undefined }]}
            />,
        )
        const trigger = button('Actions')
        await act(async () => {
            trigger.dispatchEvent(
                new PointerEvent('pointerover', { bubbles: true, pointerType: 'touch' }),
            )
            trigger.dispatchEvent(
                new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }),
            )
            trigger.dispatchEvent(
                new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' }),
            )
            trigger.click()
        })
        expect(trigger.getAttribute('aria-expanded')).toBe('true')
        expect(document.activeElement === item('Edit')).toBeTrue()
    })

    test.each(['ArrowDown', 'ArrowUp'])(
        '%s opens at the correct enabled action and Escape restores focus',
        async (openingKey) => {
            await render(
                <ActionMenu
                    ariaLabel="Actions"
                    items={[
                        {
                            id: 'unavailable',
                            label: 'Unavailable',
                            disabled: true,
                            onSelect: () => undefined,
                        },
                        { id: 'edit', label: 'Edit', onSelect: () => undefined },
                        {
                            id: 'delete',
                            label: 'Delete',
                            destructive: true,
                            onSelect: () => undefined,
                        },
                    ]}
                />,
            )
            const trigger = button('Actions')
            await act(async () => trigger.focus())
            await key(trigger, openingKey)
            expect(
                document.activeElement === item(openingKey === 'ArrowUp' ? 'Delete' : 'Edit'),
            ).toBeTrue()
            await key(document.activeElement as HTMLElement, 'Escape')
            expect(document.querySelector('[role="menu"]') === null).toBeTrue()
            expect(document.activeElement === trigger).toBeTrue()
        },
    )

    test('disabled actions cannot run, while descriptions and dangerous actions remain accessible', async () => {
        const unavailable = mock(() => undefined)
        const remove = mock(() => undefined)
        await render(
            <ActionMenu
                ariaLabel="Actions"
                items={[
                    {
                        id: 'protected',
                        label: 'Protected',
                        description: 'Owner account',
                        disabled: true,
                        onSelect: unavailable,
                    },
                    {
                        id: 'delete',
                        label: 'Delete',
                        description: 'Remove this host',
                        destructive: true,
                        onSelect: remove,
                    },
                ]}
            />,
        )
        await click(button('Actions'))
        expect(item('Protected').getAttribute('aria-disabled')).toBe('true')
        await click(item('Protected'))
        expect(unavailable).not.toHaveBeenCalled()
        expect(button('Actions').getAttribute('aria-expanded')).toBe('true')
        const removeItem = item('Delete')
        expect(
            document.getElementById(removeItem.getAttribute('aria-describedby') ?? '')?.textContent,
        ).toBe('Remove this host')
        await click(removeItem)
        expect(remove).toHaveBeenCalledTimes(1)
        expect(document.querySelector('[role="menu"]') === null).toBeTrue()
    })

    test('focusing another control dismisses the nonmodal menu', async () => {
        await render(
            <>
                <input aria-label="Search" />
                <ActionMenu
                    ariaLabel="Actions"
                    items={[{ id: 'edit', label: 'Edit', onSelect: () => undefined }]}
                />
            </>,
        )
        await click(button('Actions'))
        const search = document.querySelector<HTMLInputElement>('input')!
        await act(async () => search.focus())
        expect(document.querySelector('[role="menu"]') === null).toBeTrue()
        expect(document.activeElement === search).toBeTrue()
    })

    test('an edit dialog receives focus and returns it to the action trigger after closing', async () => {
        await render(<EditFixture />)
        const trigger = button('Host actions')
        await click(trigger)
        await click(item('Edit host'))
        const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
        expect(dialog !== null).toBeTrue()
        expect(document.querySelector('[role="menu"]') === null).toBeTrue()
        expect(document.activeElement === dialog).toBeTrue()
        await click(button('Close dialog'))
        expect(document.querySelector('[role="dialog"]') === null).toBeTrue()
        await waitForFocus(trigger)
    })

    test.each([false, true])(
        'menus inside a modal use its portal and Escape closes only the menu (pending: %s)',
        async (pending) => {
            await render(<NestedFixture pending={pending} />)
            await click(button('Open accounts'))
            const trigger = button('Account actions')
            await click(trigger)
            const menu = document.querySelector<HTMLElement>('[role="menu"]')!
            expect(menu.closest('[data-modal-select-host]') !== null).toBeTrue()
            expect(document.activeElement === item('Edit account')).toBeTrue()
            await key(item('Edit account'), 'Escape')
            expect(document.querySelector('[role="menu"]') === null).toBeTrue()
            expect(document.querySelectorAll('[role="dialog"]').length).toBe(1)
            expect(document.activeElement === trigger).toBeTrue()
        },
    )

    test('Escape closes a hovered modal menu while focus is still on the parent dialog', async () => {
        await render(<NestedFixture />)
        await click(button('Open accounts'))
        const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
        await act(async () => {
            button('Account actions').dispatchEvent(
                new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }),
            )
            await new Promise((resolve) => setTimeout(resolve, 120))
        })
        expect(document.querySelector('[role="menu"]') !== null).toBeTrue()
        expect(document.activeElement === dialog).toBeTrue()
        await key(dialog, 'Escape')
        expect(document.querySelector('[role="menu"]') === null).toBeTrue()
        expect(document.querySelectorAll('[role="dialog"]').length).toBe(1)
        expect(document.activeElement === button('Account actions')).toBeTrue()
    })

    test('a menu action can open a nested modal and restore focus within its parent', async () => {
        await render(<NestedFixture />)
        await click(button('Open accounts'))
        const trigger = button('Account actions')
        await click(trigger)
        await click(item('Edit account'))
        expect(document.querySelectorAll('[role="dialog"]').length).toBe(2)
        expect(document.querySelector('[role="menu"]') === null).toBeTrue()
        const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"]')
        expect(document.activeElement === dialogs[1]).toBeTrue()
        const close = dialogs[1]!.querySelector<HTMLButtonElement>(
            'button[aria-label="Close dialog"]',
        )!
        await click(close)
        expect(document.querySelectorAll('[role="dialog"]').length).toBe(1)
        await waitForFocus(trigger)
    })
})
