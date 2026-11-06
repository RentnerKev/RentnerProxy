import { HOST_MONITORING_UI } from '@/config/host-monitoring-ui.config.ts'
import type {
    DurationSample,
    MonitoringCheckSlot,
    MonitoringPeriod,
} from './Types/host-monitoring-presentation.types.ts'

export function monitoringCheckSlots<
    T extends Pick<DurationSample, 'checkedAt'> & { readonly id: string },
>(samples: readonly T[]): Array<MonitoringCheckSlot<T>> {
    const recent = samples
        .toSorted((a, b) => a.checkedAt.getTime() - b.checkedAt.getTime())
        .slice(-HOST_MONITORING_UI.historySlots)
    return [
        ...Array.from({ length: HOST_MONITORING_UI.historySlots - recent.length }, (_, index) => ({
            id: `pending-${index}`,
            observation: null,
        })),
        ...recent.map((observation) => ({ id: observation.id, observation })),
    ]
}

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
