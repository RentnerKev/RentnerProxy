import { CustomSelect } from '@rentnerkev/select/select'
import { buttonClassName } from '@/shared/Buttons/buttonStyles.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import HostAvailabilityBadge from './HostAvailabilityBadge.tsx'
import MonitoringDurationChart from './MonitoringDurationChart/index.tsx'
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
            ) : (
                <div className="flex flex-wrap gap-x-6 gap-y-2 border-y border-border py-3 text-xs">
                    <span>
                        {t('admin.hostMonitoring.checkedAt')}:{' '}
                        <time dateTime={state.policy.lastCheckedAt?.toISOString()}>
                            {handler.formatDate(state.policy.lastCheckedAt)}
                        </time>
                    </span>
                    <span>
                        {t('admin.hostMonitoring.duration')}:{' '}
                        {state.policy.lastDurationMs === null
                            ? '—'
                            : `${state.policy.lastDurationMs} ms`}
                    </span>
                    <span>
                        {t('admin.hostMonitoring.httpStatus')}: {state.policy.lastHttpStatus ?? '—'}
                    </span>
                </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
                <CustomSelect
                    label={t('admin.hostMonitoring.status')}
                    aria-label={t('admin.hostMonitoring.status')}
                    options={(['all', 'healthy', 'unhealthy', 'unknown'] as const).map((value) => ({
                        value,
                        label: t(
                            value === 'all'
                                ? 'admin.hostMonitoring.all'
                                : `admin.hostMonitoring.states.${value}`,
                        ),
                    }))}
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
                    {state.observations.length === 0 ? (
                        <p className="text-sm text-muted">{t('admin.hostMonitoring.noData')}</p>
                    ) : (
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
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-xs">
                                    <caption className="pb-2 text-left text-sm font-bold text-ink">
                                        {t('admin.hostMonitoring.observations')}
                                    </caption>
                                    <thead className="text-muted">
                                        <tr>
                                            {[
                                                'checkedAt',
                                                'status',
                                                'duration',
                                                'httpStatus',
                                                'outcome',
                                            ].map((key) => (
                                                <th
                                                    key={key}
                                                    scope="col"
                                                    className="whitespace-nowrap border-b border-border px-2 py-2 font-medium"
                                                >
                                                    {t(`admin.hostMonitoring.${key}`)}
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {state.observations.map((observation) => (
                                            <tr
                                                key={observation.id}
                                                className="border-b border-border"
                                            >
                                                <td className="whitespace-nowrap px-2 py-2">
                                                    <time
                                                        dateTime={observation.checkedAt.toISOString()}
                                                    >
                                                        {handler.formatDate(observation.checkedAt)}
                                                    </time>
                                                </td>
                                                <td className="px-2 py-2">
                                                    <HostAvailabilityBadge
                                                        availability={observation.status}
                                                    />
                                                </td>
                                                <td className="whitespace-nowrap px-2 py-2 font-mono">
                                                    {observation.durationMs === null
                                                        ? '—'
                                                        : `${observation.durationMs} ms`}
                                                </td>
                                                <td className="px-2 py-2 font-mono">
                                                    {observation.httpStatus ?? '—'}
                                                </td>
                                                <td className="px-2 py-2">
                                                    {t(
                                                        `admin.hostMonitoring.codes.${observation.code}`,
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    )}
                    {state.more ? (
                        <button
                            type="button"
                            className={buttonClassName('secondary')}
                            disabled={state.loadingMore}
                            onClick={handler.handleMore}
                        >
                            {t('admin.hostMonitoring.loadMore')}
                        </button>
                    ) : null}
                    {state.capped ? (
                        <p className="text-xs text-muted">{t('admin.hostMonitoring.historyCap')}</p>
                    ) : null}
                    {state.policy ? (
                        <p className="m-0 text-xs leading-relaxed text-muted">
                            {t('admin.hostMonitoring.historyLimit', {
                                count: state.observations.length,
                                days: state.policy.settings.retentionDays,
                                samples: state.policy.settings.sampleLimit,
                                incidents: state.policy.settings.incidentLimit,
                            })}
                        </p>
                    ) : null}
                    <section className="grid gap-3">
                        <h3 className="m-0 text-sm font-bold">
                            {t('admin.hostMonitoring.incidents')}
                        </h3>
                        {state.incidents.length === 0 ? (
                            <p className="m-0 text-xs text-muted">
                                {t('admin.hostMonitoring.noIncidents')}
                            </p>
                        ) : (
                            state.incidents.map((incident) => (
                                <article
                                    key={incident.id}
                                    className="border-l-2 border-danger-text/40 pl-3"
                                >
                                    <dl className="m-0 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                                        <div>
                                            <dt className="text-muted">
                                                {t('admin.hostMonitoring.startedAt')}
                                            </dt>
                                            <dd className="m-0">
                                                {handler.formatDate(incident.startedAt)}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt className="text-muted">
                                                {t('admin.hostMonitoring.detectedAt')}
                                            </dt>
                                            <dd className="m-0">
                                                {handler.formatDate(incident.detectedAt)}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt className="text-muted">
                                                {t('admin.hostMonitoring.recoveryStartedAt')}
                                            </dt>
                                            <dd className="m-0">
                                                {handler.formatDate(incident.recoveryStartedAt)}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt className="text-muted">
                                                {t('admin.hostMonitoring.recoveredAt')}
                                            </dt>
                                            <dd className="m-0">
                                                {incident.recoveredAt
                                                    ? handler.formatDate(incident.recoveredAt)
                                                    : incident.closedAt
                                                      ? '—'
                                                      : t('admin.hostMonitoring.openIncident')}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt className="text-muted">
                                                {t('admin.hostMonitoring.closedAt')}
                                            </dt>
                                            <dd className="m-0">
                                                {handler.formatDate(incident.closedAt)}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt className="text-muted">
                                                {t('admin.hostMonitoring.closedReason')}
                                            </dt>
                                            <dd className="m-0">
                                                {incident.closedReason
                                                    ? t(
                                                          `admin.hostMonitoring.closures.${incident.closedReason}`,
                                                      )
                                                    : '—'}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt className="text-muted">
                                                {t('admin.hostMonitoring.outcome')}
                                            </dt>
                                            <dd className="m-0">
                                                {t(
                                                    `admin.hostMonitoring.codes.${incident.failureCode}`,
                                                )}
                                                {incident.recoveryCode
                                                    ? ` → ${t(`admin.hostMonitoring.codes.${incident.recoveryCode}`)}`
                                                    : null}
                                            </dd>
                                        </div>
                                    </dl>
                                </article>
                            ))
                        )}
                    </section>
                </>
            )}
        </div>
    )
}
