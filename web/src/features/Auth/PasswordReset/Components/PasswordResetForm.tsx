import StringFormField from '@/shared/Forms/StringFormField.tsx'
import FormSubmitButton from '@/shared/Forms/FormSubmitButton.tsx'
import type { PasswordResetFormProps } from '../Types/password-reset-component-props.types.ts'

export default function PasswordResetForm({ state, form, handler }: PasswordResetFormProps) {
    return (
        <form
            method="post"
            className="mt-7 grid gap-[1.1rem]"
            noValidate
            onSubmit={handler.handleSubmit}
        >
            <form.Field name="password" validators={{ onBlur: handler.validatePassword }}>
                {(field) => (
                    <StringFormField
                        field={field}
                        label="New password"
                        kind="password"
                        autoComplete="new-password"
                        maxLength={256}
                        showPasswordStrength
                    />
                )}
            </form.Field>
            <form.Field
                name="confirmPassword"
                validators={{ onBlur: handler.validateConfirmPassword }}
            >
                {(field) => (
                    <StringFormField
                        field={field}
                        label="Confirm new password"
                        kind="password"
                        autoComplete="new-password"
                        maxLength={256}
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
                        submitLabel="Update password"
                        pendingSubmitLabel="Updating password…"
                    />
                )}
            </form.Subscribe>
        </form>
    )
}
