import StringFormField from '@/shared/Forms/StringFormField.tsx'
import FormSubmitButton from '@/shared/Forms/FormSubmitButton.tsx'
import { Link } from '@tanstack/react-router'
import type { LoginFormProps } from '../Types/login-component-props.types.ts'
import { buttonClassName } from '@/shared/Buttons/buttonStyles.ts'
export default function LoginForm({ state, form, handler, onPasskeyLogin }: LoginFormProps) {
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
                        autoComplete="username"
                        maxLength={254}
                    />
                )}
            </form.Field>
            <form.Field name="password" validators={{ onBlur: handler.validatePassword }}>
                {(field) => (
                    <StringFormField
                        field={field}
                        label="Password"
                        kind="password"
                        autoComplete="current-password"
                        maxLength={256}
                        labelAction={<Link to="/forgot-password">Forgot password?</Link>}
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
                        disabled={state.isPasskeyPending}
                        submitLabel="Sign in"
                        pendingSubmitLabel="Signing in…"
                    />
                )}
            </form.Subscribe>
            <button
                type="button"
                className={buttonClassName('secondary')}
                onClick={onPasskeyLogin}
                disabled={state.isPending || state.isPasskeyPending}
            >
                {state.isPasskeyPending ? 'Checking passkey…' : 'Sign in with passkey'}
            </button>
        </form>
    )
}
