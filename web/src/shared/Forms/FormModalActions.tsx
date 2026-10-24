import type { FormModalActionsProps } from './Types/form-modal-actions.types.ts'
import { ModalCancelButton } from '@/shared/Modal/Components/ModalActions.tsx'
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
    return (
        <>
            <ModalCancelButton disabled={isPending} onClick={() => onOpenChange(false)} />
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
