import { Chart } from '@tanstack/charts/react'
import useMonitoringDurationChartLogic from './Hooks/useMonitoringDurationChartLogic.ts'
import type { MonitoringDurationChartProps } from './Types/duration-chart.types.ts'

export default function MonitoringDurationChart({ observations }: MonitoringDurationChartProps) {
    const { state } = useMonitoringDurationChartLogic(observations)
    return (
        <figure className="m-0 grid min-w-0 gap-2">
            <figcaption className="text-sm font-bold">{state.title}</figcaption>
            <Chart
                definition={state.definition}
                height={180}
                ariaLabel={state.title}
                ariaDescription={state.description}
                className="rounded-xl bg-surface-raised [&_svg:focus:not(:focus-visible)]:outline-none [&_svg:focus-visible]:outline-2 [&_svg:focus-visible]:outline-accent-ring"
            />
        </figure>
    )
}
