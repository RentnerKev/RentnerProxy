import type { UserFormModalFooterProps } from '../Types/user-form-modal.types.ts'
import FormModalActions from '@/shared/Forms/FormModalActions.tsx'
export default function UserFormModalFooter({ form, ...props }: UserFormModalFooterProps) {
    return (
        <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
            {([canSubmit, isSubmitting]) => (
                <FormModalActions {...props} canSubmit={canSubmit} isSubmitting={isSubmitting} />
            )}
        </form.Subscribe>
    )
}
