import type {
    DurationSample,
    MonitoringPeriod,
} from './Types/host-monitoring-presentation.types.ts'

export function monitoringSince(period: MonitoringPeriod, now: number): string | undefined {
    const milliseconds = { recent: 0, hour: 3_600_000, day: 86_400_000, week: 604_800_000 }[period]
    return milliseconds ? new Date(now - milliseconds).toISOString() : undefined
}

export function durationSeries<T extends DurationSample>(
    samples: readonly T[],
): Array<Omit<T, 'durationMs'> & Pick<DurationSample, 'durationMs'>> {
    return samples
        .toSorted((a, b) => a.checkedAt.getTime() - b.checkedAt.getTime())
        .map((sample) =>
            sample.status === 'unknown' ? Object.assign({}, sample, { durationMs: null }) : sample,
        )
}
