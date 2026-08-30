import { Link } from '@tanstack/react-router'
import type { ChangeEvent } from 'react'

import FieldError from '../../../../shared/Forms/FieldError'
import FormMessage from '../../../../shared/Forms/FormMessage'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import type { TwoFactorLoginFormProps } from '../Types/login-component-props.types'

export default function TwoFactorLoginForm({
    state,
    onToggleMode,
    getCredentialError,
    normalizeCredential,
}: TwoFactorLoginFormProps) {
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
            <state.form.Subscribe selector={(formState) => formState.values.mode}>
                {(mode) => (
                    <state.form.Field
                        name="credential"
                        validators={{
                            onBlur: ({ value }) => getCredentialError(mode, value),
                        }}
                    >
                        {(field) => (
                            <div className={uiClassNames.form.field}>
                                <label className={uiClassNames.form.label} htmlFor={field.name}>
                                    {mode === 'totp' ? 'Authenticator code' : 'Recovery code'}
                                </label>
                                <input
                                    id={field.name}
                                    name={field.name}
                                    className={uiClassNames.form.control}
                                    autoComplete={mode === 'totp' ? 'one-time-code' : 'off'}
                                    inputMode={mode === 'totp' ? 'numeric' : 'text'}
                                    maxLength={mode === 'totp' ? 6 : 128}
                                    value={field.state.value}
                                    onBlur={field.handleBlur}
                                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                                        field.handleChange(
                                            normalizeCredential(mode, event.target.value),
                                        )
                                    }
                                    aria-describedby={`${field.name}-error`}
                                />
                                <FieldError
                                    id={`${field.name}-error`}
                                    errors={field.state.meta.errors}
                                />
                            </div>
                        )}
                    </state.form.Field>
                )}
            </state.form.Subscribe>
            {state.errorMessage ? (
                <FormMessage tone="error">{state.errorMessage}</FormMessage>
            ) : null}
            <state.form.Subscribe
                selector={(formState) =>
                    [formState.canSubmit, formState.isSubmitting, formState.values.mode] as const
                }
            >
                {([canSubmit, isSubmitting, mode]) => (
                    <>
                        <button
                            type="submit"
                            className={uiClassNames.button.primary}
                            disabled={!canSubmit || isSubmitting || state.isPending}
                        >
                            {isSubmitting || state.isPending ? 'Verifying…' : 'Verify'}
                        </button>
                        {mode === 'recovery' || state.methods.includes('recovery') ? (
                            <button
                                type="button"
                                className={uiClassNames.button.quiet}
                                disabled={isSubmitting || state.isPending}
                                onClick={onToggleMode}
                            >
                                {mode === 'totp'
                                    ? 'Use a recovery code'
                                    : 'Use an authenticator code'}
                            </button>
                        ) : null}
                    </>
                )}
            </state.form.Subscribe>
            <Link to="/login" className="text-center text-sm text-muted hover:text-brand-text">
                Back to sign in
            </Link>
        </form>
    )
}
