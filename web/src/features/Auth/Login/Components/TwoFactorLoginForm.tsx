import { TextInput } from '@rentnerkev/inputs'
import { Link } from '@tanstack/react-router'
import type { ChangeEvent } from 'react'

import FieldError from '../../../../shared/Forms/FieldError'
import type { TwoFactorLoginFormProps } from '../Types/login-component-props.types'

export default function TwoFactorLoginForm({
    state,
    onToggleMode,
    getCredentialError,
    normalizeCredential,
}: TwoFactorLoginFormProps) {
    return (
        <form
            className="mt-7 grid gap-[1.1rem]"
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
                            <div className="grid gap-[0.45rem]">
                                <label
                                    className="text-[0.82rem] font-[750] text-ink-soft"
                                    htmlFor={field.name}
                                >
                                    {mode === 'totp' ? 'Authenticator code' : 'Recovery code'}
                                </label>
                                <TextInput
                                    id={field.name}
                                    name={field.name}
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
            <state.form.Subscribe
                selector={(formState) =>
                    [formState.canSubmit, formState.isSubmitting, formState.values.mode] as const
                }
            >
                {([canSubmit, isSubmitting, mode]) => (
                    <>
                        <button
                            type="submit"
                            className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none bg-brand-500 text-navy-950 enabled:hover:bg-brand-300"
                            disabled={!canSubmit || isSubmitting || state.isPending}
                        >
                            {isSubmitting || state.isPending ? 'Verifying…' : 'Verify'}
                        </button>
                        {mode === 'recovery' || state.methods.includes('recovery') ? (
                            <button
                                type="button"
                                className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none bg-transparent text-muted enabled:hover:border-brand-600 enabled:hover:text-brand-text"
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
