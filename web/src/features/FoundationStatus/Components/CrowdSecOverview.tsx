import { ArrowUpRight } from 'lucide-react'
import { Link } from '@tanstack/react-router'

import useTranslationStore from '../../../language/useTranslationStore'
import type useCrowdSecOverviewLogic from '../Hooks/useCrowdSecOverviewLogic'

const stateStyles = {
    disabled: 'border-border-strong bg-surface-raised text-muted',
    starting: 'border-amber-500/35 bg-amber-500/10 text-warning-text',
    connected: 'border-brand-500/30 bg-success-bg text-success-text',
    degraded: 'border-red-500/30 bg-danger-bg text-danger-text',
    unavailable: 'border-red-500/30 bg-danger-bg text-danger-text',
} as const

export default function CrowdSecOverview({
    logic: { state, handler },
}: {
    readonly logic: ReturnType<typeof useCrowdSecOverviewLogic>
}) {
    const { t } = useTranslationStore()
    const configuration = state.configuration
    const runtimeState = configuration?.runtime?.state ?? 'unavailable'

    return (
        <section
            className="min-w-0 rounded-2xl border border-border bg-surface p-[clamp(1.15rem,4vw,1.75rem)] shadow-surface mt-4"
            aria-label={t('admin.crowdSec.page.title')}
        >
            <div className="flex flex-wrap items-start justify-between gap-5">
                <div>
                    <p className="m-0 font-mono text-[0.68rem] font-bold tracking-[0.16em] text-accent-ring uppercase">
                        {t('foundation.crowdSec.eyebrow')}
                    </p>
                    <h2 className="mt-2 text-xl font-extrabold text-ink">
                        {t('admin.crowdSec.page.title')}
                    </h2>
                    <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
                        {t('foundation.crowdSec.description')}
                    </p>
                </div>
                <Link
                    to="/crowdsec"
                    className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none border-border-strong bg-surface-raised text-ink-soft enabled:hover:border-accent-border enabled:hover:text-accent-ring"
                >
                    {t('foundation.crowdSec.manage')}
                    <ArrowUpRight aria-hidden="true" className="size-4" />
                </Link>
            </div>

            {state.isPending ? (
                <output className="mt-5 block border-t border-border pt-4 text-sm text-muted">
                    {t('foundation.crowdSec.checking')}
                </output>
            ) : state.isError || !configuration ? (
                <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                    <p className="m-0 text-sm text-danger-text" role="alert">
                        {t('foundation.crowdSec.loadError')}
                    </p>
                    <button
                        type="button"
                        className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none border-border-strong bg-surface-raised text-ink-soft enabled:hover:border-accent-border enabled:hover:text-accent-ring"
                        onClick={handler.retry}
                    >
                        {t('common.retry')}
                    </button>
                </div>
            ) : (
                <div className="mt-5 border-t border-border pt-4" aria-live="polite">
                    <dl className="grid gap-4 sm:grid-cols-3">
                        <div>
                            <dt className="text-[0.68rem] font-bold tracking-[0.12em] text-muted uppercase">
                                {t('foundation.crowdSec.desiredMode')}
                            </dt>
                            <dd className="mt-1 text-sm font-bold text-ink-soft">
                                {t(`admin.crowdSec.modes.${configuration.mode}.title`)}
                            </dd>
                        </div>
                        <div>
                            <dt className="text-[0.68rem] font-bold tracking-[0.12em] text-muted uppercase">
                                {t('foundation.crowdSec.runtime')}
                            </dt>
                            <dd className="mt-1">
                                <span
                                    className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-bold ${stateStyles[runtimeState]}`}
                                    data-state={runtimeState}
                                >
                                    <span
                                        className="size-1.5 rounded-full bg-current"
                                        aria-hidden="true"
                                    />
                                    {t(`admin.crowdSec.states.${runtimeState}`)}
                                </span>
                            </dd>
                        </div>
                        <div>
                            <dt className="text-[0.68rem] font-bold tracking-[0.12em] text-muted uppercase">
                                {t('admin.crowdSec.status.details.enforcement')}
                            </dt>
                            <dd className="mt-1 text-sm font-bold text-ink-soft">
                                {configuration.runtime
                                    ? t(
                                          configuration.runtime.enforcementActive
                                              ? 'admin.crowdSec.status.details.active'
                                              : 'admin.crowdSec.status.details.inactive',
                                      )
                                    : t('foundation.unavailable')}
                            </dd>
                        </div>
                    </dl>
                    {!configuration.synchronized ? (
                        <p className="mt-4 text-xs leading-relaxed text-warning-text">
                            {t(
                                configuration.runtime
                                    ? 'admin.crowdSec.status.pending'
                                    : 'admin.crowdSec.status.runtimeUnavailable',
                            )}
                            {configuration.runtime &&
                            configuration.runtime.mode !== configuration.mode
                                ? ` ${t('admin.crowdSec.status.details.activeMode')}: ${t(`admin.crowdSec.modes.${configuration.runtime.mode}.title`)}.`
                                : null}
                        </p>
                    ) : null}
                </div>
            )}
        </section>
    )
}
