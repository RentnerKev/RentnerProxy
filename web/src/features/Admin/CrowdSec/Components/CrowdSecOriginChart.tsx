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
            height={Math.max(180, rows.length * 38 + 68)}
            ariaLabel={label}
        />
    )
}
