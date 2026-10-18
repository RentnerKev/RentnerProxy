import { PasswordInput } from '@rentnerkev/inputs'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import getFieldErrorMessage from '@/lib/Forms/fieldErrors.ts'
import type { ChangePasswordFormProps } from '../Types/change-password-form-props.types.ts'
import { buttonClassName } from '@/shared/Buttons/buttonStyles.ts'

export default function ChangePasswordForm({ state, form, handler }: ChangePasswordFormProps) {
    const { t } = useTranslationStore()

    return (
        <form className="mt-7 grid gap-[1.1rem]" noValidate onSubmit={handler.handleSubmit}>
            <form.Field
                name="currentPassword"
                validators={{ onBlur: handler.validateCurrentPassword }}
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
                            onValueChange={field.handleChange}
                            error={getFieldErrorMessage(field.state.meta.errors, t)}
                        />
                    </div>
                )}
            </form.Field>
            <form.Field name="password" validators={{ onBlur: handler.validatePassword }}>
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
                            onValueChange={field.handleChange}
                            error={getFieldErrorMessage(field.state.meta.errors, t)}
                        />
                    </div>
                )}
            </form.Field>
            <form.Field
                name="confirmPassword"
                validators={{ onBlur: handler.validateConfirmPassword }}
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
                            onValueChange={field.handleChange}
                            error={getFieldErrorMessage(field.state.meta.errors, t)}
                        />
                    </div>
                )}
            </form.Field>
            <form.Subscribe
                selector={(formState) => [formState.canSubmit, formState.isSubmitting] as const}
            >
                {([canSubmit, isSubmitting]) => (
                    <button
                        type="submit"
                        className={buttonClassName('primary')}
                        disabled={!canSubmit || isSubmitting || state.isPending}
                    >
                        {isSubmitting || state.isPending
                            ? t('account.password.changing')
                            : t('account.password.change')}
                    </button>
                )}
            </form.Subscribe>
        </form>
    )
}
