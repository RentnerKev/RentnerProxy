import FieldError from '../../../../shared/Forms/FieldError'
import FormMessage from '../../../../shared/Forms/FormMessage'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import type { ForgotPasswordFormProps } from '../Types/forgot-password-component-props.types'
import { emailSchema, getValidationMessage } from '../../Shared/validation'

export default function ForgotPasswordForm({ state }: ForgotPasswordFormProps) {
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
                        <FieldError id={`${field.name}-error`} errors={field.state.meta.errors} />
                    </div>
                )}
            </state.form.Field>
            {state.result ? (
                <FormMessage tone={state.result.success ? 'success' : 'error'}>
                    {state.result.message}
                </FormMessage>
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
                        {isSubmitting || state.isPending ? 'Requesting link…' : 'Send reset link'}
                    </button>
                )}
            </state.form.Subscribe>
        </form>
    )
}
