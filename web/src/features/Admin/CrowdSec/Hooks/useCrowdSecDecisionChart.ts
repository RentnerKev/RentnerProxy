import { defineChart } from '@tanstack/charts'
import { pie, polar, radialArc } from '@tanstack/charts/polar'
import { tooltip } from '@tanstack/charts/tooltip'
import { useMemo } from 'react'

import useTranslationStore from '../../../../language/useTranslationStore'
import type { CrowdSecOriginCount } from '../../../../shared/Types/crowdsec.types'

export const decisionPalette = [
    'var(--color-brand-500)',
    '#82b7ff',
    '#f3b968',
    '#bf9cff',
    '#f18b9c',
    '#78d9c5',
    '#e9df82',
    '#91a4b8',
    '#d5a1c8',
    '#b1db7c',
    '#df9d79',
    '#a7a7e6',
] as const

export default function useCrowdSecDecisionChart(rows: readonly CrowdSecOriginCount[]) {
    const { locale, t } = useTranslationStore()
    const originLabel = t('admin.crowdSec.dashboard.origin')
    const countLabel = t('admin.crowdSec.dashboard.activeDecisions')
    return useMemo(() => {
        const visible = rows.filter((row) => row.count > 0)
        const compact = new Intl.NumberFormat(locale, {
            notation: 'compact',
            maximumFractionDigits: 1,
        })
        const exact = new Intl.NumberFormat(locale)
        return defineChart({
            marks: [
                polar({
                    inset: 8,
                    radiusRatio: 0.9,
                    marks: [
                        radialArc(pie(visible, { value: 'count' }), {
                            innerRadius: ({ radius }) => radius * 0.62,
                            cornerRadius: 3,
                            color: 'origin',
                            key: 'origin',
                        }),
                    ],
                    scales: { angle: null, radius: null },
                }),
            ],
            scales: { x: null, y: null },
            color: {
                domain: visible.map((row) => row.origin),
                range: [...decisionPalette],
            },
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
    }, [rows, locale, originLabel, countLabel])
}
