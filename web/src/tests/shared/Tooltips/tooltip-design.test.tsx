import { afterEach, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { Root } from 'react-dom/client'

import { TOOLTIP_PROVIDER_PROPS } from '@/config/tooltip.config.ts'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { CustomTooltip, TooltipProvider } = await import('@rentnerkev/tooltips/tooltip')
let root: Root | null = null

afterEach(async () => {
    await act(async () => root?.unmount())
    root = null
    document.body.replaceChildren()
})

test('tooltips inherit the application theme while nested overrides remain scoped', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
        root?.render(
            <TooltipProvider {...TOOLTIP_PROVIDER_PROPS}>
                <CustomTooltip open content={<span data-probe="global">Global design</span>}>
                    <button type="button">Global</button>
                </CustomTooltip>
                <TooltipProvider customDesign={{ baseClasses: 'nested-tooltip-base' }}>
                    <CustomTooltip
                        open
                        content={<span data-probe="nested">Nested design</span>}
                        customDesign={{ contentClasses: 'local-tooltip-content' }}
                    >
                        <button type="button">Nested</button>
                    </CustomTooltip>
                </TooltipProvider>
                <CustomTooltip open content={<span data-probe="sibling">Sibling design</span>}>
                    <button type="button">Sibling</button>
                </CustomTooltip>
            </TooltipProvider>,
        )
    })

    const global = document.querySelector('[data-probe="global"]')?.closest('[data-state]')
    const nested = document.querySelector('[data-probe="nested"]')?.closest('[data-state]')
    const sibling = document.querySelector('[data-probe="sibling"]')?.closest('[data-state]')
    expect(global?.classList.contains('rentnerproxy-tooltip')).toBe(true)
    expect(global?.classList.contains('bg-surface-raised')).toBe(true)
    expect(global?.classList.contains('text-ink')).toBe(true)
    expect(global?.querySelector('svg')?.classList.contains('fill-surface-raised')).toBe(true)
    expect(nested?.classList.contains('nested-tooltip-base')).toBe(true)
    expect(nested?.classList.contains('local-tooltip-content')).toBe(true)
    expect(nested?.classList.contains('rentnerproxy-tooltip')).toBe(false)
    expect(nested?.querySelector('svg')?.classList.contains('fill-surface-raised')).toBe(true)
    expect(sibling?.classList.contains('rentnerproxy-tooltip')).toBe(true)
    expect(sibling?.classList.contains('bg-surface-raised')).toBe(true)
    expect(sibling?.classList.contains('nested-tooltip-base')).toBe(false)
})
