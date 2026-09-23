import { Activity, CircleDot, ShieldCheck } from 'lucide-react'

import useTranslationStore from '../../../../language/useTranslationStore'
import type { CrowdSecConfiguration } from '../../../../shared/Types/crowdsec.types'

const stateStyles = {
    disabled: 'border-border-strong bg-surface-raised text-muted',
    starting: 'border-amber-500/35 bg-amber-500/10 text-amber-300',
    connected: 'border-brand-500/30 bg-success-bg text-success-text',
    degraded: 'border-red-500/30 bg-danger-bg text-danger-text',
    unavailable: 'border-red-500/30 bg-danger-bg text-danger-text',
} as const

export default function CrowdSecStatusPanel({
    configuration,
}: {
    readonly configuration: CrowdSecConfiguration
}) {
    const { t } = useTranslationStore()
    const runtimeState = configuration.runtime?.state ?? 'unavailable'
    const managedEngine = configuration.runtime?.managedEngine ?? 'unavailable'
    return (
        <section className="relative mb-6 overflow-hidden rounded-2xl border border-brand-500/20 bg-[linear-gradient(135deg,var(--color-surface),var(--color-success-bg))] p-[clamp(1.2rem,4vw,2rem)] shadow-surface">
            <div
                aria-hidden="true"
                className="pointer-events-none absolute -top-20 right-0 size-52 rounded-full bg-brand-500/10 blur-3xl"
            />
            <div className="relative flex flex-wrap items-start justify-between gap-6">
                <div className="flex min-w-0 items-start gap-4">
                    <span className="grid size-12 shrink-0 place-items-center rounded-2xl border border-brand-500/25 bg-brand-500/10 text-brand-text">
                        <ShieldCheck aria-hidden="true" className="size-6" strokeWidth={1.7} />
                    </span>
                    <div>
                        <p className="m-0 text-xs font-bold tracking-[0.14em] text-brand-text uppercase">
                            {t('admin.crowdSec.status.eyebrow')}
                        </p>
                        <h2 className="mt-1 text-xl font-extrabold text-ink">
                            {t(`admin.crowdSec.modes.${configuration.mode}.title`)}
                        </h2>
                        <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
                            {t('admin.crowdSec.status.description')}
                        </p>
                    </div>
                </div>
                <div className="grid min-w-[13rem] gap-2">
                    <span
                        className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-extrabold ${stateStyles[runtimeState]}`}
                    >
                        <CircleDot aria-hidden="true" className="size-3.5" />
                        {t(`admin.crowdSec.states.${runtimeState}`)}
                    </span>
                    <span className="inline-flex items-center gap-2 text-xs text-muted">
                        <Activity aria-hidden="true" className="size-3.5" />
                        {t(
                            configuration.synchronized
                                ? 'admin.crowdSec.status.synchronized'
                                : 'admin.crowdSec.status.pending',
                        )}
                    </span>
                </div>
            </div>
            <dl className="relative mt-6 grid gap-3 border-t border-brand-500/15 pt-5 sm:grid-cols-3">
                <div>
                    <dt className="text-[0.68rem] font-bold tracking-[0.12em] text-muted uppercase">
                        {t('admin.crowdSec.status.details.enforcement')}
                    </dt>
                    <dd className="mt-1 text-sm font-extrabold text-ink">
                        {t(
                            configuration.runtime?.enforcementActive
                                ? 'admin.crowdSec.status.details.active'
                                : 'admin.crowdSec.status.details.inactive',
                        )}
                    </dd>
                </div>
                <div>
                    <dt className="text-[0.68rem] font-bold tracking-[0.12em] text-muted uppercase">
                        {t('admin.crowdSec.status.details.localApi')}
                    </dt>
                    <dd className="mt-1 text-sm font-extrabold text-ink">
                        {t(`admin.crowdSec.states.${runtimeState}`)}
                    </dd>
                </div>
                <div>
                    <dt className="text-[0.68rem] font-bold tracking-[0.12em] text-muted uppercase">
                        {t('admin.crowdSec.status.details.managedEngine')}
                    </dt>
                    <dd className="mt-1 text-sm font-extrabold text-ink">
                        {t(`admin.crowdSec.managedStates.${managedEngine}`)}
                    </dd>
                </div>
            </dl>
        </section>
    )
}
