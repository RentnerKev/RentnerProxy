import { Chart } from '@tanstack/charts/react'

import type { CrowdSecOriginCount } from '../../../../shared/Types/crowdsec.types'
import useCrowdSecOriginChart from '../Hooks/useCrowdSecOriginChart'

export default function CrowdSecOriginChart({
    rows,
    label,
    color,
}: {
    readonly rows: readonly CrowdSecOriginCount[]
    readonly label: string
    readonly color: string
}) {
    const definition = useCrowdSecOriginChart(rows, color)

    return (
        <Chart
            definition={definition}
            height={260}
            ariaLabel={label}
            className="[&_svg:focus:not(:focus-visible)]:outline-none [&_svg:focus-visible]:outline-2 [&_svg:focus-visible]:outline-brand-500"
        />
    )
}
