import { EmailInput, PasswordInput } from '@rentnerkev/inputs'
import { Link } from '@tanstack/react-router'
import type { ChangeEvent } from 'react'
import FieldError from '@/shared/Forms/FieldError.tsx'
import type { LoginFormProps } from '../Types/login-component-props.types.ts'
export default function LoginForm({ state, form, handler, onPasskeyLogin }: LoginFormProps) {
    return (
        <form className="mt-7 grid gap-[1.1rem]" noValidate onSubmit={handler.handleSubmit}>
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
                            onChange={(event: ChangeEvent<HTMLInputElement>) =>
                                field.handleChange(event.target.value)
                            }
                            aria-describedby={`${field.name}-error`}
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
                            onChange={(event: ChangeEvent<HTMLInputElement>) =>
                                field.handleChange(event.target.value)
                            }
                            aria-describedby={`${field.name}-error`}
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
                        className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none bg-accent text-accent-foreground enabled:hover:bg-accent-hover"
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
                className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none border-border-strong bg-surface-raised text-ink-soft enabled:hover:border-accent-border enabled:hover:text-accent-ring"
                onClick={onPasskeyLogin}
                disabled={state.isPending || state.isPasskeyPending}
            >
                {state.isPasskeyPending ? 'Checking passkey…' : 'Sign in with passkey'}
            </button>
        </form>
    )
}
