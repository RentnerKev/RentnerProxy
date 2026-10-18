import { EmailInput, PasswordInput } from '@rentnerkev/inputs'
import { Link } from '@tanstack/react-router'
import FieldError from '@/shared/Forms/FieldError.tsx'
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
                    <div className="grid gap-[0.45rem]">
                        <label
                            className="text-[0.82rem] font-[750] text-ink-soft"
                            htmlFor={field.name}
                        >
                            Email address
                        </label>
                        <EmailInput
                            id={field.name}
                            name={field.name}
                            type="email"
                            inputMode="email"
                            autoComplete="username"
                            maxLength={254}
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
                        <div className="flex items-center justify-between gap-4 text-[0.82rem] font-[750] text-ink-soft [&_a]:text-[0.76rem]">
                            <label
                                className="text-[0.82rem] font-[750] text-ink-soft"
                                htmlFor={field.name}
                            >
                                Password
                            </label>
                            <Link to="/forgot-password">Forgot password?</Link>
                        </div>
                        <PasswordInput
                            id={field.name}
                            name={field.name}
                            autoComplete="current-password"
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
                        disabled={
                            !canSubmit || isSubmitting || state.isPending || state.isPasskeyPending
                        }
                    >
                        {isSubmitting || state.isPending ? 'Signing in…' : 'Sign in'}
                    </button>
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
