import { afterEach, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { Root } from 'react-dom/client'
import { formatDateTimeLabel } from '../shared/Calendar/Helpers/dateTimeCalendar.helpers'
import withTestLanguage from './Helpers/withTestLanguage'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const { act, useState } = await import('react')
const { createRoot } = await import('react-dom/client')
const { default: DateTimeCalendar } = await import('../shared/Calendar/Components/DateTimeCalendar')
let root: Root | undefined

function Harness() {
    const [value, setValue] = useState('2026-09-12T13:45')
    return (
        <>
            <DateTimeCalendar ariaLabel="From (UTC)" value={value} onValueChange={setValue} />
            <output>{value}</output>
        </>
    )
}

async function render() {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root!.render(withTestLanguage(<Harness />)))
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
afterEach(async () => {
    await act(async () => root?.unmount())
    document.body.replaceChildren()
})

test('selects a calendar day without shifting UTC wall time, edits time and clears', async () => {
    await render()
    await click(document.querySelector<HTMLButtonElement>('button[aria-label="From (UTC)"]')!)
    await click(document.querySelector<HTMLButtonElement>('[data-calendar-date="2026-09-14"]')!)
    expect(document.querySelector('output')?.textContent).toBe('2026-09-14T13:45')
    const hours = document.querySelector<HTMLButtonElement>(
        '[role="combobox"][aria-label="Hours"]',
    )!
    await key(hours, 'Enter')
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
        (item) => item.textContent === '08',
    )!
    await act(async () => option.focus())
    await key(option, 'Enter')
    expect(document.querySelector('output')?.textContent).toBe('2026-09-14T08:45')
    const clear = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
        (item) => item.textContent?.trim() === 'Clear',
    )!
    await click(clear)
    expect(document.querySelector('output')?.textContent).toBe('')
})

test('supports date keyboard navigation and Escape', async () => {
    await render()
    const trigger = document.querySelector<HTMLButtonElement>('button[aria-label="From (UTC)"]')!
    await click(trigger)
    const selected = document.querySelector<HTMLButtonElement>('[data-calendar-date="2026-09-12"]')!
    await act(async () => selected.focus())
    await key(selected, 'ArrowRight')
    expect(document.activeElement?.getAttribute('data-calendar-date')).toBe('2026-09-13')
    await key(document.activeElement as HTMLElement, 'Enter')

    await key(document.activeElement as HTMLElement, 'Escape')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
})

test('formats UTC wall time without normalizing a DST-gap clock value', () => {
    const formatted = formatDateTimeLabel(
        '2026-03-29T02:30',
        'de-DE',
        (translationKey) => translationKey,
    )

    expect(formatted.time).toContain('2:30')
    expect(formatted.time).not.toContain('3:30')
})
