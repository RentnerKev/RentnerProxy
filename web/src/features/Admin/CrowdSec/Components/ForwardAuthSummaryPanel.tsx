import useTranslationStore from '../../../../language/useTranslationStore'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import useForwardAuthSummary from '../Hooks/useForwardAuthSummary'

export default function ForwardAuthSummaryPanel() {
    const { t } = useTranslationStore()
    const { policies, runtime, forwardAuthPolicies, assignedHosts, runtimeState } =
        useForwardAuthSummary()

    return (
        <section
            className={`${uiClassNames.management.card} mb-4`}
            aria-live="polite"
            aria-label={t('admin.crowdSec.dashboard.forwardAuthTitle')}
        >
            <div>
                <p className={uiClassNames.themedTechnicalLabel}>
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
                        {policies.isPending
                            ? t('admin.crowdSec.dashboard.loading')
                            : (forwardAuthPolicies?.length ??
                              t('admin.crowdSec.dashboard.unavailable'))}
                    </dd>
                </div>
                <div>
                    <dt className="text-[0.68rem] font-bold tracking-[0.12em] text-muted uppercase">
                        {t('admin.crowdSec.dashboard.forwardAuthHosts')}
                    </dt>
                    <dd className="mt-1 text-2xl font-extrabold text-ink">
                        {assignedHosts ??
                            (policies.isPending
                                ? t('admin.crowdSec.dashboard.loading')
                                : t('admin.crowdSec.dashboard.unavailable'))}
                    </dd>
                </div>
                <div>
                    <dt className="text-[0.68rem] font-bold tracking-[0.12em] text-muted uppercase">
                        {t('admin.crowdSec.dashboard.forwardAuthRuntime')}
                    </dt>
                    <dd className="mt-1 text-sm font-bold text-ink-soft">
                        {runtime.isPending
                            ? t('admin.crowdSec.dashboard.loading')
                            : runtimeState
                              ? t(`admin.accessPolicies.runtime.${runtimeState}`)
                              : t('admin.crowdSec.dashboard.unavailable')}
                    </dd>
                </div>
            </dl>
        </section>
    )
}
