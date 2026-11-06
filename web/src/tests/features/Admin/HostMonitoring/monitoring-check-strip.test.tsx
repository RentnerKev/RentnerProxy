import { afterEach, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { Root } from 'react-dom/client'
import { HOST_MONITORING_UI } from '@/config/host-monitoring-ui.config.ts'
import { TOOLTIP_PROVIDER_PROPS } from '@/config/tooltip.config.ts'
import { monitoringCheckSlots } from '@/lib/HostMonitoring/presentation.ts'
import type { HostMonitoringObservationView } from '@/lib/HostMonitoring/Types/host-monitoring-client.types.ts'
import withTestLanguage from '@/tests/Helpers/withTestLanguage.tsx'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { TooltipProvider } = await import('@rentnerkev/tooltips/tooltip')
const { default: MonitoringCheckStrip } =
    await import('@/features/Admin/HostMonitoring/Components/MonitoringCheckStrip.tsx')

let root: Root | undefined
const observations: HostMonitoringObservationView[] = [
    {
        id: 'redirect',
        policyId: 'policy',
        policyVersion: 'version',
        checkedAt: new Date('2026-11-06T14:18:14Z'),
        status: 'healthy',
        code: 'expected_status',
        durationMs: 0,
        httpStatus: 307,
    },
    {
        id: 'timeout',
        policyId: 'policy',
        policyVersion: 'version',
        checkedAt: new Date('2026-11-06T14:17:14Z'),
        status: 'unhealthy',
        code: 'upstream_timeout',
        durationMs: 3000,
        httpStatus: null,
    },
    {
        id: 'unknown',
        policyId: 'policy',
        policyVersion: 'version',
        checkedAt: new Date('2026-11-06T14:16:14Z'),
        status: 'unknown',
        code: 'runtime_unavailable',
        durationMs: null,
        httpStatus: null,
    },
]

async function render(samples: HostMonitoringObservationView[] = observations) {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
        root!.render(
            withTestLanguage(
                <TooltipProvider {...TOOLTIP_PROVIDER_PROPS} delayDuration={0}>
                    <MonitoringCheckStrip
                        slots={monitoringCheckSlots(samples)}
                        formatDate={(date) => date?.toISOString() ?? '—'}
                    />
                </TooltipProvider>,
            ),
        )
    })
}

afterEach(async () => {
    await act(async () => root?.unmount())
    root = undefined
    document.body.replaceChildren()
})

test('missing measurements keep their slots without stretching or fabricating check details', async () => {
    await render([])
    const strip = document.querySelector('ol[aria-label="Recent checks"]')!
    expect(strip.children).toHaveLength(HOST_MONITORING_UI.historySlots)
    expect(
        [...strip.querySelectorAll('li')].filter((slot) => slot.textContent === 'Not checked yet'),
    ).toHaveLength(HOST_MONITORING_UI.historySlots)
    expect(strip.querySelector('button')).toBeNull()
    expect(strip.querySelector('[title]')).toBeNull()
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
})

test('hover shows the actual redirect, duration and timestamp in the themed tooltip', async () => {
    await render()
    const strip = document.querySelector('ol[aria-label="Recent checks"]')!
    expect(strip.children).toHaveLength(HOST_MONITORING_UI.historySlots)
    expect(
        [...strip.querySelectorAll('li')].filter((slot) => slot.textContent === 'Not checked yet'),
    ).toHaveLength(HOST_MONITORING_UI.historySlots - observations.length)
    expect(strip.querySelector('[title]')).toBeNull()
    const trigger = strip.querySelector<HTMLButtonElement>('button[aria-label$="Healthy"]')!
    await act(async () => {
        trigger.dispatchEvent(
            new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse' }),
        )
    })
    const tooltip = document.querySelector('[role="tooltip"]')!
    expect(tooltip).toBeTruthy()
    expect(tooltip.classList.contains('rentnerproxy-tooltip')).toBe(true)
    expect(tooltip.querySelector('time')?.dateTime).toBe('2026-11-06T14:18:14.000Z')
    expect(tooltip.textContent).toContain('Healthy')
    expect(tooltip.textContent).toContain('0 ms')
    expect(tooltip.textContent).toContain('307')
    expect(tooltip.textContent).toContain('Expected HTTP status')
})

test('keyboard focus exposes unknown evidence separately from unmeasured slots', async () => {
    await render()
    const trigger = document.querySelector<HTMLButtonElement>('button[aria-label$="Unknown"]')!
    await act(async () => trigger.focus())
    const tooltip = document.querySelector('[role="tooltip"]')!
    expect(tooltip).toBeTruthy()
    expect(tooltip.querySelector('time')?.dateTime).toBe('2026-11-06T14:16:14.000Z')
    expect([...tooltip.querySelectorAll('dd')].map((cell) => cell.textContent)).toEqual(['—', '—'])
    expect(tooltip.textContent).toContain('Proxy runtime unavailable')
    expect(tooltip.textContent).not.toContain('Not checked yet')
})
