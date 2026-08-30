import FieldError from '../../../shared/Forms/FieldError'
import FormMessage from '../../../shared/Forms/FormMessage'
import PasswordInput from '../../../shared/Forms/PasswordInput'
import { uiClassNames } from '../../../shared/Styles/uiClassNames'
import useTranslationStore from '../../../language/useTranslationStore'
import { getValidationIssue } from '../../../shared/Forms/Helpers/getFieldErrorMessage'
import type { ChangeEvent } from 'react'
import type { ChangePasswordFormProps } from '../Types/user-settings-component-props.types'
import { credentialPasswordSchema, newPasswordSchema } from '../../Auth/Shared/validation'

export default function ChangePasswordForm({ state }: ChangePasswordFormProps) {
    const { t } = useTranslationStore()

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
                    onBlur: ({ value }) => getValidationIssue(credentialPasswordSchema, value),
                }}
            >
                {(field) => (
                    <div className={uiClassNames.form.field}>
                        <label className={uiClassNames.form.label} htmlFor={field.name}>
                            {t('account.password.currentPassword')}
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
                    onBlur: ({ value }) => getValidationIssue(newPasswordSchema, value),
                }}
            >
                {(field) => (
                    <div className={uiClassNames.form.field}>
                        <label className={uiClassNames.form.label} htmlFor={field.name}>
                            {t('account.password.newPassword')}
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
                    onBlur: ({ value, fieldApi }) => {
                        const password = fieldApi.form.getFieldValue('password')
                        return password === value
                            ? undefined
                            : 'account.validation.passwordsDoNotMatch'
                    },
                }}
            >
                {(field) => (
                    <div className={uiClassNames.form.field}>
                        <label className={uiClassNames.form.label} htmlFor={field.name}>
                            {t('account.password.confirmNewPassword')}
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
                <FormMessage tone="error">account.password.error.update</FormMessage>
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
                        {isSubmitting || state.isPending
                            ? t('account.password.changing')
                            : t('account.password.change')}
                    </button>
                )}
            </state.form.Subscribe>
        </form>
    )
}
