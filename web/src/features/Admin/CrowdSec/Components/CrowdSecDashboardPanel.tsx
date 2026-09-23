import { Activity, RefreshCw, ShieldBan } from 'lucide-react'
import { lazy, Suspense } from 'react'

import useTranslationStore from '../../../../language/useTranslationStore'
import type { CrowdSecConfiguration } from '../../../../shared/Types/crowdsec.types'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import useCrowdSecDashboardLogic from '../Hooks/useCrowdSecDashboardLogic'

const CrowdSecOriginChart = lazy(() => import('./CrowdSecOriginChart'))

function Metric({
    label,
    value,
    hint,
}: {
    readonly label: string
    readonly value: number | null
    readonly hint: string
}) {
    const { t } = useTranslationStore()
    return (
        <div className="min-w-0 rounded-xl border border-border bg-surface-raised p-4">
            <dt className="text-[0.68rem] font-bold tracking-[0.12em] text-muted uppercase">
                {label}
            </dt>
            <dd className="mt-2 font-display text-3xl leading-none text-ink tabular-nums">
                {value === null ? '—' : value.toLocaleString()}
            </dd>
            <p className="mt-2 text-xs leading-relaxed text-muted">
                {value === null ? t('admin.crowdSec.dashboard.unavailable') : hint}
            </p>
        </div>
    )
}

function OriginPanel({
    label,
    rows,
    color,
}: {
    readonly label: string
    readonly rows: readonly { readonly origin: string; readonly count: number }[] | undefined
    readonly color: string
}) {
    const { t } = useTranslationStore()
    return (
        <div className="min-w-0 rounded-xl border border-border bg-surface-raised p-4">
            <h3 className="text-sm font-bold text-ink-soft">{label}</h3>
            {rows && rows.length > 0 ? (
                <Suspense
                    fallback={
                        <p className="mt-4 text-xs text-muted">
                            {t('admin.crowdSec.dashboard.loading')}
                        </p>
                    }
                >
                    <CrowdSecOriginChart rows={rows} label={label} color={color} />
                </Suspense>
            ) : (
                <p className="mt-4 text-xs text-muted">
                    {rows
                        ? t('admin.crowdSec.dashboard.noOriginData')
                        : t('admin.crowdSec.dashboard.unavailable')}
                </p>
            )}
        </div>
    )
}

export default function CrowdSecDashboardPanel({
    configuration,
}: {
    readonly configuration: CrowdSecConfiguration
}) {
    const { t } = useTranslationStore()
    const { enabled, query, snapshot } = useCrowdSecDashboardLogic(configuration)

    return (
        <section
            className={`${uiClassNames.management.card} mb-4`}
            aria-label={t('admin.crowdSec.dashboard.title')}
        >
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <p className={uiClassNames.themedTechnicalLabel}>
                        {t('admin.crowdSec.dashboard.eyebrow')}
                    </p>
                    <h2 className="mt-2 flex items-center gap-2 text-xl font-extrabold text-ink">
                        <ShieldBan aria-hidden="true" className="size-5 text-brand-500" />
                        {t('admin.crowdSec.dashboard.title')}
                    </h2>
                    <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
                        {t('admin.crowdSec.dashboard.description')}
                    </p>
                </div>
                {enabled ? (
                    <button
                        type="button"
                        className={uiClassNames.button.secondary}
                        disabled={query.isFetching}
                        onClick={() => void query.refetch()}
                    >
                        <RefreshCw
                            aria-hidden="true"
                            className={`size-4 ${query.isFetching ? 'animate-spin motion-reduce:animate-none' : ''}`}
                        />
                        {t('admin.crowdSec.dashboard.refresh')}
                    </button>
                ) : null}
            </div>

            {!enabled ? (
                <p className="mt-6 rounded-xl border border-border bg-surface-raised px-4 py-5 text-sm text-muted">
                    {t('admin.crowdSec.dashboard.disabled')}
                </p>
            ) : !snapshot ? (
                <p
                    className="mt-6 rounded-xl border border-border bg-surface-raised px-4 py-5 text-sm text-muted"
                    role={query.isError ? 'alert' : 'status'}
                >
                    {t(
                        query.isError
                            ? 'admin.crowdSec.dashboard.unavailable'
                            : 'admin.crowdSec.dashboard.loading',
                    )}
                </p>
            ) : (
                <>
                    {query.isError ? (
                        <p className="mt-5 text-xs text-warning-text" role="alert">
                            {t('admin.crowdSec.dashboard.stale')}
                        </p>
                    ) : null}
                    <dl className="mt-6 grid gap-3 sm:grid-cols-3">
                        <Metric
                            label={t('admin.crowdSec.dashboard.blockedRequests')}
                            value={snapshot.metrics?.blockedRequests ?? null}
                            hint={t('admin.crowdSec.dashboard.blockedHint')}
                        />
                        <Metric
                            label={t('admin.crowdSec.dashboard.activeDecisions')}
                            value={snapshot.metrics?.activeDecisions ?? null}
                            hint={t('admin.crowdSec.dashboard.activeHint')}
                        />
                        <Metric
                            label={t('admin.crowdSec.dashboard.ipBans')}
                            value={snapshot.decisions?.total ?? null}
                            hint={t('admin.crowdSec.dashboard.ipBansHint')}
                        />
                    </dl>
                    <p className="mt-3 flex items-center gap-2 text-xs text-muted">
                        <Activity aria-hidden="true" className="size-3.5" />
                        {t('admin.crowdSec.dashboard.lastUpdated', {
                            time: new Date(snapshot.collectedAt * 1000).toLocaleTimeString(),
                        })}
                    </p>
                    <div className="mt-6 grid gap-3 lg:grid-cols-2">
                        <OriginPanel
                            label={t('admin.crowdSec.dashboard.blockedByOrigin')}
                            rows={
                                snapshot.metrics?.blockedRequests == null
                                    ? undefined
                                    : snapshot.metrics.blockedByOrigin
                            }
                            color="var(--color-brand-500)"
                        />
                        <OriginPanel
                            label={t('admin.crowdSec.dashboard.decisionsByOrigin')}
                            rows={
                                snapshot.metrics?.activeDecisions == null
                                    ? undefined
                                    : snapshot.metrics.decisionsByOrigin
                            }
                            color="var(--theme-ink-soft)"
                        />
                    </div>
                    <div className="mt-6 border-t border-border pt-5">
                        <div className="flex flex-wrap items-end justify-between gap-2">
                            <div>
                                <h3 className="text-sm font-bold text-ink-soft">
                                    {t('admin.crowdSec.dashboard.banList')}
                                </h3>
                                <p className="mt-1 text-xs text-muted">
                                    {t('admin.crowdSec.dashboard.banListHint')}
                                </p>
                            </div>
                            {snapshot.decisions?.truncated ? (
                                <span className="text-xs text-muted">
                                    {t('admin.crowdSec.dashboard.topFifty')}
                                </span>
                            ) : null}
                        </div>
                        {!snapshot.decisions ? (
                            <p className="mt-4 text-sm text-muted">
                                {t('admin.crowdSec.dashboard.unavailable')}
                            </p>
                        ) : snapshot.decisions.entries.length === 0 ? (
                            <p className="mt-4 text-sm text-muted">
                                {t('admin.crowdSec.dashboard.noBans')}
                            </p>
                        ) : (
                            <div className="mt-4 overflow-x-auto rounded-xl border border-border">
                                <table className="w-full min-w-[640px] text-left text-sm">
                                    <thead className="bg-surface-raised text-[0.68rem] font-bold tracking-[0.1em] text-muted uppercase">
                                        <tr>
                                            <th scope="col" className="px-4 py-3">
                                                {t('admin.crowdSec.dashboard.address')}
                                            </th>
                                            <th scope="col" className="px-4 py-3">
                                                {t('admin.crowdSec.dashboard.remaining')}
                                            </th>
                                            <th scope="col" className="px-4 py-3">
                                                {t('admin.crowdSec.dashboard.origin')}
                                            </th>
                                            <th scope="col" className="px-4 py-3">
                                                {t('admin.crowdSec.dashboard.scenario')}
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border">
                                        {snapshot.decisions.entries.map((decision) => (
                                            <tr key={decision.id}>
                                                <td className="px-4 py-3 font-mono text-xs text-ink-soft">
                                                    {decision.value}
                                                </td>
                                                <td className="px-4 py-3 text-ink-soft tabular-nums">
                                                    {decision.duration}
                                                </td>
                                                <td className="px-4 py-3 text-muted">
                                                    {decision.origin}
                                                </td>
                                                <td className="px-4 py-3 text-muted">
                                                    {decision.scenario}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </>
            )}
        </section>
    )
}
