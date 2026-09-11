import useTranslationStore from '../../../../language/useTranslationStore'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import type { BasicAuthAccountFormFieldsProps } from '../Types/basic-auth.types'

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
            <div className={uiClassNames.form.field}>
                <label className={uiClassNames.form.label} htmlFor={`${formId}-username`}>
                    {t('admin.accessPolicies.basicAuth.form.username')}
                </label>
                <input
                    id={`${formId}-username`}
                    name="username"
                    className={uiClassNames.form.control}
                    value={values.username}
                    maxLength={64}
                    autoComplete="username"
                    disabled={isPending}
                    onChange={(event) => setUsername(event.target.value)}
                    aria-invalid={errors.username !== undefined}
                    aria-describedby={usernameErrorId}
                />
                <p className={uiClassNames.form.hint}>
                    {t('admin.accessPolicies.basicAuth.form.usernameHint')}
                </p>
                {errors.username ? (
                    <p id={usernameErrorId} className="m-0 text-sm text-danger-text" role="alert">
                        {t(errors.username)}
                    </p>
                ) : null}
            </div>
            <div className={uiClassNames.form.field}>
                <label className={uiClassNames.form.label} htmlFor={`${formId}-password`}>
                    {t('admin.accessPolicies.basicAuth.form.password')}
                </label>
                <input
                    id={`${formId}-password`}
                    name="password"
                    type="password"
                    className={uiClassNames.form.control}
                    value={values.password}
                    maxLength={256}
                    autoComplete="new-password"
                    disabled={isPending}
                    onChange={(event) => setPassword(event.target.value)}
                    aria-invalid={errors.password !== undefined}
                    aria-describedby={passwordErrorId}
                />
                <p className={uiClassNames.form.hint}>
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
