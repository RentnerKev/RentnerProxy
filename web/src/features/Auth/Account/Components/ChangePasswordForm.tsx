import FieldError from '../../../../shared/Forms/FieldError'
import FormMessage from '../../../../shared/Forms/FormMessage'
import PasswordInput from '../../../../shared/Forms/PasswordInput'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import type { ChangeEvent } from 'react'
import type { ChangePasswordFormProps } from '../Types/account-component-props.types'
import {
    credentialPasswordSchema,
    getPasswordConfirmationMessage,
    getValidationMessage,
    newPasswordSchema,
} from '../../Shared/validation'

export default function ChangePasswordForm({ state }: ChangePasswordFormProps) {
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
                name="currentPassword"
                validators={{
                    onBlur: ({ value }) => getValidationMessage(credentialPasswordSchema, value),
                }}
            >
                {(field) => (
                    <div className={uiClassNames.form.field}>
                        <label className={uiClassNames.form.label} htmlFor={field.name}>
                            Current password
                        </label>
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
                            aria-describedby={`${field.name}-hint ${field.name}-error`}
                        />
                        <p id={`${field.name}-hint`} className={uiClassNames.form.hint}>
                            Use at least 12 characters.
                        </p>
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
            {state.result ? (
                <FormMessage tone={state.result.success ? 'success' : 'error'}>
                    {state.result.message}
                </FormMessage>
            ) : null}
            {state.isError ? (
                <FormMessage tone="error">The password could not be changed.</FormMessage>
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
                        {isSubmitting || state.isPending ? 'Changing password…' : 'Change password'}
                    </button>
                )}
            </state.form.Subscribe>
        </form>
    )
}
