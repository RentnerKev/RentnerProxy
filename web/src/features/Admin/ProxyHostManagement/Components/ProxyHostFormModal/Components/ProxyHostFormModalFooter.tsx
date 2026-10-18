import type { ProxyHostFormModalFooterProps } from '../Types/proxy-host-form.types.ts'
import FormModalActions from '@/shared/Forms/FormModalActions.tsx'
export default function ProxyHostFormModalFooter({
    form,
    ...props
}: ProxyHostFormModalFooterProps) {
    return (
        <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
            {([canSubmit, isSubmitting]) => (
                <FormModalActions {...props} canSubmit={canSubmit} isSubmitting={isSubmitting} />
            )}
        </form.Subscribe>
    )
}
