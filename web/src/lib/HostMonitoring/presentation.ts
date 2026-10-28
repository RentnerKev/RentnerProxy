import type {
    DurationPlot,
    DurationSample,
    MonitoringPeriod,
} from './Types/host-monitoring-presentation.types.ts'

export function monitoringSince(period: MonitoringPeriod, now: number): string | undefined {
    const milliseconds = { recent: 0, hour: 3_600_000, day: 86_400_000, week: 604_800_000 }[period]
    return milliseconds ? new Date(now - milliseconds).toISOString() : undefined
}

/** Unknown outcomes break the line: missing evidence must not resemble a measurement. */
export function durationPlot(samples: readonly DurationSample[]): DurationPlot {
    const ordered = samples.toSorted((a, b) => a.checkedAt.getTime() - b.checkedAt.getTime())
    const first = ordered[0]?.checkedAt ?? null
    const last = ordered.at(-1)?.checkedAt ?? null
    const maximum = Math.max(1, ...ordered.map((sample) => sample.durationMs ?? 0))
    const span = Math.max(1, (last?.getTime() ?? 0) - (first?.getTime() ?? 0))
    const paths: string[] = []
    const points: { x: number; y: number; key: string }[] = []
    let path = ''
    for (const sample of ordered) {
        if (sample.status === 'unknown' || sample.durationMs === null) {
            if (path) paths.push(path)
            path = ''
            continue
        }
        const x = 10 + ((sample.checkedAt.getTime() - (first?.getTime() ?? 0)) / span) * 580
        const y = 110 - (sample.durationMs / maximum) * 100
        points.push({ x, y, key: `${sample.checkedAt.getTime()}-${points.length}` })
        path += `${path ? ' L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`
    }
    if (path) paths.push(path)
    return { paths, points, maximum, first, last }
}
