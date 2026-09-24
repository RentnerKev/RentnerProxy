import { barY, defineChart } from '@tanstack/charts'
import { scaleBand } from '@tanstack/charts/scales/band'
import { scaleLinear } from '@tanstack/charts/scales/linear'
import { tooltip } from '@tanstack/charts/tooltip'
import { useMemo } from 'react'

import useTranslationStore from '../../../../language/useTranslationStore'
import type { CrowdSecOriginCount } from '../../../../shared/Types/crowdsec.types'

export default function useCrowdSecOriginChart(
    rows: readonly CrowdSecOriginCount[],
    color: string,
) {
    const { locale, t } = useTranslationStore()
    const originLabel = t('admin.crowdSec.dashboard.origin')
    const countLabel = t('admin.crowdSec.dashboard.blockedRequests')
    return useMemo(() => {
        const compact = new Intl.NumberFormat(locale, {
            notation: 'compact',
            maximumFractionDigits: 1,
        })
        const exact = new Intl.NumberFormat(locale)
        const hasValues = rows.some((row) => row.count > 0)
        return defineChart({
            marks: [
                barY(rows, {
                    x: 'origin',
                    y: 'count',
                    fill: color,
                    radius: { end: 4 },
                }),
            ],
            scales: {
                x: { scale: () => scaleBand().padding(0.35) },
                y: {
                    scale: () =>
                        scaleLinear().domain([0, Math.max(1, ...rows.map((row) => row.count))]),
                    nice: true,
                    grid: true,
                    axis: {
                        ticks: {
                            ...(hasValues ? {} : { values: [0, 1] }),
                            format: (value) => compact.format(Number(value)),
                        },
                    },
                },
            },
            margin: { left: 50, right: 18, top: 20, bottom: 38 },
            tooltip: {
                use: tooltip,
                items: [
                    { field: 'origin', label: originLabel },
                    {
                        id: 'count',
                        label: countLabel,
                        text: (point) =>
                            `${compact.format(point.datum.count)} (${exact.format(point.datum.count)})`,
                    },
                ],
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
    }, [rows, color, locale, originLabel, countLabel])
}
