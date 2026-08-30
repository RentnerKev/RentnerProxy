import FieldError from '../../../../shared/Forms/FieldError'
import FormMessage from '../../../../shared/Forms/FormMessage'
import PasswordInput from '../../../../shared/Forms/PasswordInput'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import type { ChangeEvent } from 'react'
import type { PasswordResetFormProps } from '../Types/password-reset-component-props.types'
import {
    getPasswordConfirmationMessage,
    getValidationMessage,
    newPasswordSchema,
} from '../../Shared/validation'

export default function PasswordResetForm({ state }: PasswordResetFormProps) {
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
                name="password"
                validators={{
                    onBlur: ({ value }) => getValidationMessage(newPasswordSchema, value),
                }}
            >
                {(field) => (
                    <div className={uiClassNames.form.field}>
                        <label className={uiClassNames.form.label} htmlFor={field.name}>
                            New password
                        </label>
                        <PasswordInput
                            id={field.name}
                            name={field.name}
                            autoComplete="new-password"
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
                            Confirm new password
                        </label>
                        <PasswordInput
                            id={field.name}
                            name={field.name}
                            autoComplete="new-password"
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
                        {isSubmitting || state.isPending ? 'Updating password…' : 'Update password'}
                    </button>
                )}
            </state.form.Subscribe>
        </form>
    )
}
