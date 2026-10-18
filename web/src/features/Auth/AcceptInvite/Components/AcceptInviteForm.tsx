import { PasswordInput, TextInput } from '@rentnerkev/inputs'
import FieldError from '@/shared/Forms/FieldError.tsx'
import type { AcceptInviteFormProps } from '../Types/accept-invite-component-props.types.ts'
import { buttonClassName } from '@/shared/Buttons/buttonStyles.ts'

export default function AcceptInviteForm({ state, form, handler }: AcceptInviteFormProps) {
    return (
        <form
            method="post"
            className="mt-7 grid gap-[1.1rem]"
            noValidate
            onSubmit={handler.handleSubmit}
        >
            <form.Field name="displayName" validators={{ onBlur: handler.validateDisplayName }}>
                {(field) => (
                    <div className="grid gap-[0.45rem]">
                        <label
                            className="text-[0.82rem] font-[750] text-ink-soft"
                            htmlFor={field.name}
                        >
                            Display name
                        </label>
                        <TextInput
                            id={field.name}
                            name={field.name}
                            autoComplete="name"
                            maxLength={100}
                            value={field.state.value}
                            onBlur={field.handleBlur}
                            onValueChange={field.handleChange}
                            aria-describedby={`${field.name}-error`}
                            aria-invalid={field.state.meta.errors.length > 0}
                        />
                        <FieldError id={`${field.name}-error`} errors={field.state.meta.errors} />
                    </div>
                )}
            </form.Field>
            <form.Field name="password" validators={{ onBlur: handler.validatePassword }}>
                {(field) => (
                    <div className="grid gap-[0.45rem]">
                        <label
                            className="text-[0.82rem] font-[750] text-ink-soft"
                            htmlFor={field.name}
                        >
                            Password
                        </label>
                        <PasswordInput
                            id={field.name}
                            name={field.name}
                            autoComplete="new-password"
                            showPasswordStrength
                            maxLength={256}
                            value={field.state.value}
                            onBlur={field.handleBlur}
                            onValueChange={field.handleChange}
                            aria-describedby={`${field.name}-error`}
                            aria-invalid={field.state.meta.errors.length > 0}
                        />
                        <FieldError id={`${field.name}-error`} errors={field.state.meta.errors} />
                    </div>
                )}
            </form.Field>
            <form.Field
                name="confirmPassword"
                validators={{ onBlur: handler.validateConfirmPassword }}
            >
                {(field) => (
                    <div className="grid gap-[0.45rem]">
                        <label
                            className="text-[0.82rem] font-[750] text-ink-soft"
                            htmlFor={field.name}
                        >
                            Confirm password
                        </label>
                        <PasswordInput
                            id={field.name}
                            name={field.name}
                            autoComplete="new-password"
                            maxLength={256}
                            value={field.state.value}
                            onBlur={field.handleBlur}
                            onValueChange={field.handleChange}
                            aria-describedby={`${field.name}-error`}
                            aria-invalid={field.state.meta.errors.length > 0}
                        />
                        <FieldError id={`${field.name}-error`} errors={field.state.meta.errors} />
                    </div>
                )}
            </form.Field>
            <form.Subscribe
                selector={(formState) => [formState.canSubmit, formState.isSubmitting] as const}
            >
                {([canSubmit, isSubmitting]) => (
                    <button
                        type="submit"
                        className={buttonClassName('primary')}
                        disabled={!canSubmit || isSubmitting || state.isPending}
                    >
                        {isSubmitting || state.isPending
                            ? 'Activating account…'
                            : 'Activate account'}
                    </button>
                )}
            </form.Subscribe>
        </form>
    )
}
