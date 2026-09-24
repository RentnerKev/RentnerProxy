import { Activity, RefreshCw } from 'lucide-react'
import { lazy, Suspense } from 'react'

import useTranslationStore from '../../../../language/useTranslationStore'
import type { CrowdSecConfiguration } from '../../../../shared/Types/crowdsec.types'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import useCrowdSecDashboardLogic from '../Hooks/useCrowdSecDashboardLogic'
import CrowdSecBansTable from './CrowdSecBansTable'

const CrowdSecOriginChart = lazy(() => import('./CrowdSecOriginChart'))
const CrowdSecDecisionChart = lazy(() => import('./CrowdSecDecisionChart'))
const ZERO_BLOCKED_ROWS = [
    { origin: 'crowdsec', count: 0 },
    { origin: 'CAPI', count: 0 },
] as const

function Metric({
    label,
    value,
    hint,
}: {
    readonly label: string
    readonly value: number | null
    readonly hint: string
}) {
    const { locale, t } = useTranslationStore()
    return (
        <div className="min-w-0 rounded-xl border border-border bg-surface-raised p-4">
            <dt className="text-[0.68rem] font-bold tracking-[0.12em] text-muted uppercase">
                {label}
            </dt>
            <dd className="mt-2 font-display text-3xl leading-none text-ink tabular-nums">
                {value === null ? '—' : value.toLocaleString(locale)}
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
    kind,
}: {
    readonly label: string
    readonly rows: readonly { readonly origin: string; readonly count: number }[] | undefined
    readonly kind: 'blocked' | 'decisions'
}) {
    const { t } = useTranslationStore()
    const hasValues = rows?.some((row) => row.count > 0) ?? false
    return (
        <div className="min-w-0 rounded-xl border border-border bg-surface-raised p-4">
            <h3 className="text-sm font-bold text-ink-soft">{label}</h3>
            {kind === 'blocked' || hasValues ? (
                <Suspense
                    fallback={
                        <p className="mt-4 text-xs text-muted">
                            {t('admin.crowdSec.dashboard.loading')}
                        </p>
                    }
                >
                    {kind === 'blocked' ? (
                        <>
                            {!hasValues ? (
                                <output className="mt-2 block text-xs text-muted">
                                    {rows
                                        ? t('admin.crowdSec.dashboard.noOriginData')
                                        : t('admin.crowdSec.dashboard.unavailable')}
                                </output>
                            ) : null}
                            <CrowdSecOriginChart
                                rows={hasValues && rows ? rows : ZERO_BLOCKED_ROWS}
                                label={label}
                                color="var(--color-brand-500)"
                            />
                            {!hasValues ? (
                                <div className="flex justify-around border-t border-border pt-2 text-xs text-muted tabular-nums">
                                    {ZERO_BLOCKED_ROWS.map((row) => (
                                        <span key={row.origin}>
                                            {row.origin}{' '}
                                            <strong className="text-ink-soft">0</strong>
                                        </span>
                                    ))}
                                </div>
                            ) : null}
                        </>
                    ) : (
                        <CrowdSecDecisionChart rows={rows ?? []} label={label} />
                    )}
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
    const { locale, t } = useTranslationStore()
    const { enabled, query, snapshot, filters, actions } = useCrowdSecDashboardLogic(configuration)

    return (
        <div className="space-y-4">
            <section
                className={uiClassNames.management.card}
                aria-label={t('admin.crowdSec.dashboard.title')}
            >
                {enabled ? (
                    <div className="flex justify-end">
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
                    </div>
                ) : null}

                {!enabled ? (
                    <p className="mt-6 rounded-xl border border-border bg-surface-raised px-4 py-5 text-sm text-muted">
                        {t('admin.crowdSec.dashboard.disabled')}
                    </p>
                ) : !snapshot ? (
                    query.isError ? (
                        <p
                            className="mt-6 rounded-xl border border-border bg-surface-raised px-4 py-5 text-sm text-muted"
                            role="alert"
                        >
                            {t('admin.crowdSec.dashboard.unavailable')}
                        </p>
                    ) : (
                        <output className="mt-6 block rounded-xl border border-border bg-surface-raised px-4 py-5 text-sm text-muted">
                            {t('admin.crowdSec.dashboard.loading')}
                        </output>
                    )
                ) : (
                    <>
                        {snapshot.demo ? (
                            <output className="mt-5 block rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs font-bold text-warning-text">
                                {t('admin.crowdSec.dashboard.demoNotice')}
                            </output>
                        ) : null}
                        {query.isError ? (
                            <p className="mt-5 text-xs text-warning-text" role="alert">
                                {t('admin.crowdSec.dashboard.stale')}
                            </p>
                        ) : null}
                        <dl className="mt-6 grid gap-3 sm:grid-cols-3">
                            <Metric
                                label={t('admin.crowdSec.dashboard.blockedRequests')}
                                value={snapshot.metrics?.blockedRequests ?? null}
                                hint={t(
                                    snapshot.demo
                                        ? 'admin.crowdSec.dashboard.demoMetricHint'
                                        : 'admin.crowdSec.dashboard.blockedHint',
                                )}
                            />
                            <Metric
                                label={t('admin.crowdSec.dashboard.activeDecisions')}
                                value={snapshot.metrics?.activeDecisions ?? null}
                                hint={t(
                                    snapshot.demo
                                        ? 'admin.crowdSec.dashboard.demoMetricHint'
                                        : 'admin.crowdSec.dashboard.activeHint',
                                )}
                            />
                            <Metric
                                label={t('admin.crowdSec.dashboard.ipBans')}
                                value={snapshot.decisions?.total ?? null}
                                hint={t(
                                    snapshot.demo
                                        ? 'admin.crowdSec.dashboard.demoMetricHint'
                                        : 'admin.crowdSec.dashboard.ipBansHint',
                                )}
                            />
                        </dl>
                        <p className="mt-3 flex items-center gap-2 text-xs text-muted">
                            <Activity aria-hidden="true" className="size-3.5" />
                            {t('admin.crowdSec.dashboard.lastUpdated', {
                                time: new Date(snapshot.collectedAt * 1000).toLocaleTimeString(
                                    locale,
                                ),
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
                                kind="blocked"
                            />
                            <OriginPanel
                                label={t('admin.crowdSec.dashboard.decisionsByOrigin')}
                                rows={
                                    snapshot.metrics?.activeDecisions == null
                                        ? undefined
                                        : snapshot.metrics.decisionsByOrigin
                                }
                                kind="decisions"
                            />
                        </div>
                    </>
                )}
            </section>
            {enabled && snapshot ? (
                <CrowdSecBansTable
                    decisions={snapshot.decisions}
                    origins={snapshot.decisions?.availableOrigins ?? []}
                    filters={filters}
                    isLoading={query.isFetching}
                    onSearchChange={actions.setSearchInput}
                    onOriginChange={actions.setOrigin}
                    onScopeChange={actions.setScope}
                    onPageChange={actions.setPageIndex}
                    onPageSizeChange={actions.setPageSize}
                />
            ) : null}
        </div>
    )
}
