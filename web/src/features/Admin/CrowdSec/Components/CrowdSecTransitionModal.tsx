import { Check, LoaderCircle } from 'lucide-react'

import useTranslationStore from '../../../../language/useTranslationStore'
import { Modal } from '../../../../shared/Modal'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import type { CrowdSecTransition, CrowdSecTransitionProgress } from '../Types/crowdsec.types'

interface CrowdSecTransitionModalProps {
    readonly transition: CrowdSecTransition
    readonly progress: CrowdSecTransitionProgress
    readonly onClose: () => void
}

export default function CrowdSecTransitionModal({
    transition,
    progress,
    onClose,
}: CrowdSecTransitionModalProps) {
    const { t } = useTranslationStore()
    const finished = transition.phase === 'complete'
    const closable = finished || transition.phase === 'delayed' || transition.phase === 'error'
    const steps =
        transition.targetMode === 'managed'
            ? (['save', 'startEngine', 'switchProxy', 'verify'] as const)
            : (['save', 'switchProxy', 'stopEngine', 'verify'] as const)
    const notice =
        transition.phase === 'error'
            ? transition.errorMessage
            : finished
              ? t(`admin.crowdSec.progress.${transition.targetMode}.complete`)
              : transition.phase === 'delayed'
                ? t('admin.crowdSec.progress.delayed')
                : transition.connectionInterrupted
                  ? t('admin.crowdSec.progress.connectionInterrupted')
                  : progress.healthDegraded
                    ? t('admin.crowdSec.progress.degraded')
                    : transition.runtimePending
                      ? t('admin.crowdSec.progress.retrying')
                      : t('admin.crowdSec.progress.inProgress')

    return (
        <Modal
            open
            onOpenChange={(open) => {
                if (!open) onClose()
            }}
            title={t(`admin.crowdSec.progress.${transition.targetMode}.title`)}
            description={t('admin.crowdSec.progress.description')}
            size="sm"
            closeDisabled={!closable}
            footer={
                closable ? (
                    <button type="button" className={uiClassNames.button.primary} onClick={onClose}>
                        {t(
                            transition.phase === 'delayed'
                                ? 'admin.crowdSec.progress.continueInBackground'
                                : 'admin.crowdSec.progress.done',
                        )}
                    </button>
                ) : null
            }
        >
            <div className="space-y-5">
                <div>
                    <div className="mb-2 flex items-end justify-between gap-3">
                        <p className="m-0 text-xs font-bold tracking-wide text-muted uppercase">
                            {t('admin.crowdSec.progress.confirmedSteps')}
                        </p>
                        <span className="font-mono text-lg font-bold tabular-nums text-ink-soft">
                            {progress.percent}%
                        </span>
                    </div>
                    <progress
                        aria-label={t('admin.crowdSec.progress.progressLabel')}
                        max={100}
                        value={progress.percent}
                        className="h-2.5 w-full overflow-hidden rounded-full bg-surface-raised accent-brand-500 [&::-webkit-progress-bar]:bg-surface-raised [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-brand-500 [&::-moz-progress-bar]:bg-brand-500"
                    />
                </div>

                <ol className="space-y-3" aria-label={t('admin.crowdSec.progress.stepsLabel')}>
                    {steps.map((step, index) => {
                        const complete = index < progress.activeStep
                        const active = index === progress.activeStep
                        return (
                            <li
                                key={step}
                                aria-current={active ? 'step' : undefined}
                                className={`flex items-center gap-3 text-sm ${complete || active ? 'text-ink-soft' : 'text-muted'}`}
                            >
                                <span
                                    aria-hidden="true"
                                    className={`grid size-7 shrink-0 place-items-center rounded-full border text-xs font-bold ${complete ? 'border-brand-500/40 bg-brand-500/10 text-brand-500' : active ? 'border-brand-500 text-brand-500' : 'border-border text-muted'}`}
                                >
                                    {complete ? (
                                        <Check className="size-4" />
                                    ) : active && transition.phase === 'running' ? (
                                        <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
                                    ) : (
                                        index + 1
                                    )}
                                </span>
                                <span className={active ? 'font-bold' : undefined}>
                                    {t(
                                        `admin.crowdSec.progress.${transition.targetMode}.steps.${step}`,
                                    )}
                                </span>
                            </li>
                        )
                    })}
                </ol>

                <output
                    aria-live="polite"
                    className={`block rounded-xl border px-3 py-2.5 text-xs leading-relaxed ${transition.phase === 'error' || progress.healthDegraded ? 'border-red-500/30 bg-danger-bg text-danger-text' : 'border-border bg-surface-raised text-muted'}`}
                >
                    {notice}
                </output>
            </div>
        </Modal>
    )
}
