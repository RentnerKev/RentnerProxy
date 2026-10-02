import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import useForwardAuthSummary from './Hooks/useForwardAuthSummary.ts'

export default function ForwardAuthSummaryPanel() {
    const { t } = useTranslationStore()
    const { state } = useForwardAuthSummary()

    return (
        <section
            className="min-w-0 rounded-2xl border border-border bg-surface p-[clamp(1.15rem,4vw,1.75rem)] shadow-surface mb-4"
            aria-live="polite"
            aria-label={t('admin.crowdSec.dashboard.forwardAuthTitle')}
        >
            <div>
                <p className="m-0 font-mono text-[0.68rem] font-bold tracking-[0.16em] text-accent-ring uppercase">
                    {t('admin.crowdSec.dashboard.forwardAuthEyebrow')}
                </p>
                <h2 className="mt-2 text-xl font-extrabold text-ink">
                    {t('admin.crowdSec.dashboard.forwardAuthTitle')}
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
                    {t('admin.crowdSec.dashboard.forwardAuthDescription')}
                </p>
            </div>
            <dl className="mt-5 grid gap-4 border-t border-border pt-4 sm:grid-cols-3">
                <div>
                    <dt className="text-[0.68rem] font-bold tracking-[0.12em] text-muted uppercase">
                        {t('admin.crowdSec.dashboard.forwardAuthPolicies')}
                    </dt>
                    <dd className="mt-1 text-2xl font-extrabold text-ink">
                        {state.isPoliciesPending
                            ? t('admin.crowdSec.dashboard.loading')
                            : (state.policyCount ?? t('admin.crowdSec.dashboard.unavailable'))}
                    </dd>
                </div>
                <div>
                    <dt className="text-[0.68rem] font-bold tracking-[0.12em] text-muted uppercase">
                        {t('admin.crowdSec.dashboard.forwardAuthHosts')}
                    </dt>
                    <dd className="mt-1 text-2xl font-extrabold text-ink">
                        {state.assignedHosts ??
                            (state.isPoliciesPending
                                ? t('admin.crowdSec.dashboard.loading')
                                : t('admin.crowdSec.dashboard.unavailable'))}
                    </dd>
                </div>
                <div>
                    <dt className="text-[0.68rem] font-bold tracking-[0.12em] text-muted uppercase">
                        {t('admin.crowdSec.dashboard.forwardAuthRuntime')}
                    </dt>
                    <dd className="mt-1 text-sm font-bold text-ink-soft">
                        {state.isRuntimePending
                            ? t('admin.crowdSec.dashboard.loading')
                            : state.runtimeState
                              ? t(`admin.accessPolicies.runtime.${state.runtimeState}`)
                              : t('admin.crowdSec.dashboard.unavailable')}
                    </dd>
                </div>
            </dl>
        </section>
    )
}
