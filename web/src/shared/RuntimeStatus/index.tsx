import type { RuntimeStatusPanelProps } from './Types/runtime-status.types.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import useRuntimeStatusPanelLogic from './Hooks/useRuntimeStatusPanelLogic.ts'
import { buttonClassName } from '@/shared/Buttons/buttonStyles.ts'
import PageAlert from '@/shared/PageAlerts/PageAlert.tsx'

export default function RuntimeStatusPanel({
    canApply,
    isError = false,
    isApplying,
    isRetrying = false,
    onApply,
    onRetry,
    status,
    translationPrefix,
}: RuntimeStatusPanelProps) {
    const { t } = useTranslationStore()
    const {
        state: { runtimeState, showApply, hidden },
    } = useRuntimeStatusPanelLogic({ canApply, isError, status })
    if (hidden) return null

    return (
        <PageAlert
            severity={runtimeState === 'unavailable' ? 'error' : 'warning'}
            title={t(`${translationPrefix}.${runtimeState}`)}
            description={t(`${translationPrefix}.${runtimeState}Description`)}
            action={
                isError && onRetry ? (
                    <button
                        type="button"
                        className={buttonClassName('secondary')}
                        onClick={onRetry}
                        disabled={isRetrying}
                    >
                        {t('common.retry')}
                    </button>
                ) : showApply ? (
                    <button
                        type="button"
                        className={buttonClassName('primary')}
                        onClick={onApply}
                        disabled={isApplying}
                    >
                        {t(
                            isApplying
                                ? `${translationPrefix}.applying`
                                : `${translationPrefix}.apply`,
                        )}
                    </button>
                ) : undefined
            }
        />
    )
}
