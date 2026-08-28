import { Link } from '@tanstack/react-router'

import AuthShell from '../../../shared/AuthShell/AuthShell'
import FieldError from '../../../shared/Forms/FieldError'
import FormMessage from '../../../shared/Forms/FormMessage'
import PasswordInput from '../../../shared/Forms/PasswordInput'
import { uiClassNames } from '../../../shared/Styles/uiClassNames'
import useLoginLogic from './Hooks/useLoginLogic'
import { credentialPasswordSchema, emailSchema, getValidationMessage } from '../Shared/validation'

export default function LoginPage() {
    const { state } = useLoginLogic()

    return (
        <AuthShell
            eyebrow="Secure access"
            title="Welcome back"
            description="Sign in to manage this RentnerProxy installation. Credentials are verified only on the server."
            footer={
                <>
                    Lost access? <Link to="/forgot-password">Reset your password</Link>.
                </>
            }
        >
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
                    validators={{
                        onBlur: ({ value }) => getValidationMessage(emailSchema, value),
                    }}
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
                                onChange={(event) => field.handleChange(event.target.value)}
                                aria-describedby={`${field.name}-error`}
                            />
                            <FieldError
                                id={`${field.name}-error`}
                                errors={field.state.meta.errors}
                            />
                        </div>
                    )}
                </state.form.Field>

                <state.form.Field
                    name="password"
                    validators={{
                        onBlur: ({ value }) =>
                            getValidationMessage(credentialPasswordSchema, value),
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
                                onChange={(event) => field.handleChange(event.target.value)}
                                aria-describedby={`${field.name}-error`}
                            />
                            <FieldError
                                id={`${field.name}-error`}
                                errors={field.state.meta.errors}
                            />
                        </div>
                    )}
                </state.form.Field>

                {state.result && !state.result.success ? (
                    <FormMessage tone="error">{state.result.message}</FormMessage>
                ) : null}
                {state.isError ? (
                    <FormMessage tone="error">
                        Authentication service temporarily unavailable.
                    </FormMessage>
                ) : null}

                <state.form.Subscribe
                    selector={(formState) => [formState.canSubmit, formState.isSubmitting] as const}
                >
                    {([canSubmit, isSubmitting]) => (
                        <button
                            type="submit"
                            className={uiClassNames.button.primary}
                            disabled={!canSubmit || isSubmitting || state.isPending}
                        >
                            {isSubmitting || state.isPending ? 'Signing in…' : 'Sign in'}
                        </button>
                    )}
                </state.form.Subscribe>
            </form>
        </AuthShell>
    )
}
