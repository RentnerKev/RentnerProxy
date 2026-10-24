import type { CrowdSecDashboardPanelProps } from './Types/crowdsec-dashboard.types.ts'
import { Activity } from 'lucide-react'
import { lazy, Suspense } from 'react'

import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import PageAlert from '@/shared/PageAlerts/PageAlert.tsx'
import useCrowdSecDashboardLogic from './Hooks/useCrowdSecDashboardLogic.ts'
import CrowdSecBansTable from '../CrowdSecBansTable/index.tsx'

const CrowdSecOriginChart = lazy(() => import('../CrowdSecOriginChart/index.tsx'))
const CrowdSecDecisionChart = lazy(() => import('../CrowdSecDecisionChart/index.tsx'))
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
            {hasValues && rows ? (
                <Suspense
                    fallback={
                        <p className="mt-4 text-xs text-muted">
                            {t('admin.crowdSec.dashboard.loading')}
                        </p>
                    }
                >
                    {kind === 'blocked' ? (
                        <CrowdSecOriginChart
                            rows={rows}
                            label={label}
                            color="var(--color-brand-500)"
                        />
                    ) : (
                        <CrowdSecDecisionChart rows={rows} label={label} />
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

export default function CrowdSecDashboardPanel({ configuration }: CrowdSecDashboardPanelProps) {
    const { t } = useTranslationStore()
    const { state, handler } = useCrowdSecDashboardLogic(configuration)

    return (
        <div className="space-y-4">
            <section
                className="min-w-0 rounded-2xl border border-border bg-surface p-[clamp(1.15rem,4vw,1.75rem)] shadow-surface"
                aria-label={t('admin.crowdSec.dashboard.title')}
            >
                {!state.enabled ? (
                    <p className="mt-6 rounded-xl border border-border bg-surface-raised px-4 py-5 text-sm text-muted">
                        {t('admin.crowdSec.dashboard.disabled')}
                    </p>
                ) : !state.snapshot ? (
                    state.isError ? (
                        <PageAlert
                            severity="error"
                            title={t('admin.crowdSec.page.title')}
                            description={t('admin.crowdSec.dashboard.unavailable')}
                        />
                    ) : (
                        <output className="mt-6 block rounded-xl border border-border bg-surface-raised px-4 py-5 text-sm text-muted">
                            {t('admin.crowdSec.dashboard.loading')}
                        </output>
                    )
                ) : (
                    <>
                        {state.snapshot.demo ? (
                            <PageAlert
                                severity="warning"
                                title={t('admin.crowdSec.page.title')}
                                description={t('admin.crowdSec.dashboard.demoNotice')}
                            />
                        ) : null}
                        {state.isError ? (
                            <PageAlert
                                severity="warning"
                                title={t('admin.crowdSec.page.title')}
                                description={t('admin.crowdSec.dashboard.stale')}
                            />
                        ) : null}
                        <dl className="mt-6 grid gap-3 sm:grid-cols-3">
                            <Metric
                                label={t('admin.crowdSec.dashboard.blockedRequests')}
                                value={state.snapshot.metrics?.blockedRequests ?? null}
                                hint={t(
                                    state.snapshot.demo
                                        ? 'admin.crowdSec.dashboard.demoMetricHint'
                                        : 'admin.crowdSec.dashboard.blockedHint',
                                )}
                            />
                            <Metric
                                label={t('admin.crowdSec.dashboard.activeDecisions')}
                                value={state.snapshot.metrics?.activeDecisions ?? null}
                                hint={t(
                                    state.snapshot.demo
                                        ? 'admin.crowdSec.dashboard.demoMetricHint'
                                        : 'admin.crowdSec.dashboard.activeHint',
                                )}
                            />
                            <Metric
                                label={t('admin.crowdSec.dashboard.ipBans')}
                                value={state.snapshot.decisions?.total ?? null}
                                hint={t(
                                    state.snapshot.demo
                                        ? 'admin.crowdSec.dashboard.demoMetricHint'
                                        : 'admin.crowdSec.dashboard.ipBansHint',
                                )}
                            />
                        </dl>
                        <p className="mt-3 flex items-center gap-2 text-xs text-muted">
                            <Activity aria-hidden="true" className="size-3.5" />
                            {t('admin.crowdSec.dashboard.lastUpdated', {
                                time: state.collectedAtDisplay,
                            })}
                        </p>
                        <div className="mt-6 grid gap-3 lg:grid-cols-2">
                            <OriginPanel
                                label={t('admin.crowdSec.dashboard.blockedByOrigin')}
                                rows={
                                    state.snapshot.metrics?.blockedRequests == null
                                        ? undefined
                                        : state.snapshot.metrics.blockedByOrigin
                                }
                                kind="blocked"
                            />
                            <OriginPanel
                                label={t('admin.crowdSec.dashboard.decisionsByOrigin')}
                                rows={
                                    state.snapshot.metrics?.activeDecisions == null
                                        ? undefined
                                        : state.snapshot.metrics.decisionsByOrigin
                                }
                                kind="decisions"
                            />
                        </div>
                    </>
                )}
            </section>
            {state.enabled && state.snapshot ? (
                <CrowdSecBansTable
                    decisions={state.snapshot.decisions}
                    origins={state.snapshot.decisions?.availableOrigins ?? []}
                    filters={state.filters}
                    isLoading={state.isFetching}
                    onSearchChange={handler.setSearchInput}
                    onOriginChange={handler.setOrigin}
                    onScopeChange={handler.setScope}
                    onPageChange={handler.setPageIndex}
                    onPageSizeChange={handler.setPageSize}
                />
            ) : null}
        </div>
    )
}
