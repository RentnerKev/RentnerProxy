import { Chart } from '@tanstack/charts/react'
import { CustomTooltip } from '@rentnerkev/tooltips/tooltip'

import { TOOLTIP_DEFAULT_PROPS } from '../../../../config/tooltip.config'
import useTranslationStore from '../../../../language/useTranslationStore'
import type { CrowdSecOriginCount } from '../../../../shared/Types/crowdsec.types'
import useCrowdSecDecisionChart, { decisionPalette } from '../Hooks/useCrowdSecDecisionChart'

export default function CrowdSecDecisionChart({
    rows,
    label,
}: {
    readonly rows: readonly CrowdSecOriginCount[]
    readonly label: string
}) {
    const { locale, t } = useTranslationStore()
    const visible = rows.filter((row) => row.count > 0)
    const definition = useCrowdSecDecisionChart(rows)
    const compact = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 })
    const exact = new Intl.NumberFormat(locale)
    const total = visible.reduce((sum, row) => sum + row.count, 0)
    return (
        <div className="grid min-h-[260px] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(9rem,0.8fr)]">
            <div className="relative min-w-0">
                <Chart
                    definition={definition}
                    height={260}
                    ariaLabel={label}
                    className="[&_svg:focus:not(:focus-visible)]:outline-none [&_svg:focus-visible]:outline-2 [&_svg:focus-visible]:outline-brand-500"
                />
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <span
                        className="font-display text-2xl text-ink tabular-nums"
                        aria-label={exact.format(total)}
                    >
                        {compact.format(total)}
                    </span>
                    <span className="text-[0.65rem] font-bold tracking-wider text-muted uppercase">
                        {t('admin.crowdSec.dashboard.sources', { count: visible.length })}
                    </span>
                </div>
            </div>
            <ul className="grid max-h-64 gap-2 overflow-y-auto py-2 text-xs">
                {visible.map((row, index) => (
                    <li
                        key={row.origin}
                        className="flex items-center justify-between gap-2 text-muted"
                    >
                        <span className="flex min-w-0 items-center gap-2">
                            <span
                                className="size-2 shrink-0 rounded-full"
                                style={{
                                    background: decisionPalette[index % decisionPalette.length],
                                }}
                                aria-hidden="true"
                            />
                            <span className="truncate">{row.origin}</span>
                        </span>
                        <CustomTooltip {...TOOLTIP_DEFAULT_PROPS} content={exact.format(row.count)}>
                            <span
                                className="shrink-0 font-bold text-ink-soft tabular-nums"
                                aria-label={exact.format(row.count)}
                            >
                                {compact.format(row.count)}
                            </span>
                        </CustomTooltip>
                    </li>
                ))}
            </ul>
        </div>
    )
}
