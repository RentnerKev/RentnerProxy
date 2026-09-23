import { barX, defineChart } from '@tanstack/charts'
import { scaleBand } from '@tanstack/charts/scales/band'
import { scaleLinear } from '@tanstack/charts/scales/linear'
import { useMemo } from 'react'

import type { CrowdSecOriginCount } from '../../../../shared/Types/crowdsec.types'

export default function useCrowdSecOriginChart(
    rows: readonly CrowdSecOriginCount[],
    color: string,
) {
    return useMemo(
        () =>
            defineChart({
                marks: [
                    barX(rows, {
                        x: 'count',
                        y: 'origin',
                        fill: color,
                        radius: { end: 4 },
                    }),
                ],
                scales: {
                    x: {
                        scale: scaleLinear,
                        nice: true,
                        grid: true,
                        axis: { ticks: { format: (value) => String(value) } },
                    },
                    y: { scale: () => scaleBand().padding(0.25) },
                },
                margin: { left: 100, right: 20, top: 16, bottom: 28 },
                theme: {
                    foreground: 'var(--theme-ink-soft)',
                    muted: 'var(--theme-muted)',
                    grid: 'var(--theme-border)',
                    background: 'transparent',
                },
            }),
        [rows, color],
    )
}
