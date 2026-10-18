import StringFormField from '@/shared/Forms/StringFormField.tsx'
import FormSubmitButton from '@/shared/Forms/FormSubmitButton.tsx'
import type { ForgotPasswordFormProps } from '../Types/forgot-password-component-props.types.ts'

export default function ForgotPasswordForm({ state, form, handler }: ForgotPasswordFormProps) {
    return (
        <form
            method="post"
            className="mt-7 grid gap-[1.1rem]"
            noValidate
            onSubmit={handler.handleSubmit}
        >
            <form.Field name="email" validators={{ onBlur: handler.validateEmail }}>
                {(field) => (
                    <StringFormField
                        field={field}
                        label="Email address"
                        kind="email"
                        autoComplete="email"
                        maxLength={254}
                    />
                )}
            </form.Field>
            <form.Subscribe
                selector={(formState) => [formState.canSubmit, formState.isSubmitting] as const}
            >
                {([canSubmit, isSubmitting]) => (
                    <FormSubmitButton
                        canSubmit={canSubmit}
                        isSubmitting={isSubmitting}
                        isPending={state.isPending}
                        submitLabel="Send reset link"
                        pendingSubmitLabel="Requesting link…"
                    />
                )}
            </form.Subscribe>
        </form>
    )
}
