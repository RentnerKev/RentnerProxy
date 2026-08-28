import AuthShell from '../../../shared/AuthShell/AuthShell'
import FieldError from '../../../shared/Forms/FieldError'
import FormMessage from '../../../shared/Forms/FormMessage'
import PasswordInput from '../../../shared/Forms/PasswordInput'
import { uiClassNames } from '../../../shared/Styles/uiClassNames'
import useSetupLogic from './Hooks/useSetupLogic'
import {
    displayNameSchema,
    emailSchema,
    getPasswordConfirmationMessage,
    getValidationMessage,
    newPasswordSchema,
} from '../Shared/validation'

export default function SetupPage() {
    const { state } = useSetupLogic()

    return (
        <AuthShell
            eyebrow="First-run setup"
            title="Create the owner"
            description="Bootstrap this installation with one verified owner account. Setup closes permanently after this step."
            footer="The first-owner transaction is protected by PostgreSQL, even if two setup requests arrive together."
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
                    name="displayName"
                    validators={{
                        onBlur: ({ value }) => getValidationMessage(displayNameSchema, value),
                    }}
                >
                    {(field) => (
                        <div className={uiClassNames.form.field}>
                            <label className={uiClassNames.form.label} htmlFor={field.name}>
                                Display name
                            </label>
                            <input
                                className={uiClassNames.form.control}
                                id={field.name}
                                name={field.name}
                                autoComplete="name"
                                maxLength={100}
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
                                autoComplete="email"
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
                        onBlur: ({ value }) => getValidationMessage(newPasswordSchema, value),
                    }}
                >
                    {(field) => (
                        <div className={uiClassNames.form.field}>
                            <label className={uiClassNames.form.label} htmlFor={field.name}>
                                Password
                            </label>
                            <PasswordInput
                                id={field.name}
                                name={field.name}
                                autoComplete="new-password"
                                maxLength={256}
                                value={field.state.value}
                                onBlur={field.handleBlur}
                                onChange={(event) => field.handleChange(event.target.value)}
                                aria-describedby={`${field.name}-hint ${field.name}-error`}
                            />
                            <p id={`${field.name}-hint`} className={uiClassNames.form.hint}>
                                Use at least 12 characters. No composition rules are imposed.
                            </p>
                            <FieldError
                                id={`${field.name}-error`}
                                errors={field.state.meta.errors}
                            />
                        </div>
                    )}
                </state.form.Field>

                <state.form.Field
                    name="confirmPassword"
                    validators={{
                        onBlur: ({ value, fieldApi }) =>
                            getPasswordConfirmationMessage(
                                fieldApi.form.getFieldValue('password'),
                                value,
                            ),
                    }}
                >
                    {(field) => (
                        <div className={uiClassNames.form.field}>
                            <label className={uiClassNames.form.label} htmlFor={field.name}>
                                Confirm password
                            </label>
                            <PasswordInput
                                id={field.name}
                                name={field.name}
                                autoComplete="new-password"
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
                            {isSubmitting || state.isPending ? 'Creating owner…' : 'Create owner'}
                        </button>
                    )}
                </state.form.Subscribe>
            </form>
        </AuthShell>
    )
}
