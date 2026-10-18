import { buttonClassName } from '@/shared/Buttons/buttonStyles.ts'
import type { FormSubmitButtonProps } from './Types/form-submit-button.types.ts'

export default function FormSubmitButton({
    formId,
    canSubmit,
    isSubmitting,
    isPending,
    disabled = false,
    submitLabel,
    pendingSubmitLabel,
}: FormSubmitButtonProps) {
    return (
        <button
            type="submit"
            form={formId}
            className={buttonClassName('primary')}
            disabled={disabled || !canSubmit || isSubmitting || isPending}
        >
            {isSubmitting || isPending ? pendingSubmitLabel : submitLabel}
        </button>
    )
}
