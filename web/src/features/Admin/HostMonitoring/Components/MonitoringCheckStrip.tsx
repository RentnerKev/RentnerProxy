import { CustomTooltip } from '@rentnerkev/tooltips/tooltip'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import HostAvailabilityBadge from './HostAvailabilityBadge.tsx'
import type {
    MonitoringDialogHandler,
    MonitoringDialogState,
} from '../Types/host-monitoring-dialog.types.ts'

export default function MonitoringCheckStrip({
    slots,
    formatDate,
}: {
    readonly slots: MonitoringDialogState['checkSlots']
    readonly formatDate: MonitoringDialogHandler['formatDate']
}) {
    const { t } = useTranslationStore()
    return (
        <ol
            aria-label={t('admin.hostMonitoring.observations')}
            className="m-0 flex min-w-0 list-none gap-1 p-0"
        >
            {slots.map(({ id, observation }) => (
                <li key={id} className="min-w-0 flex-1">
                    {observation ? (
                        <CustomTooltip
                            collisionPadding={12}
                            content={
                                <div className="grid justify-items-start gap-2 text-left">
                                    <time dateTime={observation.checkedAt.toISOString()}>
                                        {formatDate(observation.checkedAt)}
                                    </time>
                                    <HostAvailabilityBadge availability={observation.status} />
                                    <dl className="m-0 grid grid-cols-[auto_auto] gap-x-4 gap-y-1">
                                        <dt className="text-muted">
                                            {t('admin.hostMonitoring.duration')}
                                        </dt>
                                        <dd className="m-0 text-right font-mono">
                                            {observation.durationMs === null
                                                ? '—'
                                                : `${observation.durationMs} ms`}
                                        </dd>
                                        <dt className="text-muted">
                                            {t('admin.hostMonitoring.httpStatus')}
                                        </dt>
                                        <dd className="m-0 text-right font-mono">
                                            {observation.httpStatus ?? '—'}
                                        </dd>
                                    </dl>
                                    <span>
                                        {t(`admin.hostMonitoring.codes.${observation.code}`)}
                                    </span>
                                </div>
                            }
                        >
                            <button
                                type="button"
                                aria-label={`${formatDate(observation.checkedAt)} · ${t(`admin.hostMonitoring.states.${observation.status}`)}`}
                                className={`block h-7 w-full cursor-default rounded-sm border-0 p-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring ${observation.status === 'healthy' ? 'bg-success-text' : observation.status === 'unhealthy' ? 'bg-danger-text' : 'bg-border-strong'}`}
                            />
                        </CustomTooltip>
                    ) : (
                        <span className="block h-7 rounded-sm border border-border bg-surface-hover">
                            <span className="sr-only">
                                {t('admin.hostMonitoring.states.not_checked')}
                            </span>
                        </span>
                    )}
                </li>
            ))}
        </ol>
    )
}
