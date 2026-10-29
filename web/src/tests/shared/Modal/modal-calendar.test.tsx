import { afterEach, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { RangeCalendarValue } from '@rentnerkev/calendar/types'
import type { Root } from 'react-dom/client'
import withTestLanguage from '@/tests/Helpers/withTestLanguage.tsx'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const { act, useState } = await import('react')
const { createRoot } = await import('react-dom/client')
const { RangeCalendar } = await import('@rentnerkev/calendar/range-calendar')
const { Modal } = await import('@/shared/Modal/index.tsx')
let root: Root | undefined

function Fixture() {
    const [open, setOpen] = useState(false)
    const [value, setValue] = useState<RangeCalendarValue>([
        new Date(2026, 9, 28),
        new Date(2026, 9, 28),
    ])
    return (
        <>
            <button id="open-modal" type="button" onClick={() => setOpen(true)}>
                Open modal
            </button>
            <Modal open={open} onOpenChange={setOpen} title="History" description="Filter checks">
                <RangeCalendar
                    aria-label="Check dates"
                    value={value}
                    onChange={setValue}
                    closeOnSelect
                    locale="en"
                />
                <output>
                    {value?.[0]?.getDate()}–{value?.[1]?.getDate()}
                </output>
            </Modal>
        </>
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
async function render() {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root!.render(withTestLanguage(<Fixture />)))
    await click(document.getElementById('open-modal')!)
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
    const control = dialog.querySelector<HTMLButtonElement>('[aria-label^="Check dates"]')!
    await click(control)
    const calendar = dialog.querySelector<HTMLElement>('[data-modal-select-host] [role="dialog"]')!
    return { dialog, control, calendar }
}
async function escape() {
    await act(async () => {
        document.activeElement!.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
        )
    })
    await flush()
}
afterEach(async () => {
    await act(async () => root?.unmount())
    root = undefined
    document.body.replaceChildren()
})

test('calendar dates stay inside the modal interaction boundary and outside its scrolling body', async () => {
    const { dialog, calendar } = await render()
    expect(calendar).toBeTruthy()
    expect(dialog.contains(calendar)).toBe(true)
    expect(calendar.parentElement?.closest('.overflow-y-auto') === null).toBe(true)
    expect(getComputedStyle(calendar).pointerEvents).not.toBe('none')
    const day = (value: string) =>
        calendar.querySelector<HTMLButtonElement>(`button[aria-label="${value}"]`)!
    await click(day('Select date: Tuesday, October 27, 2026'))
    await click(day('Select date: Thursday, October 29, 2026'))
    expect(dialog.querySelector('output')?.textContent).toBe('27–29')
    expect(calendar.isConnected).toBe(false)
    expect(dialog.isConnected).toBe(true)
})

test('Escape dismisses a modal calendar before its parent and returns focus to the trigger', async () => {
    const { dialog, control, calendar } = await render()
    expect(calendar.contains(document.activeElement)).toBe(true)
    await escape()
    expect(calendar.isConnected).toBe(false)
    expect(dialog.isConnected).toBe(true)
    expect(document.activeElement).toBe(control)
    await escape()
    expect(dialog.isConnected).toBe(false)
    expect(document.activeElement).toBe(document.getElementById('open-modal'))
})
