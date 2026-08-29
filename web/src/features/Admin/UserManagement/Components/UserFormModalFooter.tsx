import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import type { UserFormModalFooterProps } from '../Types/user-form-modal.types'

export default function UserFormModalFooter({
    form,
    formId,
    isPending,
    onOpenChange,
    pendingSubmitLabel,
    submitLabel,
}: UserFormModalFooterProps) {
    return (
        <>
            <button
                type="button"
                className={uiClassNames.button.secondary}
                disabled={isPending}
                onClick={() => onOpenChange(false)}
            >
                Cancel
            </button>
            <form.Subscribe
                selector={(formState) => [formState.canSubmit, formState.isSubmitting] as const}
            >
                {([canSubmit, isSubmitting]) => (
                    <button
                        type="submit"
                        form={formId}
                        className={uiClassNames.button.primary}
                        disabled={!canSubmit || isSubmitting || isPending}
                    >
                        {isSubmitting || isPending ? pendingSubmitLabel : submitLabel}
                    </button>
                )}
            </form.Subscribe>
        </>
    )
}
