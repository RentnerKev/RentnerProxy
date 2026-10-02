import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type { CrowdSecTransitionModalProps } from '../Types/crowdsec-transition-modal.types.ts'

export default function useCrowdSecTransitionModalLogic({
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

    return {
        state: {
            closable,
            notice,
            steps: steps.map((step, index) => ({
                step,
                index,
                complete: index < progress.activeStep,
                active: index === progress.activeStep,
            })),
        },
        handler: {
            handleOpenChange: (open: boolean) => {
                if (!open) onClose()
            },
        },
    }
}
