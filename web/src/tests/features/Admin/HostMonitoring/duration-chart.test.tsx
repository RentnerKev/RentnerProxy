import { afterEach, expect, spyOn, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { Root } from 'react-dom/client'
import type { ChartRenderContext } from '@tanstack/charts'
import type { HostMonitoringObservationView } from '@/lib/HostMonitoring/Types/host-monitoring-client.types.ts'
import withTestLanguage from '@/tests/Helpers/withTestLanguage.tsx'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { Chart } = await import('@tanstack/charts/react')
const { default: useMonitoringDurationChartLogic } =
    await import('@/features/Admin/HostMonitoring/Components/MonitoringDurationChart/Hooks/useMonitoringDurationChartLogic.ts')

const base = Date.parse('2026-10-29T12:00:00.000Z')
let root: Root | null = null
let rendered: ChartRenderContext<HostMonitoringObservationView, number, number> | null = null
const spies: { mockRestore: () => void }[] = []

function sample(
    index: number,
    durationMs: number | null,
    status: 'healthy' | 'unhealthy' | 'unknown' = 'healthy',
): HostMonitoringObservationView {
    return {
        id: `018f2f52-7c1b-7cc0-9f3c-${String(index).padStart(12, '0')}`,
        policyId: '018f2f52-7c1b-7cc0-9f3c-6a9952c54022',
        policyVersion: '018f2f52-7c1b-7cc0-9f3c-6a9952c54023',
        checkedAt: new Date(base + index * 60_000),
        status,
        code:
            status === 'unknown'
                ? 'runtime_unavailable'
                : status === 'unhealthy'
                  ? 'unexpected_status'
                  : 'expected_status',
        durationMs,
        httpStatus: status === 'unknown' ? null : status === 'unhealthy' ? 503 : 200,
    }
}

function captureChart(context: ChartRenderContext<HostMonitoringObservationView, number, number>) {
    rendered = context
}

function Harness({
    observations,
}: {
    readonly observations: readonly HostMonitoringObservationView[]
}) {
    const { state } = useMonitoringDurationChartLogic(observations)
    return (
        <Chart
            definition={state.definition}
            width={640}
            height={180}
            ariaLabel={state.title}
            ariaDescription={state.description}
            onRender={captureChart}
        />
    )
}

async function flush() {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20))
    })
}

async function render(observations: readonly HostMonitoringObservationView[]) {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root!.render(withTestLanguage(<Harness observations={observations} />)))
    await flush()
    expect(rendered).not.toBeNull()
    return rendered!
}

function tooltipText() {
    return (
        document.querySelector('.ts-chart-tooltip:not([hidden])')?.getAttribute('aria-label') ?? ''
    )
}

afterEach(async () => {
    await act(async () => root?.unmount())
    root = null
    rendered = null
    spies.splice(0).forEach((spy) => spy.mockRestore())
    document.body.replaceChildren()
})

test('TanStack pointer inspection shows exact duration, time, health and HTTP status', async () => {
    const context = await render([
        sample(3, 2_300, 'unhealthy'),
        sample(2, null, 'unknown'),
        sample(1, 40),
    ])
    const point = context.scene.points.find((entry) => entry.datum.id === sample(3, 2_300).id)!
    expect(context.scene.points).toHaveLength(2)
    spies.push(
        spyOn(context.svg, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 640, 180)),
    )
    await act(async () => {
        context.svg.dispatchEvent(
            new PointerEvent('pointermove', {
                bubbles: true,
                pointerType: 'mouse',
                clientX: point.x,
                clientY: point.y,
            }),
        )
    })
    await flush()
    expect(tooltipText()).toContain('2,300 ms')
    expect(tooltipText()).toContain('Unhealthy')
    expect(tooltipText()).toContain('HTTP status: 503')
    expect(tooltipText()).toContain(
        new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'medium' }).format(
            sample(3, 2_300).checkedAt,
        ),
    )
})

test('TanStack keyboard navigation skips missing measurements and Escape dismisses the tooltip', async () => {
    const context = await render([
        sample(3, 2_300, 'unhealthy'),
        sample(2, null, 'unknown'),
        sample(1, 0),
    ])
    spies.push(
        spyOn(context.svg, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 640, 180)),
    )
    await act(async () => context.svg.dispatchEvent(new FocusEvent('focusin', { bubbles: true })))
    await flush()
    expect(tooltipText()).toContain('0 ms')
    await act(async () =>
        context.svg.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
        ),
    )
    await flush()
    expect(tooltipText()).toContain('2,300 ms')
    await act(async () =>
        context.svg.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
        ),
    )
    await act(async () =>
        context.svg.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
        ),
    )
    await flush()
    expect(tooltipText()).toBe('')
})

test('unknown-only data has no artificial zero-duration markers or tooltip', async () => {
    const context = await render([sample(1, 40, 'unknown'), sample(2, null, 'unknown')])
    expect(context.scene.points).toHaveLength(0)
    await act(async () =>
        context.svg.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }),
        ),
    )
    await flush()
    expect(tooltipText()).toBe('')
    expect(context.svg.outerHTML).not.toContain('NaN')
})
