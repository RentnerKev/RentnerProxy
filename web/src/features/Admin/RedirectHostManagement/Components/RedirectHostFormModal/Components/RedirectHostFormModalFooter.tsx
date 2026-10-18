import type { RedirectHostFormModalFooterProps } from '../Types/redirect-host-form.types.ts'
import FormModalActions from '@/shared/Forms/FormModalActions.tsx'
export default function RedirectHostFormModalFooter({
    form,
    ...props
}: RedirectHostFormModalFooterProps) {
    return (
        <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
            {([canSubmit, isSubmitting]) => (
                <FormModalActions {...props} canSubmit={canSubmit} isSubmitting={isSubmitting} />
            )}
        </form.Subscribe>
    )
}
