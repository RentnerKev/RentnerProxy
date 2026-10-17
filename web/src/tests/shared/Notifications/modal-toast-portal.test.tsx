import { afterEach, beforeEach, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { Root } from 'react-dom/client'
import type { ToastStore } from '@rentnerkev/toasts/types'

import disableMotionAnimations from '@/tests/Helpers/disableMotionAnimations.ts'
import withTestLanguage from '@/tests/Helpers/withTestLanguage.tsx'
import { TOAST_PROVIDER_PROPS } from '@/config/toast.config.ts'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
disableMotionAnimations()

const { createToastStore, ToastProvider } = await import('@rentnerkev/toasts')
const { act, useState } = await import('react')
const { createRoot } = await import('react-dom/client')
const { Modal } = await import('@/shared/Modal/index.tsx')

let root: Root | null = null
let store: ToastStore

function Fixture() {
    const [parentOpen, setParentOpen] = useState(false)
    const [nestedOpen, setNestedOpen] = useState(false)
    const [saved, setSaved] = useState(false)
    return (
        <>
            <button id="open-parent" onClick={() => setParentOpen(true)}>
                Open parent
            </button>
            <Modal
                open={parentOpen}
                onOpenChange={setParentOpen}
                title="Parent dialog"
                description="Parent actions"
            >
                <button id="open-nested" onClick={() => setNestedOpen(true)}>
                    Open nested
                </button>
            </Modal>
            <Modal
                open={nestedOpen}
                onOpenChange={setNestedOpen}
                title="Nested dialog"
                description="Nested actions"
                footer={
                    <button id="nested-action" onClick={() => setSaved(true)}>
                        Save nested
                    </button>
                }
            >
                <input aria-label="Nested field" />
                {saved ? <output>Nested saved</output> : null}
            </Modal>
            <ToastProvider
                {...TOAST_PROVIDER_PROPS}
                store={store}
                locale="en"
                messages={{
                    regionLabel: 'Notifications',
                    closeNotification: 'Dismiss notification',
                }}
            >
                {null}
            </ToastProvider>
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

function region(): HTMLElement {
    const regions = document.querySelectorAll<HTMLElement>('section[aria-label="Notifications"]')
    expect(regions).toHaveLength(1)
    return regions[0]!
}

beforeEach(async () => {
    store = createToastStore()
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(withTestLanguage(<Fixture />)))
})

afterEach(async () => {
    await act(async () => root?.unmount())
    root = null
    store.dispose()
    document.body.replaceChildren()
})

test('persistent errors stay outside dialogs, remain accessible and dismiss without closing them', async () => {
    await act(async () => {
        store.toast.error('Certificate could not be applied.', { duration: 0 })
    })
    const toastRegion = region()
    expect(toastRegion.parentElement).toBe(document.body)
    await click(document.getElementById('open-parent')!)
    const dialog = document.querySelector('[role="dialog"]')!
    expect(dialog.textContent).toContain('Parent dialog')
    expect(region()).toBe(toastRegion)
    expect(region().parentElement).toBe(document.body)
    expect(toastRegion.closest('[role="dialog"]')).toBeNull()
    expect(document.querySelector('[data-modal-toast-host]')).toBeNull()
    expect(toastRegion.closest('[aria-hidden="true"]')).toBeNull()
    const dismiss = toastRegion.querySelector<HTMLButtonElement>(
        'button[aria-label="Dismiss notification"]',
    )!
    await act(async () => dismiss.focus())
    expect(document.activeElement).toBe(dismiss)
    await act(async () => document.getElementById('open-parent')!.focus())
    expect(document.activeElement).toBe(dismiss)
    await act(async () => document.getElementById('open-nested')!.focus())
    expect(dialog.contains(document.activeElement)).toBeTrue()
    await click(dismiss)
    expect(store.getToastSnapshot()).toHaveLength(0)
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    expect(document.querySelector('section[aria-label="Notifications"]')).toBeNull()
    expect(dialog.contains(document.activeElement)).toBeTrue()
})

test('nested dialogs keep one stable global stack and retain their own focus and actions', async () => {
    await act(async () => {
        store.toast.error('First persistent failure', { duration: 0 })
        store.toast.error('Second persistent failure', { duration: 0 })
    })
    const original = store
        .getToastSnapshot()
        .map(({ id, createdAt, duration }) => ({ id, createdAt, duration }))
    const toastRegion = region()
    await click(document.getElementById('open-parent')!)
    await click(document.getElementById('open-nested')!)
    const nested = [...document.querySelectorAll('[role="dialog"]')].at(-1)!
    expect(nested.textContent).toContain('Nested dialog')
    expect(region()).toBe(toastRegion)
    expect(region().closest('[role="dialog"]')).toBeNull()
    expect(region().closest('[aria-hidden="true"]')).toBeNull()
    expect(region().querySelectorAll('[role="alert"]')).toHaveLength(2)
    const dismiss = region().querySelector<HTMLButtonElement>(
        'button[aria-label="Dismiss notification"]',
    )!
    await act(async () => dismiss.focus())
    expect(document.activeElement).toBe(dismiss)
    const action = nested.querySelector<HTMLButtonElement>('#nested-action')!
    await act(async () => action.focus())
    expect(document.activeElement).toBe(action)
    await click(action)
    expect(nested.textContent).toContain('Nested saved')
    expect(region().querySelectorAll('[role="alert"]')).toHaveLength(2)
    await click(nested.querySelector<HTMLButtonElement>('button[aria-label="Close dialog"]')!)
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Parent dialog')
    expect(region()).toBe(toastRegion)
    await click(
        document.querySelector<HTMLButtonElement>(
            '[role="dialog"] button[aria-label="Close dialog"]',
        )!,
    )
    expect(region().parentElement).toBe(document.body)
    expect(
        store
            .getToastSnapshot()
            .map(({ id, createdAt, duration }) => ({ id, createdAt, duration })),
    ).toEqual(original)
})

test('opening a modal does not restart timed messages or expire persistent failures', async () => {
    await act(async () => {
        store.toast.error('Persistent failure', { duration: 0 })
        store.toast.success('Short success', { duration: 500 })
    })
    const success = store.getToastSnapshot().find((toast) => toast.type === 'success')!
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 200))
    })
    await click(document.getElementById('open-parent')!)
    const moved = store.getToastSnapshot().find((toast) => toast.id === success.id)!
    expect(moved.createdAt).toBe(success.createdAt)
    expect(moved.duration).toBe(success.duration)
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 350))
    })
    expect(store.getToastSnapshot().map((toast) => toast.content)).toEqual(['Persistent failure'])
    expect(region().textContent).toContain('Persistent failure')
})

test('the direct provider expires hidden notifications while retaining persistent errors', async () => {
    expect(store.getToastDefaults().pauseWhenQueued).toBe(false)
    await act(async () => {
        store.toast.info('Queued short notification', { duration: 200 })
        for (let index = 1; index <= 3; index++) {
            store.toast.error(`Persistent failure ${index}`, { duration: 0 })
        }
    })
    expect(store.getToastSnapshot()).toHaveLength(4)
    expect(region().textContent).not.toContain('Queued short notification')
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 250))
    })
    expect(store.getToastSnapshot()).toHaveLength(3)
    expect(store.getToastSnapshot().every((toast) => toast.duration === 0)).toBeTrue()
    expect(region().querySelectorAll('[role="alert"]')).toHaveLength(3)
})
