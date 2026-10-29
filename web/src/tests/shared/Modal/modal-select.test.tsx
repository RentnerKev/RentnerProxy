import { afterEach, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { Root } from 'react-dom/client'

import withTestLanguage from '@/tests/Helpers/withTestLanguage.tsx'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const { act, useState } = await import('react')
const { createRoot } = await import('react-dom/client')
const { CustomSelect, SelectProvider } = await import('@rentnerkev/select')
const { Modal } = await import('@/shared/Modal/index.tsx')

let root: Root | null = null

function Fixture({ searchable = false, closeDisabled = false, focusFooter = false }) {
    const [open, setOpen] = useState(false)
    const [nestedOpen, setNestedOpen] = useState(false)
    const [value, setValue] = useState('alpha')
    const [nestedValue, setNestedValue] = useState('alpha')
    const options = [
        { value: 'alpha', label: 'Alpha' },
        { value: 'beta', label: 'Beta' },
    ]

    return (
        <SelectProvider
            searchable={false}
            nonce="modal-select-fixture"
            messages={{ searchOptions: 'Find a choice', noResults: 'No matching choices' }}
        >
            <button id="open-modal" onClick={() => setOpen(true)}>
                Open modal
            </button>
            <Modal
                open={open}
                onOpenChange={setOpen}
                title="Parent dialog"
                description="Choose a value"
                closeDisabled={closeDisabled}
                onOpenAutoFocus={
                    focusFooter
                        ? (event) => {
                              event.preventDefault()
                              document.getElementById('footer-action')?.focus()
                          }
                        : undefined
                }
                footer={<button id="footer-action">Another action</button>}
            >
                <CustomSelect
                    id="parent-choice"
                    label="Parent choice"
                    options={options}
                    value={value}
                    onValueChange={setValue}
                    {...(searchable ? { searchable: true } : {})}
                />
                <output>{value}</output>
                <button id="open-nested" onClick={() => setNestedOpen(true)}>
                    Open nested
                </button>
                <Modal
                    open={nestedOpen}
                    onOpenChange={setNestedOpen}
                    title="Nested dialog"
                    description="Choose a nested value"
                >
                    <CustomSelect
                        id="nested-choice"
                        label="Nested choice"
                        options={options}
                        value={nestedValue}
                        onValueChange={setNestedValue}
                    />
                </Modal>
            </Modal>
        </SelectProvider>
    )
}

async function flush() {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 25))
    })
}

async function click(element: HTMLElement) {
    await act(async () => {
        element.focus()
        element.click()
    })
    await flush()
}

async function escape() {
    await act(async () => {
        document.activeElement!.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
        )
    })
    await flush()
}

async function render(props: Parameters<typeof Fixture>[0] = {}) {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(withTestLanguage(<Fixture {...props} />)))
    await click(document.getElementById('open-modal')!)
    return document.querySelector<HTMLElement>('[role="dialog"]')!
}

function trigger(id = 'parent-choice') {
    return document.getElementById(id) as HTMLButtonElement
}

function popup(control: HTMLElement) {
    return document.getElementById(control.getAttribute('aria-controls')!)!
}

afterEach(async () => {
    await act(async () => root?.unmount())
    root = null
    document.body.replaceChildren()
})

test('opening a modal focuses its container instead of automatically outlining the close button', async () => {
    const dialog = await render()
    expect(document.activeElement === dialog).toBe(true)
    const close = dialog.querySelector('button[aria-label="Close dialog"]')
    expect(close === null).toBe(false)
    expect(document.activeElement === close).toBe(false)
    await escape()
    expect(dialog.isConnected).toBe(false)
    expect(document.activeElement === document.getElementById('open-modal')).toBe(true)
})

test('explicit modal autofocus handlers keep their requested focus target', async () => {
    await render({ focusFooter: true })
    expect(document.activeElement === document.getElementById('footer-action')).toBe(true)
})

test.each([false, true])(
    'keeps a modal select focused, selectable and outside its scrolling body (searchable: %s)',
    async (searchable) => {
        const dialog = await render({ searchable })
        const control = trigger()
        await click(control)
        const content = popup(control)
        expect(content).not.toBeNull()
        expect(dialog.contains(content)).toBeTrue()
        expect(content.closest('.overflow-y-auto')).toBeNull()
        expect(content.contains(document.activeElement)).toBeTrue()
        expect(dialog.classList.contains('overflow-clip')).toBeFalse()
        if (searchable) {
            expect(content.querySelector('input[aria-label="Find a choice"]')).not.toBeNull()
        }
        const beta = [...content.querySelectorAll<HTMLElement>('[role="option"]')].find(
            (option) => option.textContent === 'Beta',
        )!
        await click(beta)
        expect(dialog.querySelector('output')?.textContent).toBe('beta')
        expect(control.getAttribute('aria-expanded')).toBe('false')
        expect(document.activeElement).toBe(control)
    },
)

test('Escape closes the select before its modal and restores the correct focus', async () => {
    const dialog = await render()
    const control = trigger()
    await click(control)
    expect(popup(control)).not.toBeNull()
    await escape()
    expect(control.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(control)
    expect(dialog.isConnected).toBeTrue()
    await escape()
    expect(dialog.isConnected).toBeFalse()
    expect(document.activeElement).toBe(document.getElementById('open-modal'))
})

test('a nested modal owns its select popup and Escape leaves the parent open', async () => {
    const parent = await render()
    await click(document.getElementById('open-nested')!)
    const nested = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].at(-1)!
    const control = trigger('nested-choice')
    await click(control)
    expect(nested.contains(popup(control))).toBeTrue()
    expect(parent.contains(popup(control))).toBeFalse()
    await escape()
    expect(control.getAttribute('aria-expanded')).toBe('false')
    expect(nested.isConnected).toBeTrue()
    expect(document.activeElement).toBe(control)
    await escape()
    expect(nested.isConnected).toBeFalse()
    expect(parent.isConnected).toBeTrue()
    expect(document.activeElement).toBe(document.getElementById('open-nested'))
})

test('a pending modal still lets Escape close its select without dismissing the modal', async () => {
    const dialog = await render({ closeDisabled: true })
    const control = trigger()
    await click(control)
    expect(popup(control)).not.toBeNull()
    await escape()
    expect(control.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(control)
    await escape()
    expect(dialog.isConnected).toBeTrue()
})
