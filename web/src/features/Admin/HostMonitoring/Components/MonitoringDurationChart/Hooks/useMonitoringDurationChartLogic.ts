import { crosshair, defineChart, lineY } from '@tanstack/charts'
import { scaleLinear } from '@tanstack/charts/scales/linear'
import { tooltip } from '@tanstack/charts/tooltip'
import { portal } from '@tanstack/charts/tooltip/portal'
import { useMemo } from 'react'
import { durationSeries } from '@/lib/HostMonitoring/presentation.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type { MonitoringDurationChartProps } from '../Types/duration-chart.types.ts'

const tooltipClassName = String.raw`[--ts-chart-tooltip-background:var(--theme-surface-raised)] [--ts-chart-tooltip-color:var(--theme-ink-soft)] [--ts-chart-tooltip-border:1px_solid_var(--theme-border-strong)] [--ts-chart-tooltip-border-radius:0.75rem] [--ts-chart-tooltip-shadow:var(--shadow-surface)] [--ts-chart-tooltip-padding:0.75rem] [&_.ts-chart-tooltip\_\_rows]:grid [&_.ts-chart-tooltip\_\_rows]:gap-1.5 [&_.ts-chart-tooltip\_\_row:first-child>span:last-child]:font-mono [&_.ts-chart-tooltip\_\_row:first-child>span:last-child]:text-lg [&_.ts-chart-tooltip\_\_row:first-child>span:last-child]:font-bold`

export default function useMonitoringDurationChartLogic(
    observations: MonitoringDurationChartProps['observations'],
) {
    const { t, locale } = useTranslationStore()
    const definition = useMemo(() => {
        const rows = durationSeries(observations)
        const first = rows[0]?.checkedAt.getTime() ?? 0
        const last = rows.at(-1)?.checkedAt.getTime() ?? 1
        const maximum = Math.max(1, ...rows.map((row) => row.durationMs ?? 0))
        const time = new Intl.DateTimeFormat(locale, {
            ...(last - first > 86_400_000 ? ({ day: 'numeric', month: 'short' } as const) : {}),
            hour: '2-digit',
            minute: '2-digit',
        })
        const date = new Intl.DateTimeFormat(locale, {
            dateStyle: 'medium',
            timeStyle: 'medium',
        })
        const milliseconds = new Intl.NumberFormat(locale, {
            style: 'unit',
            unit: 'millisecond',
            unitDisplay: 'short',
            maximumFractionDigits: 0,
        })
        return defineChart({
            marks: [
                lineY(rows, {
                    id: 'monitoring-duration',
                    key: 'id',
                    x: (row) => row.checkedAt.getTime(),
                    y: 'durationMs',
                    points: true,
                    stroke: 'var(--color-brand-500)',
                    strokeWidth: 2,
                }),
                crosshair({
                    x: true,
                    y: false,
                    stroke: 'var(--theme-muted)',
                    strokeDasharray: '3 4',
                }),
            ],
            scales: {
                x: {
                    scale: () => scaleLinear().domain([first, last]),
                    axis: { ticks: { count: 4, format: (value) => time.format(Number(value)) } },
                },
                y: {
                    scale: () => scaleLinear().domain([0, maximum]),
                    nice: true,
                    grid: true,
                    axis: {
                        ticks: {
                            ...(maximum <= 1 ? { values: [0, 1] } : { count: 4 }),
                            format: (value) => milliseconds.format(Number(value)),
                        },
                    },
                },
            },
            margin: { left: 65, right: 15, top: 12, bottom: 30 },
            focus: 'nearest-x',
            tooltip: {
                use: tooltip,
                portal,
                className: tooltipClassName,
                content: (points) => {
                    const row = points[0]?.datum
                    if (!row || row.durationMs === null) return { rows: [] }
                    return {
                        title: date.format(row.checkedAt),
                        rows: [
                            {
                                label: t('admin.hostMonitoring.duration'),
                                value: milliseconds.format(row.durationMs),
                                color:
                                    row.status === 'unhealthy'
                                        ? 'var(--theme-danger-text)'
                                        : 'var(--color-brand-500)',
                            },
                            {
                                label: t('admin.hostMonitoring.status'),
                                value: t(`admin.hostMonitoring.states.${row.status}`),
                            },
                            {
                                label: t('admin.hostMonitoring.httpStatus'),
                                value: String(row.httpStatus ?? '—'),
                            },
                        ],
                    }
                },
            },
            focusRing: {
                fill: 'var(--theme-surface-raised)',
                stroke: 'var(--color-brand-500)',
                strokeWidth: 2,
            },
            theme: {
                foreground: 'var(--theme-ink-soft)',
                muted: 'var(--theme-muted)',
                grid: 'var(--theme-border)',
                background: 'transparent',
            },
        })
    }, [observations, locale, t])
    return {
        state: {
            definition,
            title: t('admin.hostMonitoring.chart'),
            description: t('admin.hostMonitoring.chartDescription'),
        },
    }
}
