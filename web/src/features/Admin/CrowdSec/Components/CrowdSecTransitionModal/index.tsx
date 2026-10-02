import type { CrowdSecTransitionModalProps } from './Types/crowdsec-transition-modal.types.ts'
import useCrowdSecTransitionModalLogic from './Hooks/useCrowdSecTransitionModalLogic.ts'
import { Check, LoaderCircle } from 'lucide-react'

import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import { Modal } from '@/shared/Modal/index.tsx'

export default function CrowdSecTransitionModal({
    transition,
    progress,
    onClose,
}: CrowdSecTransitionModalProps) {
    const { t } = useTranslationStore()
    const { state, handler } = useCrowdSecTransitionModalLogic({ transition, progress, onClose })
    return (
        <Modal
            open
            onOpenChange={handler.handleOpenChange}
            title={t(`admin.crowdSec.progress.${transition.targetMode}.title`)}
            description={t('admin.crowdSec.progress.description')}
            size="sm"
            closeDisabled={!state.closable}
            footer={
                state.closable ? (
                    <button
                        type="button"
                        className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none bg-accent text-accent-foreground enabled:hover:bg-accent-hover"
                        onClick={onClose}
                    >
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
                        className="h-2.5 w-full overflow-hidden rounded-full bg-surface-raised accent-accent [&::-webkit-progress-bar]:bg-surface-raised [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-accent [&::-moz-progress-bar]:bg-accent"
                    />
                </div>

                <ol className="space-y-3" aria-label={t('admin.crowdSec.progress.stepsLabel')}>
                    {state.steps.map(({ step, index, complete, active }) => (
                        <li
                            key={step}
                            aria-current={active ? 'step' : undefined}
                            className={`flex items-center gap-3 text-sm ${complete || active ? 'text-ink-soft' : 'text-muted'}`}
                        >
                            <span
                                aria-hidden="true"
                                className={`grid size-7 shrink-0 place-items-center rounded-full border text-xs font-bold ${complete ? 'border-success-text/40 bg-success-bg text-success-text' : active ? 'border-accent-border text-accent-ring' : 'border-border text-muted'}`}
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
                    ))}
                </ol>

                <output
                    aria-live="polite"
                    className={`block rounded-xl border px-3 py-2.5 text-xs leading-relaxed ${transition.phase === 'error' || progress.healthDegraded ? 'border-red-500/30 bg-danger-bg text-danger-text' : 'border-border bg-surface-raised text-muted'}`}
                >
                    {state.notice}
                </output>
            </div>
        </Modal>
    )
}
