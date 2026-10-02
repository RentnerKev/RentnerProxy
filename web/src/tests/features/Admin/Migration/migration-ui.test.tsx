import { afterEach, expect, spyOn, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { Root } from 'react-dom/client'

import { INPUT_PROVIDER_PROPS } from '@/config/input.config.ts'
import { TOAST_PROVIDER_PROPS } from '@/config/toast.config.ts'
import { TOOLTIP_PROVIDER_PROPS } from '@/config/tooltip.config.ts'
import disableMotionAnimations from '@/tests/Helpers/disableMotionAnimations.ts'
import withTestLanguage from '@/tests/Helpers/withTestLanguage.tsx'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
disableMotionAnimations()

const { InputProvider } = await import('@rentnerkev/inputs')
const { SelectProvider } = await import('@rentnerkev/select')
const { ToastProvider } = await import('@rentnerkev/toasts')
const { toast } = await import('@rentnerkev/toasts/toast')
const { TooltipProvider } = await import('@rentnerkev/tooltips/tooltip')
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { default: MigrationPage } = await import('@/features/Admin/Migration/MigrationPage.tsx')

let root: Root | null = null
const fetchMock = spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response('[]', { headers: { 'Content-Type': 'application/json' } }),
)

async function render(): Promise<HTMLElement> {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
        root?.render(
            withTestLanguage(
                <TooltipProvider {...TOOLTIP_PROVIDER_PROPS}>
                    <InputProvider {...INPUT_PROVIDER_PROPS} locale="en">
                        <SelectProvider locale="en" searchable={false}>
                            <ToastProvider {...TOAST_PROVIDER_PROPS} locale="en">
                                <MigrationPage />
                            </ToastProvider>
                        </SelectProvider>
                    </InputProvider>
                </TooltipProvider>,
            ),
        )
    })
    return container
}

async function key(element: HTMLElement, value: string): Promise<void> {
    await act(async () => {
        element.focus()
        element.dispatchEvent(
            new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }),
        )
        await new Promise((resolve) => setTimeout(resolve, 20))
    })
}

afterEach(async () => {
    await act(async () => root?.unmount())
    root = null
    toast.dismissAll()
    fetchMock.mockClear()
    document.body.replaceChildren()
})

test('source selection resets the file and uses the shared input and feedback components', async () => {
    const container = await render()
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')!
    const preview = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
        (button) => button.textContent?.trim() === 'Analyze and preview',
    )!
    expect(fileInput.accept).toContain('.json')
    expect(fileInput.className).toContain('file:mr-3')
    expect(fileInput.getAttribute('aria-describedby')).toBe('migration-source-help')
    expect(preview.disabled).toBe(true)

    Object.defineProperty(fileInput, 'files', {
        configurable: true,
        value: [new File([new Uint8Array(4 * 1024 * 1024 + 1)], 'too-large.json')],
    })
    await act(async () => fileInput.dispatchEvent(new Event('change', { bubbles: true })))
    expect(preview.disabled).toBe(false)

    await act(async () => preview.click())
    expect(
        container.querySelector('section[aria-labelledby="migration-source-title"] [role="alert"]')
            ?.textContent,
    ).toContain('exceeds the limit')
    expect(document.querySelector('.rentnerproxy-toast-error')?.textContent).toContain(
        'exceeds the limit',
    )

    const source = container.querySelector<HTMLButtonElement>('[role="combobox"]')!
    expect(source.getAttribute('aria-label')).toBe('Source system')
    expect(source.getAttribute('aria-describedby')).toBe('migration-source-help')
    await key(source, 'Enter')
    const zoraxy = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
        (option) => option.textContent?.trim() === 'Zoraxy',
    )!
    await key(zoraxy, 'Enter')

    expect(source.textContent).toContain('Zoraxy')
    expect(container.textContent).toContain('official Zoraxy version 3 configuration ZIP')
    expect(container.querySelector<HTMLInputElement>('input[type="file"]')?.accept).toContain(
        '.zip',
    )
    expect(preview.disabled).toBe(true)
    expect(
        container.querySelector('section[aria-labelledby="migration-source-title"] [role="alert"]'),
    ).toBeNull()
})
