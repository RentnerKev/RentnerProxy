import { PasswordInput, TextInput } from '@rentnerkev/inputs'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type { BasicAuthAccountFormFieldsProps } from '../../../Types/basic-auth.types.ts'

export default function BasicAuthAccountFormFields({
    errors,
    formId,
    isPending,
    mode,
    setPassword,
    setUsername,
    values,
}: BasicAuthAccountFormFieldsProps) {
    const { t } = useTranslationStore()
    const usernameErrorId = `${formId}-username-error`
    const passwordErrorId = `${formId}-password-error`

    return (
        <>
            <div className="grid gap-[0.45rem]">
                <label
                    className="text-[0.82rem] font-[750] text-ink-soft"
                    htmlFor={`${formId}-username`}
                >
                    {t('admin.accessPolicies.basicAuth.form.username')}
                </label>
                <TextInput
                    id={`${formId}-username`}
                    name="username"
                    value={values.username}
                    maxLength={64}
                    autoComplete="username"
                    disabled={isPending}
                    onValueChange={setUsername}
                    aria-invalid={errors.username !== undefined}
                    aria-describedby={usernameErrorId}
                />
                <p className="m-0 text-[0.76rem] leading-[1.45] text-muted">
                    {t('admin.accessPolicies.basicAuth.form.usernameHint')}
                </p>
                {errors.username ? (
                    <p id={usernameErrorId} className="m-0 text-sm text-danger-text" role="alert">
                        {t(errors.username)}
                    </p>
                ) : null}
            </div>
            <div className="grid gap-[0.45rem]">
                <label
                    className="text-[0.82rem] font-[750] text-ink-soft"
                    htmlFor={`${formId}-password`}
                >
                    {t('admin.accessPolicies.basicAuth.form.password')}
                </label>
                <PasswordInput
                    id={`${formId}-password`}
                    name="password"
                    type="password"
                    value={values.password}
                    showPasswordStrength={mode === 'create' || values.password !== ''}
                    maxLength={256}
                    autoComplete="new-password"
                    disabled={isPending}
                    onValueChange={setPassword}
                    aria-invalid={errors.password !== undefined}
                    aria-describedby={passwordErrorId}
                />
                <p className="m-0 text-[0.76rem] leading-[1.45] text-muted">
                    {t(
                        mode === 'edit'
                            ? 'admin.accessPolicies.basicAuth.form.passwordEditHint'
                            : 'admin.accessPolicies.basicAuth.form.passwordCreateHint',
                    )}
                </p>
                {errors.password ? (
                    <p id={passwordErrorId} className="m-0 text-sm text-danger-text" role="alert">
                        {t(errors.password)}
                    </p>
                ) : null}
            </div>
        </>
    )
}
