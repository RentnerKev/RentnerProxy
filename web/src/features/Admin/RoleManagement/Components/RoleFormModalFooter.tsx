import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import type { RoleFormModalFooterProps } from '../Types/role-form-modal.types'

export default function RoleFormModalFooter({
    form,
    formId,
    isPending,
    onOpenChange,
    pendingSubmitLabel,
    submitLabel,
}: RoleFormModalFooterProps) {
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
