import type { ProxyHostFormModalFooterProps } from '../Types/proxy-host-form.types.ts'
import FormModalActions from '@/shared/Forms/FormModalActions.tsx'
export default function ProxyHostFormModalFooter({
    form,
    requestNewCertificate,
    ...props
}: ProxyHostFormModalFooterProps) {
    return (
        <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
            {([canSubmit, isSubmitting]) => (
                <FormModalActions
                    {...props}
                    submitDescriptionId={
                        requestNewCertificate ? `${props.formId}-acme-consent` : undefined
                    }
                    canSubmit={canSubmit}
                    isSubmitting={isSubmitting}
                />
            )}
        </form.Subscribe>
    )
}
