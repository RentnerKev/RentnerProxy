import type { RuntimeStatusPanelProps } from './Types/runtime-status.types.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import useRuntimeStatusPanelLogic from './Hooks/useRuntimeStatusPanelLogic.ts'
import { buttonClassName } from '@/shared/Buttons/buttonStyles.ts'
import PageAlert from '@/shared/PageAlerts/PageAlert.tsx'

export default function RuntimeStatusPanel({
    canApply,
    isError = false,
    isApplying,
    onApply,
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
                showApply ? (
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
