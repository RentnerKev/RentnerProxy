import { afterEach, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { Root } from 'react-dom/client'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const { act, useState } = await import('react')
const { createRoot } = await import('react-dom/client')
const { default: SelectControl } = await import('../shared/Select')
let root: Root | undefined

function Harness({ disabled = false }: { disabled?: boolean }) {
    const [value, setValue] = useState('')
    return (
        <form>
            <label htmlFor="choice">Choice</label>
            <SelectControl
                id="choice"
                name="choice"
                ariaLabel="Choice"
                placeholder="Choose"
                value={value}
                onValueChange={setValue}
                disabled={disabled}
                invalid={!value}
                describedBy="choice-error"
                options={[
                    { value: 'unavailable', label: 'Unavailable', disabled: true },
                    { value: 'available', label: 'Available' },
                ]}
            />
            <span id="choice-error">Choose an available option</span>
            <output>{value}</output>
        </form>
    )
}

async function render(disabled = false) {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root!.render(<Harness disabled={disabled} />))
    return document.querySelector<HTMLButtonElement>('[role="combobox"]')!
}

async function key(element: Element, value: string) {
    await act(async () => {
        element.dispatchEvent(
            new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }),
        )
        await new Promise((resolve) => setTimeout(resolve, 20))
    })
}

afterEach(async () => {
    await act(async () => root?.unmount())
    document.body.replaceChildren()
})

test('exposes label and error metadata and supports keyboard selection with disabled options', async () => {
    const trigger = await render()
    expect(document.querySelector<HTMLSelectElement>('select[name="choice"]')?.value).toBe('')
    expect(trigger.id).toBe('choice')
    expect(trigger.getAttribute('aria-invalid')).toBe('true')
    expect(trigger.getAttribute('aria-describedby')).toBe('choice-error')
    await key(trigger, 'Enter')
    const unavailable = document.querySelector<HTMLElement>('[role="option"][data-disabled]')!
    expect(unavailable.getAttribute('aria-disabled')).toBe('true')
    const available = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
        (option) => option.textContent === 'Available',
    )!
    await act(async () => available.focus())
    await key(available, 'Enter')
    expect(document.querySelector('output')?.textContent).toBe('available')
    expect(trigger.hasAttribute('aria-invalid')).toBeFalse()
    expect(document.querySelector<HTMLSelectElement>('select[name="choice"]')?.value).toBe(
        'available',
    )
    expect(document.querySelector('[role="listbox"]')).toBeNull()
})

test('Escape closes the keyboard-opened select and disabled triggers cannot open', async () => {
    const trigger = await render()
    await key(trigger, 'ArrowDown')
    expect(document.querySelector('[role="listbox"]')).not.toBeNull()
    await key(document.activeElement!, 'Escape')
    expect(document.querySelector('[role="listbox"]')).toBeNull()
    await act(async () => root!.render(<Harness disabled />))
    expect(trigger.disabled).toBeTrue()
    await act(async () => trigger.click())
    expect(document.querySelector('[role="listbox"]')).toBeNull()
})
