import { afterEach, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { Root } from 'react-dom/client'

import withTestLanguage from './Helpers/withTestLanguage'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const { act, useState } = await import('react')
const { createRoot } = await import('react-dom/client')
const { TooltipProvider } = await import('@rentnerkev/tooltips/tooltip')
const { default: UtcDateTimeInput } = await import('../shared/Forms/UtcDateTimeInput')
let root: Root | undefined

function Harness({ initialValue }: { readonly initialValue: string }) {
    const [value, setValue] = useState(initialValue)

    return (
        <>
            <UtcDateTimeInput ariaLabel="From (UTC)" value={value} onValueChange={setValue} />
            <output>{value}</output>
        </>
    )
}

async function render(initialValue = '2026-09-12T13:45') {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () =>
        root!.render(
            withTestLanguage(
                <TooltipProvider>
                    <Harness initialValue={initialValue} />
                </TooltipProvider>,
            ),
        ),
    )
}

async function click(element: HTMLElement) {
    await act(async () => {
        element.click()
        await new Promise((resolve) => setTimeout(resolve, 20))
    })
}

async function key(element: HTMLElement, value: string) {
    await act(async () => {
        element.dispatchEvent(
            new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }),
        )
        await new Promise((resolve) => setTimeout(resolve, 30))
    })
}

async function setInput(element: HTMLInputElement, value: string) {
    await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
        setter?.call(element, value)
        element.dispatchEvent(new Event('input', { bubbles: true }))
        element.dispatchEvent(new Event('change', { bubbles: true }))
        await Promise.resolve()
    })
}

function findCalendarDay(label: string): HTMLButtonElement {
    const day = [...document.querySelectorAll<HTMLButtonElement>('[data-calendar-day]')].find(
        (button) => button.getAttribute('aria-label')?.includes(label),
    )
    if (!day) throw new Error(`Calendar day not found: ${label}`)
    return day
}

afterEach(async () => {
    await act(async () => root?.unmount())
    document.body.replaceChildren()
})

test('selects a package calendar day, edits UTC wall time and clears', async () => {
    await render()
    expect(
        document
            .querySelector<HTMLButtonElement>('button[aria-label="From (UTC)"]')
            ?.classList.contains('text-left'),
    ).toBe(true)
    await click(document.querySelector<HTMLButtonElement>('button[aria-label="From (UTC)"]')!)
    await click(findCalendarDay('September 14, 2026'))
    expect(document.querySelector('output')?.textContent).toBe('2026-09-14T13:45')

    const time = document.querySelector<HTMLInputElement>(
        'input[aria-label="From (UTC) · Time (UTC)"]',
    )!
    await setInput(time, '08:45')
    expect(document.querySelector('output')?.textContent).toBe('2026-09-14T08:45')

    await click(document.querySelector<HTMLButtonElement>('button[aria-label="Clear"]')!)
    expect(document.querySelector('output')?.textContent).toBe('')
})

test('left-aligns the calendar placeholder', async () => {
    await render('')
    const trigger = document.querySelector<HTMLButtonElement>('button[aria-label="From (UTC)"]')!
    expect(trigger.classList.contains('text-left')).toBe(true)
})

test('supports package date keyboard navigation and Escape', async () => {
    await render()
    const trigger = document.querySelector<HTMLButtonElement>('button[aria-label="From (UTC)"]')!
    await click(trigger)
    const selected = document.querySelector<HTMLButtonElement>(
        '[data-calendar-day][aria-pressed="true"]',
    )!
    await act(async () => selected.focus())
    await key(selected, 'ArrowRight')
    expect(document.activeElement?.textContent).toBe('13')

    await key(document.activeElement as HTMLElement, 'Escape')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
})

test('preserves a UTC wall time that falls into the local DST gap', async () => {
    await render('2026-03-29T02:30')

    expect(
        document.querySelector<HTMLInputElement>('input[aria-label="From (UTC) · Time (UTC)"]')
            ?.value,
    ).toBe('02:30')
    expect(document.querySelector('output')?.textContent).toBe('2026-03-29T02:30')
})
