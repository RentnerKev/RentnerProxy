import useTranslationStore from '../../../../language/useTranslationStore'
import type { CrowdSecConfiguration } from '../../../../shared/Types/crowdsec.types'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'

const stateStyles = {
    disabled: 'border-border-strong bg-surface-raised text-muted',
    starting: 'border-amber-500/35 bg-amber-500/10 text-warning-text',
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
        <section className={`${uiClassNames.management.card} mb-4`} aria-live="polite">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <p className={uiClassNames.themedTechnicalLabel}>
                        {t('admin.crowdSec.status.eyebrow')}
                    </p>
                    <h2 className="mt-2 text-xl font-extrabold text-ink">
                        {t(`admin.crowdSec.modes.${configuration.mode}.title`)}
                    </h2>
                    <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
                        {t(
                            !configuration.runtime
                                ? 'admin.crowdSec.status.runtimeUnavailable'
                                : configuration.mode === 'disabled' && configuration.synchronized
                                  ? 'admin.crowdSec.modes.disabled.description'
                                  : 'admin.crowdSec.status.description',
                        )}
                    </p>
                </div>
                <span
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold ${stateStyles[runtimeState]}`}
                    data-state={runtimeState}
                >
                    <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
                    {t(`admin.crowdSec.states.${runtimeState}`)}
                </span>
            </div>

            <div className="mt-5 border-t border-border pt-4">
                <dl
                    className={`grid gap-4 ${configuration.mode === 'managed' ? 'sm:grid-cols-3' : configuration.mode === 'external' ? 'sm:grid-cols-2' : ''}`}
                >
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
                                : t('admin.crowdSec.states.unavailable')}
                        </dd>
                    </div>
                    {configuration.runtime && configuration.runtime.mode !== configuration.mode ? (
                        <div>
                            <dt className="text-[0.68rem] font-bold tracking-[0.12em] text-muted uppercase">
                                {t('admin.crowdSec.status.details.activeMode')}
                            </dt>
                            <dd className="mt-1 text-sm font-bold text-ink-soft">
                                {t(`admin.crowdSec.modes.${configuration.runtime.mode}.title`)}
                            </dd>
                        </div>
                    ) : null}
                    {configuration.mode !== 'disabled' ? (
                        <div>
                            <dt className="text-[0.68rem] font-bold tracking-[0.12em] text-muted uppercase">
                                {t('admin.crowdSec.status.details.localApi')}
                            </dt>
                            <dd className="mt-1 text-sm font-bold text-ink-soft">
                                {t(`admin.crowdSec.states.${runtimeState}`)}
                            </dd>
                        </div>
                    ) : null}
                    {configuration.mode === 'managed' ? (
                        <div>
                            <dt className="text-[0.68rem] font-bold tracking-[0.12em] text-muted uppercase">
                                {t('admin.crowdSec.status.details.managedEngine')}
                            </dt>
                            <dd className="mt-1 text-sm font-bold text-ink-soft">
                                {t(`admin.crowdSec.managedStates.${managedEngine}`)}
                            </dd>
                        </div>
                    ) : null}
                </dl>
                {configuration.runtime ? (
                    <p
                        className={`mt-4 mb-0 text-xs leading-relaxed ${configuration.synchronized ? 'text-muted' : 'text-warning-text'}`}
                    >
                        {t(
                            configuration.synchronized
                                ? 'admin.crowdSec.status.synchronized'
                                : 'admin.crowdSec.status.pending',
                        )}
                    </p>
                ) : null}
            </div>
        </section>
    )
}
