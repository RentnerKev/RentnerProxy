import useTranslationStore from '../../../../language/useTranslationStore'
import SelectControl from '../../../../shared/Select'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import { getAccessPolicyAvailability } from '../Helpers/basicAuthPolicyState'
import {
    defaultAccessPolicyIpRules,
    parseAccessPolicyIpRulesDraft,
    splitIpRuleLines,
} from '../Helpers/ipAccessPolicyState'
import type { AccessPolicyFormFieldsProps } from '../Types/access-policy-form.types'

const modes = ['public', 'authenticated', 'ip-restricted', 'combined'] as const

function hasIpRulesSection(mode: AccessPolicyFormFieldsProps['values']['mode']): boolean {
    return mode === 'ip-restricted' || mode === 'combined'
}

export default function AccessPolicyFormFields({
    basicAuthAccountCount,
    errors,
    formId,
    isPending,
    setCombination,
    setIpRules,
    setIpRuleAllow,
    setIpRuleDefaultAction,
    setIpRuleDeny,
    setMode,
    setName,
    values,
}: AccessPolicyFormFieldsProps) {
    const { t } = useTranslationStore()
    const nameErrorId = `${formId}-name-error`
    const combinationErrorId = `${formId}-combination-error`
    const ipRulesErrorId = `${formId}-ip-rules-error`
    const ipRulesSectionVisible = hasIpRulesSection(values.mode)
    const parsedIpRules = values.ipRules
        ? parseAccessPolicyIpRulesDraft(values.ipRules)
        : { rules: null }
    const availabilityIpRules = values.ipRules
        ? 'error' in parsedIpRules
            ? {
                  defaultAction: values.ipRules.defaultAction,
                  allow: splitIpRuleLines(values.ipRules.allow),
                  deny: splitIpRuleLines(values.ipRules.deny),
              }
            : parsedIpRules.rules
        : null
    const availability = getAccessPolicyAvailability(
        values.mode,
        values.combination,
        basicAuthAccountCount,
        availabilityIpRules,
    )
    const availabilityClassName =
        availability === 'publicIgnored'
            ? 'border-border bg-surface-subtle'
            : availability.includes('Missing') || availability.includes('BlocksAll')
              ? 'border-amber-500/35 bg-amber-500/10'
              : 'border-brand-600/25 bg-success-bg'

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
                <label className={uiClassNames.form.label} htmlFor={`${formId}-mode`}>
                    {t('admin.accessPolicies.form.mode')}
                </label>
                <SelectControl
                    id={`${formId}-mode`}
                    name="mode"
                    required
                    ariaLabel={t('admin.accessPolicies.form.mode')}
                    className={uiClassNames.form.select}
                    disabled={isPending}
                    describedBy={`${formId}-mode-hint`}
                    options={modes.map((mode) => ({
                        label: t(`admin.accessPolicies.mode.${mode}`),
                        value: mode,
                    }))}
                    value={values.mode}
                    onValueChange={setMode}
                />
                <p id={`${formId}-mode-hint`} className={uiClassNames.form.hint}>
                    {t('admin.accessPolicies.form.modeHint')}
                </p>
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
            {ipRulesSectionVisible ? (
                <fieldset
                    className={`${uiClassNames.permission.fieldset} ${uiClassNames.form.wide} grid gap-3`}
                    aria-describedby={ipRulesErrorId}
                >
                    <legend>{t('admin.accessPolicies.form.ipRules.title')}</legend>
                    <p className={uiClassNames.form.hint}>
                        {t('admin.accessPolicies.form.ipRules.description')}
                    </p>
                    <label
                        className={uiClassNames.permission.option}
                        htmlFor={`${formId}-ip-rules-enabled`}
                        aria-label={t('admin.accessPolicies.form.ipRules.configure')}
                    >
                        <input
                            type="checkbox"
                            id={`${formId}-ip-rules-enabled`}
                            name="ipRules.enabled"
                            className={uiClassNames.permission.checkbox}
                            checked={values.ipRules !== null}
                            disabled={isPending}
                            onChange={(event) =>
                                setIpRules(
                                    event.target.checked ? { ...defaultAccessPolicyIpRules } : null,
                                )
                            }
                        />
                        <span className={uiClassNames.permission.copy}>
                            <span className={uiClassNames.permission.title}>
                                {t('admin.accessPolicies.form.ipRules.configure')}
                            </span>
                            <span className={uiClassNames.form.hint}>
                                {t('admin.accessPolicies.form.ipRules.configureHint')}
                            </span>
                        </span>
                    </label>
                    {values.ipRules ? (
                        <>
                            <div className={uiClassNames.form.field}>
                                <label
                                    className={uiClassNames.form.label}
                                    htmlFor={`${formId}-ip-rules-default-action`}
                                >
                                    {t('admin.accessPolicies.form.ipRules.defaultAction')}
                                </label>
                                <SelectControl
                                    id={`${formId}-ip-rules-default-action`}
                                    name="ipRules.defaultAction"
                                    required
                                    ariaLabel={t('admin.accessPolicies.form.ipRules.defaultAction')}
                                    className={uiClassNames.form.select}
                                    disabled={isPending}
                                    describedBy={`${formId}-ip-rules-default-action-hint`}
                                    options={[
                                        {
                                            label: t('admin.accessPolicies.form.ipRules.allow'),
                                            value: 'allow',
                                        },
                                        {
                                            label: t(
                                                'admin.accessPolicies.form.ipRules.denyRecommended',
                                            ),
                                            value: 'deny',
                                        },
                                    ]}
                                    value={values.ipRules.defaultAction}
                                    onValueChange={setIpRuleDefaultAction}
                                />
                                <p
                                    id={`${formId}-ip-rules-default-action-hint`}
                                    className={uiClassNames.form.hint}
                                >
                                    {t('admin.accessPolicies.form.ipRules.defaultActionHint')}
                                </p>
                            </div>
                            <div className={uiClassNames.form.field}>
                                <label
                                    className={uiClassNames.form.label}
                                    htmlFor={`${formId}-ip-rules-allow`}
                                >
                                    {t('admin.accessPolicies.form.ipRules.allow')}
                                </label>
                                <textarea
                                    id={`${formId}-ip-rules-allow`}
                                    name="ipRules.allow"
                                    className={uiClassNames.form.textarea}
                                    value={values.ipRules.allow}
                                    disabled={isPending}
                                    rows={4}
                                    autoCapitalize="none"
                                    autoCorrect="off"
                                    spellCheck={false}
                                    aria-invalid={errors.ipRules !== undefined}
                                    aria-describedby={ipRulesErrorId}
                                    placeholder={t('admin.accessPolicies.form.ipRules.allowHint')}
                                    onChange={(event) => setIpRuleAllow(event.target.value)}
                                />
                            </div>
                            <div className={uiClassNames.form.field}>
                                <label
                                    className={uiClassNames.form.label}
                                    htmlFor={`${formId}-ip-rules-deny`}
                                >
                                    {t('admin.accessPolicies.form.ipRules.deny')}
                                </label>
                                <textarea
                                    id={`${formId}-ip-rules-deny`}
                                    name="ipRules.deny"
                                    className={uiClassNames.form.textarea}
                                    value={values.ipRules.deny}
                                    disabled={isPending}
                                    rows={4}
                                    autoCapitalize="none"
                                    autoCorrect="off"
                                    spellCheck={false}
                                    aria-invalid={errors.ipRules !== undefined}
                                    aria-describedby={ipRulesErrorId}
                                    placeholder={t('admin.accessPolicies.form.ipRules.denyHint')}
                                    onChange={(event) => setIpRuleDeny(event.target.value)}
                                />
                            </div>
                        </>
                    ) : null}
                    {errors.ipRules ? (
                        <p
                            id={ipRulesErrorId}
                            className="m-0 text-sm text-danger-text"
                            role="alert"
                        >
                            {t(errors.ipRules)}
                        </p>
                    ) : null}
                </fieldset>
            ) : null}
            <aside
                className={`${uiClassNames.form.wide} rounded-xl border p-3 text-sm leading-relaxed text-ink-soft ${availabilityClassName}`}
                role={availability === 'publicIgnored' ? undefined : 'status'}
            >
                <p className="m-0 font-extrabold">
                    {t('admin.accessPolicies.form.availabilityTitle')}
                </p>
                <p className="mt-1 mb-0">
                    {t(`admin.accessPolicies.availability.${availability}`)}
                </p>
            </aside>
        </>
    )
}
