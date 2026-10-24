import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type { FormModalActionsProps } from './Types/form-modal-actions.types.ts'
import { buttonClassName } from '@/shared/Buttons/buttonStyles.ts'
import FormSubmitButton from './FormSubmitButton.tsx'
export default function FormModalActions({
    formId,
    isPending,
    canSubmit,
    isSubmitting,
    onOpenChange,
    pendingSubmitLabel,
    submitLabel,
    submitDescriptionId,
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
            <FormSubmitButton
                formId={formId}
                canSubmit={canSubmit}
                isSubmitting={isSubmitting}
                isPending={isPending}
                submitLabel={submitLabel}
                submitDescriptionId={submitDescriptionId}
                pendingSubmitLabel={pendingSubmitLabel}
            />
        </>
    )
}
