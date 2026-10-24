import { afterEach, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { Root } from 'react-dom/client'

import type { UtcDateTimeRangeValue } from '@/shared/Forms/Types/utc-date-time-range-input.types.ts'
import withTestLanguage from '@/tests/Helpers/withTestLanguage.tsx'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const { act, useState } = await import('react')
const { createRoot } = await import('react-dom/client')
const { TooltipProvider } = await import('@rentnerkev/tooltips/tooltip')
const { default: UtcDateTimeRangeInput } = await import('@/shared/Forms/UtcDateTimeRangeInput.tsx')
let root: Root | undefined

const initialRange = { from: '2026-09-12T13:45', to: '2026-09-15T18:30' }

function Harness({ initialValue }: { readonly initialValue: UtcDateTimeRangeValue }) {
    const [value, setValue] = useState(initialValue)
    return (
        <>
            <UtcDateTimeRangeInput
                ariaLabel="Period (local time)"
                value={value}
                onValueChange={setValue}
            />
            <output>{JSON.stringify(value)}</output>
        </>
    )
}

async function render(initialValue: UtcDateTimeRangeValue = initialRange) {
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

function trigger(): HTMLButtonElement {
    return document.querySelector<HTMLButtonElement>('button[aria-label="Period (local time)"]')!
}

function currentValue(): UtcDateTimeRangeValue {
    return JSON.parse(document.querySelector('output')!.textContent!)
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

function day(label: string): HTMLButtonElement {
    return [...document.querySelectorAll<HTMLButtonElement>('[data-calendar-day]')].find((button) =>
        button.getAttribute('aria-label')?.includes(label),
    )!
}

function time(label: 'From' | 'To'): HTMLElement {
    return document.querySelector<HTMLElement>(`[role="textbox"][aria-label^="${label} "]`)!
}

async function setTime(element: HTMLElement, digits: string) {
    await act(async () => element.focus())
    await key(element, digits[0]!)
    await key(element, digits[1]!)
    await key(element, digits[2]!)
    await key(element, digits[3]!)
}

afterEach(async () => {
    await act(async () => root?.unmount())
    document.body.replaceChildren()
})

test('selects both dates and built-in times in one calendar and emits UTC bounds', async () => {
    await render()
    expect(document.querySelectorAll('button[aria-haspopup="dialog"]')).toHaveLength(1)
    expect(document.querySelector('input[type="time"]')).toBeNull()
    await click(trigger())
    await click(day('September 14, 2026'))
    await click(day('September 16, 2026'))
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
    expect(document.querySelectorAll('[role="textbox"]')).toHaveLength(2)
    await setTime(time('From'), '0845')
    await setTime(time('To'), '1730')
    expect(currentValue()).toEqual({
        from: new Date(2026, 8, 14, 8, 45).toISOString().slice(0, 16),
        to: new Date(2026, 8, 16, 17, 30).toISOString().slice(0, 16),
    })
    await key(time('To'), 'Escape')
    await click(document.querySelector<HTMLButtonElement>('button[aria-label="Clear"]')!)
    expect(currentValue()).toEqual({ from: '', to: '' })
})

test('shows an empty range placeholder without separate time fields', async () => {
    await render({ from: '', to: '' })
    expect(trigger().textContent).toContain('Select date range')
    expect(trigger().classList.contains('text-left')).toBe(true)
    expect(document.querySelector('[role="textbox"]')).toBeNull()
    await click(trigger())
    expect(time('From').getAttribute('aria-disabled')).toBe('true')
    expect(time('To').getAttribute('aria-disabled')).toBe('true')
})

test('supports package date keyboard navigation and Escape', async () => {
    await render()
    await click(trigger())
    const selected = document.querySelector<HTMLButtonElement>(
        '[data-calendar-day][aria-pressed="true"]',
    )!
    await act(async () => selected.focus())
    await key(selected, 'ArrowRight')
    expect(document.activeElement?.textContent).toBe(
        String(new Date(`${initialRange.from}:00.000Z`).getDate() + 1),
    )
    await key(document.activeElement as HTMLElement, 'Escape')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
})

test.each(['2026-03-29T02:30', '2026-10-25T00:30', '2026-10-25T01:30'])(
    'preserves the UTC range through the local DST transition at %s',
    async (from) => {
        const start = new Date(`${from}:00.000Z`)
        const value = {
            from,
            to: new Date(start.getTime() + 2 * 60 * 60 * 1_000).toISOString().slice(0, 16),
        }
        await render(value)
        await click(trigger())
        const displayTime = `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`
        expect(time('From').getAttribute('aria-label')).toBe(`From ${displayTime}`)
        await key(time('From'), 'Escape')
        expect(currentValue()).toEqual(value)
    },
)

test('accepts an existing open-ended UTC range and clears both bounds together', async () => {
    await render({ from: initialRange.from, to: '' })
    await click(trigger())
    expect(time('From').getAttribute('aria-disabled')).toBeNull()
    expect(time('To').getAttribute('aria-disabled')).toBe('true')
    await key(time('From'), 'Escape')
    await click(document.querySelector<HTMLButtonElement>('button[aria-label="Clear"]')!)
    expect(currentValue()).toEqual({ from: '', to: '' })
})
