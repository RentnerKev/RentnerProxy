import { Link } from '@tanstack/react-router'
import type { ChangeEvent } from 'react'
import FieldError from '../../../../shared/Forms/FieldError'
import PasswordInput from '../../../../shared/Forms/PasswordInput'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import type { LoginFormProps } from '../Types/login-component-props.types'
import {
    credentialPasswordSchema,
    emailSchema,
    getValidationMessage,
} from '../../Shared/validation'
export default function LoginForm({ state, onPasskeyLogin }: LoginFormProps) {
    return (
        <form
            className={uiClassNames.form.stack}
            noValidate
            onSubmit={(event) => {
                event.preventDefault()
                event.stopPropagation()
                void state.form.handleSubmit()
            }}
        >
            <state.form.Field
                name="email"
                validators={{ onBlur: ({ value }) => getValidationMessage(emailSchema, value) }}
            >
                {(field) => (
                    <div className={uiClassNames.form.field}>
                        <label className={uiClassNames.form.label} htmlFor={field.name}>
                            Email address
                        </label>
                        <input
                            className={uiClassNames.form.control}
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
            </state.form.Field>
            <state.form.Field
                name="password"
                validators={{
                    onBlur: ({ value }) => getValidationMessage(credentialPasswordSchema, value),
                }}
            >
                {(field) => (
                    <div className={uiClassNames.form.field}>
                        <div className={uiClassNames.form.labelRow}>
                            <label className={uiClassNames.form.label} htmlFor={field.name}>
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
            </state.form.Field>
            <state.form.Subscribe
                selector={(formState) => [formState.canSubmit, formState.isSubmitting] as const}
            >
                {([canSubmit, isSubmitting]) => (
                    <button
                        type="submit"
                        className={uiClassNames.button.primary}
                        disabled={
                            !canSubmit || isSubmitting || state.isPending || state.isPasskeyPending
                        }
                    >
                        {isSubmitting || state.isPending ? 'Signing in…' : 'Sign in'}
                    </button>
                )}
            </state.form.Subscribe>
            <button
                type="button"
                className={uiClassNames.button.secondary}
                onClick={onPasskeyLogin}
                disabled={state.isPending || state.isPasskeyPending}
            >
                {state.isPasskeyPending ? 'Checking passkey…' : 'Sign in with passkey'}
            </button>
        </form>
    )
}
