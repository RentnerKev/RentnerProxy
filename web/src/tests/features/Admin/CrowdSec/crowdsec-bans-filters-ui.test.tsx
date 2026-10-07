import { afterEach, expect, mock, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { Root } from 'react-dom/client'

import { INPUT_PROVIDER_PROPS } from '@/config/input.config.ts'
import disableMotionAnimations from '@/tests/Helpers/disableMotionAnimations.ts'
import withTestLanguage from '@/tests/Helpers/withTestLanguage.tsx'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
disableMotionAnimations()

const { InputProvider } = await import('@rentnerkev/inputs')
const { SelectProvider } = await import('@rentnerkev/select')
const { TooltipProvider } = await import('@rentnerkev/tooltips/tooltip')
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { default: CrowdSecBansTable } =
    await import('@/features/Admin/CrowdSec/Components/CrowdSecBansTable/index.tsx')

let root: Root | null = null

afterEach(async () => {
    await act(async () => root?.unmount())
    root = null
    document.body.replaceChildren()
})

async function key(element: HTMLElement, value: string): Promise<void> {
    await act(async () => {
        element.focus()
        element.dispatchEvent(
            new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }),
        )
        await new Promise((resolve) => setTimeout(resolve, 20))
    })
}

test('keyboard origin and scope filters offer the right options and preserve selected values', async () => {
    const onOriginChange = mock((_value: string) => undefined)
    const onScopeChange = mock((_value: string) => undefined)
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
        root?.render(
            withTestLanguage(
                <TooltipProvider>
                    <InputProvider {...INPUT_PROVIDER_PROPS} locale="en">
                        <SelectProvider locale="en" searchable={false}>
                            <CrowdSecBansTable
                                decisions={null}
                                origins={['crowdsec', 'CAPI']}
                                filters={{
                                    searchInput: '',
                                    origin: '',
                                    scope: '',
                                    pageIndex: 0,
                                    pageSize: 25,
                                }}
                                isLoading={false}
                                onSearchChange={() => undefined}
                                onOriginChange={onOriginChange}
                                onScopeChange={onScopeChange}
                                onPageChange={() => undefined}
                                onPageSizeChange={() => undefined}
                            />
                        </SelectProvider>
                    </InputProvider>
                </TooltipProvider>,
            ),
        )
    })
    await act(async () =>
        container.querySelector<HTMLButtonElement>('button[aria-expanded]')!.click(),
    )
    const [origin, scope] = [...container.querySelectorAll<HTMLElement>('[role="combobox"]')]
    await key(origin!, 'Enter')
    let options = [...document.querySelectorAll<HTMLElement>('[role="option"]')]
    expect(options.map((option) => option.textContent)).toContain('CAPI')
    expect(options.map((option) => option.textContent)).not.toContain('IP address')
    await key(
        options.find((option) => option.textContent?.trim() === 'CAPI')!,
        'Enter',
    )
    expect(onOriginChange).toHaveBeenCalledWith('CAPI')
    await key(scope!, 'Enter')
    options = [...document.querySelectorAll<HTMLElement>('[role="option"]')]
    expect(options.some((option) => option.textContent?.includes('CAPI'))).toBeFalse()
    const range = options.find(
        (option) =>
            option.getAttribute('data-value') === 'Range' || option.textContent?.includes('range'),
    )!
    expect(range).toBeDefined()
    await key(range, 'Enter')
    expect(onScopeChange).toHaveBeenCalledWith('Range')
})
