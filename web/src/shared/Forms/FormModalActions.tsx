import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type { FormModalActionsProps } from './Types/form-modal-actions.types.ts'
import { buttonClassName } from '@/shared/Buttons/buttonStyles.ts'
export default function FormModalActions({
    formId,
    isPending,
    canSubmit,
    isSubmitting,
    onOpenChange,
    pendingSubmitLabel,
    submitLabel,
}: FormModalActionsProps) {
    const { t } = useTranslationStore()
    return (
        <>
            <button
                type="button"
                className={buttonClassName('secondary')}
                disabled={isPending}
                onClick={() => onOpenChange(false)}
            >
                {t('common.cancel')}
            </button>
            <button
                type="submit"
                form={formId}
                className={buttonClassName('primary')}
                disabled={!canSubmit || isSubmitting || isPending}
            >
                {isSubmitting || isPending ? pendingSubmitLabel : submitLabel}
            </button>
        </>
    )
}
