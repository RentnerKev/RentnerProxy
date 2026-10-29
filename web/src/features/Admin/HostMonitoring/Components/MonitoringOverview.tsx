import { CustomSelect } from '@rentnerkev/select/select'
import { buttonClassName } from '@/shared/Buttons/buttonStyles.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import MonitoringDurationChart from './MonitoringDurationChart/index.tsx'
import MonitoringChecksTable from './MonitoringChecksTable/index.tsx'
import HostAvailabilityBadge from './HostAvailabilityBadge.tsx'
import TableFilterSelect from '@/shared/Table/Components/TableFilterSelect.tsx'
import type {
    MonitoringDialogHandler,
    MonitoringDialogState,
} from '../Types/host-monitoring-dialog.types.ts'

export default function MonitoringOverview({
    state,
    handler,
}: {
    readonly state: MonitoringDialogState
    readonly handler: MonitoringDialogHandler
}) {
    const { t } = useTranslationStore()
    return (
        <div className="grid min-w-0 gap-5">
            {!state.policy ? (
                <div className="grid justify-items-start gap-3 py-4">
                    <p className="m-0 text-sm text-muted">{t('admin.hostMonitoring.noPolicy')}</p>
                    {state.canUpdate ? (
                        <button
                            type="button"
                            className={buttonClassName('secondary')}
                            onClick={() => handler.handleTab('settings')}
                        >
                            {t('admin.hostMonitoring.configure')}
                        </button>
                    ) : null}
                </div>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
                <TableFilterSelect
                    label={t('admin.hostMonitoring.status')}
                    aria-label={t('admin.hostMonitoring.status')}
                    options={(['all', 'healthy', 'unhealthy', 'unknown'] as const).map((value) => ({
                        value,
                        label: t(
                            value === 'all'
                                ? 'admin.hostMonitoring.all'
                                : `admin.hostMonitoring.states.${value}`,
                        ),
                        content:
                            value === 'all' ? undefined : (
                                <HostAvailabilityBadge availability={value} />
                            ),
                    }))}
                    searchable={false}
                    value={state.status}
                    onValueChange={handler.handleStatus}
                />
                <CustomSelect
                    label={t('admin.hostMonitoring.period')}
                    aria-label={t('admin.hostMonitoring.period')}
                    options={(['recent', 'hour', 'day', 'week'] as const).map((value) => ({
                        value,
                        label: t(`admin.hostMonitoring.${value}`),
                    }))}
                    value={state.period}
                    onValueChange={handler.handlePeriod}
                />
            </div>
            {state.historyError ? (
                <div
                    role="alert"
                    className="grid justify-items-start gap-2 text-sm text-danger-text"
                >
                    <p>{t('admin.hostMonitoring.loadError')}</p>
                    <button
                        type="button"
                        className={buttonClassName('secondary')}
                        onClick={handler.handleRetry}
                    >
                        {t('admin.hostMonitoring.retry')}
                    </button>
                </div>
            ) : state.historyLoading ? (
                <output className="text-sm text-muted">{t('admin.hostMonitoring.loading')}</output>
            ) : (
                <>
                    {state.observations.length > 0 ? (
                        <>
                            <MonitoringDurationChart observations={state.observations} />
                            <div
                                className="flex gap-1 overflow-hidden"
                                aria-label={t('admin.hostMonitoring.observations')}
                            >
                                {state.observations
                                    .slice(0, 40)
                                    .toReversed()
                                    .map((observation) => (
                                        <span
                                            key={observation.id}
                                            title={`${handler.formatDate(observation.checkedAt)} · ${t(`admin.hostMonitoring.states.${observation.status}`)}`}
                                            className={`h-5 min-w-1 flex-1 rounded-sm ${observation.status === 'healthy' ? 'bg-success-text' : observation.status === 'unhealthy' ? 'bg-danger-text' : 'bg-border-strong'}`}
                                        >
                                            <span className="sr-only">
                                                {t(
                                                    `admin.hostMonitoring.states.${observation.status}`,
                                                )}
                                            </span>
                                        </span>
                                    ))}
                            </div>
                        </>
                    ) : null}
                    <MonitoringChecksTable
                        key={`${state.status}:${state.period}`}
                        observations={state.observations}
                        more={state.more}
                        loadingMore={state.loadingMore}
                        onLoadMore={handler.handleMore}
                    />
                </>
            )}
        </div>
    )
}
