import { PasswordInput } from '@rentnerkev/inputs'
import useTranslationStore from '../../../language/useTranslationStore'
import getFieldErrorMessage, {
    getValidationIssue,
} from '../../../shared/Forms/Helpers/getFieldErrorMessage'
import type { ChangeEvent } from 'react'
import type { ChangePasswordFormProps } from '../Types/user-settings-component-props.types'
import { credentialPasswordSchema, newPasswordSchema } from '../../Auth/Shared/validation'

export default function ChangePasswordForm({ state }: ChangePasswordFormProps) {
    const { t } = useTranslationStore()

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
            <state.form.Field
                name="currentPassword"
                validators={{
                    onBlur: ({ value }) => getValidationIssue(credentialPasswordSchema, value),
                }}
            >
                {(field) => (
                    <div className="grid gap-[0.45rem]">
                        <label
                            className="text-[0.82rem] font-[750] text-ink-soft"
                            htmlFor={field.name}
                        >
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
                            error={getFieldErrorMessage(field.state.meta.errors, t)}
                        />
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
                    <div className="grid gap-[0.45rem]">
                        <label
                            className="text-[0.82rem] font-[750] text-ink-soft"
                            htmlFor={field.name}
                        >
                            {t('account.password.newPassword')}
                        </label>
                        <PasswordInput
                            id={field.name}
                            name={field.name}
                            autoComplete="new-password"
                            showPasswordStrength
                            maxLength={256}
                            value={field.state.value}
                            onBlur={field.handleBlur}
                            onChange={(event: ChangeEvent<HTMLInputElement>) =>
                                field.handleChange(event.target.value)
                            }
                            error={getFieldErrorMessage(field.state.meta.errors, t)}
                        />
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
                    <div className="grid gap-[0.45rem]">
                        <label
                            className="text-[0.82rem] font-[750] text-ink-soft"
                            htmlFor={field.name}
                        >
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
                            error={getFieldErrorMessage(field.state.meta.errors, t)}
                        />
                    </div>
                )}
            </state.form.Field>
            <state.form.Subscribe
                selector={(formState) => [formState.canSubmit, formState.isSubmitting] as const}
            >
                {([canSubmit, isSubmitting]) => (
                    <button
                        type="submit"
                        className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none bg-accent text-accent-foreground enabled:hover:bg-accent-hover"
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
