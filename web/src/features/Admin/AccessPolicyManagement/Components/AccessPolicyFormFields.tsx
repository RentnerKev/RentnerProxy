import useTranslationStore from '../../../../language/useTranslationStore'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import SelectControl from '../../../../shared/Select'
import { getBasicAuthStatus } from '../Helpers/basicAuthPolicyState'
import type { AccessPolicyFormFieldsProps } from '../Types/access-policy-form.types'

const modes = ['public', 'authenticated', 'ip-restricted', 'combined'] as const

export default function AccessPolicyFormFields({
    basicAuthAccountCount,
    errors,
    formId,
    isPending,
    setCombination,
    setMode,
    setName,
    values,
}: AccessPolicyFormFieldsProps) {
    const { t } = useTranslationStore()
    const nameErrorId = `${formId}-name-error`
    const combinationErrorId = `${formId}-combination-error`
    const basicAuthStatus = getBasicAuthStatus(
        values.mode,
        values.combination,
        basicAuthAccountCount,
    )

    return (
        <>
            <div className={uiClassNames.form.field}>
                <label className={uiClassNames.form.label} htmlFor={`${formId}-name`}>
                    {t('admin.accessPolicies.form.name')}
                </label>
                <input
                    id={`${formId}-name`}
                    name="name"
                    className={uiClassNames.form.control}
                    value={values.name}
                    maxLength={120}
                    disabled={isPending}
                    onChange={(event) => setName(event.target.value)}
                    aria-invalid={errors.name !== undefined}
                    aria-describedby={nameErrorId}
                />
                {errors.name ? (
                    <p id={nameErrorId} className="m-0 text-sm text-danger-text" role="alert">
                        {t(errors.name)}
                    </p>
                ) : null}
            </div>
            <div className={uiClassNames.form.field}>
                <span className={uiClassNames.form.label}>
                    {t('admin.accessPolicies.form.mode')}
                </span>
                <SelectControl
                    ariaLabel={t('admin.accessPolicies.form.mode')}
                    className={uiClassNames.form.select}
                    disabled={isPending}
                    options={modes.map((mode) => ({
                        label: t(`admin.accessPolicies.mode.${mode}`),
                        value: mode,
                    }))}
                    value={values.mode}
                    onValueChange={setMode}
                />
                <p className={uiClassNames.form.hint}>{t('admin.accessPolicies.form.modeHint')}</p>
            </div>
            {values.mode === 'combined' ? (
                <fieldset
                    className={`${uiClassNames.permission.fieldset} ${uiClassNames.form.wide}`}
                >
                    <legend>{t('admin.accessPolicies.form.combination')}</legend>
                    <div className="grid gap-2">
                        {(['all', 'any'] as const).map((combination) => (
                            <label
                                className={uiClassNames.permission.option}
                                aria-label={t(`admin.accessPolicies.combination.${combination}`)}
                                htmlFor={`${formId}-combination-${combination}`}
                                key={combination}
                            >
                                <input
                                    type="radio"
                                    id={`${formId}-combination-${combination}`}
                                    name="combination"
                                    className={uiClassNames.permission.checkbox}
                                    checked={values.combination === combination}
                                    disabled={isPending}
                                    onChange={() => setCombination(combination)}
                                />
                                <span className={uiClassNames.permission.copy}>
                                    <span className={uiClassNames.permission.title}>
                                        {t(`admin.accessPolicies.combination.${combination}`)}
                                    </span>
                                    <span className={uiClassNames.form.hint}>
                                        {t(
                                            `admin.accessPolicies.combinationDescription.${combination}`,
                                        )}
                                    </span>
                                </span>
                            </label>
                        ))}
                    </div>
                    {errors.combination ? (
                        <p
                            id={combinationErrorId}
                            className="m-0 text-sm text-danger-text"
                            role="alert"
                        >
                            {t(errors.combination)}
                        </p>
                    ) : null}
                </fieldset>
            ) : null}
            <aside
                className={`${uiClassNames.form.wide} rounded-xl border border-amber-500/35 bg-amber-500/10 p-3 text-sm leading-relaxed text-ink-soft`}
                role={basicAuthStatus === 'publicIgnored' ? undefined : 'status'}
            >
                <p className="m-0 font-extrabold">
                    {t('admin.accessPolicies.form.availabilityTitle')}
                </p>
                <p className="mt-1 mb-0">
                    {t(`admin.accessPolicies.basicAuth.status.${basicAuthStatus}`)}
                </p>
            </aside>
        </>
    )
}
