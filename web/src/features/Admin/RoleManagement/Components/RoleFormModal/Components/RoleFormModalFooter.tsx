import type { RoleFormModalFooterProps } from '../Types/role-form-modal.types.ts'
import FormModalActions from '@/shared/Forms/FormModalActions.tsx'
export default function RoleFormModalFooter({ form, ...props }: RoleFormModalFooterProps) {
    return (
        <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
            {([canSubmit, isSubmitting]) => (
                <FormModalActions {...props} canSubmit={canSubmit} isSubmitting={isSubmitting} />
            )}
        </form.Subscribe>
    )
}
