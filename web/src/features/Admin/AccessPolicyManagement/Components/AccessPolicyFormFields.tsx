import { CheckboxInput, RadioInput, TextInput, Textarea } from '@rentnerkev/inputs'
import { CustomSelect } from '@rentnerkev/select/select'
import useTranslationStore from '../../../../language/useTranslationStore'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import {
    FORWARD_AUTH_PROVIDERS,
    isCanonicalForwardAuthEndpoint,
} from '../../../../shared/Helpers/forwardAuth'
import { getAccessPolicyAvailability } from '../Helpers/basicAuthPolicyState'
import {
    defaultAccessPolicyIpRules,
    parseAccessPolicyIpRulesDraft,
    splitIpRuleLines,
} from '../Helpers/ipAccessPolicyState'
import type { AccessPolicyFormFieldsProps } from '../Types/access-policy-form.types'

const modes = ['public', 'authenticated', 'ip-restricted', 'combined'] as const
const requestHeaderOptions = ['Cookie', 'Authorization'] as const

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
    setAuthMethod,
    setForwardAuthProvider,
    setForwardAuthEndpoint,
    setForwardAuthGatewayPathPrefix,
    setForwardAuthTimeout,
    setForwardAuthRequestHeader,
    setForwardAuthResponseHeaders,
    values,
}: AccessPolicyFormFieldsProps) {
    const { t } = useTranslationStore()
    const nameErrorId = `${formId}-name-error`
    const combinationErrorId = `${formId}-combination-error`
    const ipRulesErrorId = `${formId}-ip-rules-error`
    const ipRulesSectionVisible = hasIpRulesSection(values.mode)
    const authenticationModeVisible = values.mode === 'authenticated' || values.mode === 'combined'
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
    const availabilityKey =
        authenticationModeVisible && values.authMethod === 'forwardAuth'
            ? isCanonicalForwardAuthEndpoint(values.forwardAuth.endpoint)
                ? 'forwardAuthConfigured'
                : 'forwardAuthMissing'
            : availability
    const availabilityClassName =
        availabilityKey === 'publicIgnored'
            ? 'border-border bg-surface-subtle'
            : availabilityKey.includes('Missing') || availability.includes('BlocksAll')
              ? 'border-amber-500/35 bg-amber-500/10'
              : 'border-brand-600/25 bg-success-bg'

    return (
        <>
            <div className={uiClassNames.form.field}>
                <label className={uiClassNames.form.label} htmlFor={`${formId}-name`}>
                    {t('admin.accessPolicies.form.name')}
                </label>
                <TextInput
                    id={`${formId}-name`}
                    name="name"
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
                <CustomSelect
                    id={`${formId}-mode`}
                    name="mode"
                    required
                    aria-label={t('admin.accessPolicies.form.mode')}
                    disabled={isPending}
                    aria-describedby={`${formId}-mode-hint`}
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
            {authenticationModeVisible ? (
                <fieldset
                    className={`${uiClassNames.permission.fieldset} ${uiClassNames.form.wide}`}
                >
                    <legend>{t('admin.accessPolicies.form.authenticationMethod')}</legend>
                    <div className="grid gap-2">
                        {(['basicAuth', 'forwardAuth'] as const).map((method) => (
                            <label
                                className={uiClassNames.permission.option}
                                htmlFor={`${formId}-authentication-${method}`}
                                key={method}
                            >
                                <RadioInput
                                    type="radio"
                                    id={`${formId}-authentication-${method}`}
                                    name="authenticationMethod"
                                    checked={values.authMethod === method}
                                    disabled={isPending}
                                    onChange={() => setAuthMethod(method)}
                                />
                                <span className={uiClassNames.permission.copy}>
                                    <span className={uiClassNames.permission.title}>
                                        {t(
                                            method === 'forwardAuth'
                                                ? 'admin.accessPolicies.form.forwardAuth.title'
                                                : 'admin.accessPolicies.form.basicAuth',
                                        )}
                                    </span>
                                </span>
                            </label>
                        ))}
                    </div>
                </fieldset>
            ) : null}
            {authenticationModeVisible && values.authMethod === 'forwardAuth' ? (
                <fieldset
                    className={`${uiClassNames.permission.fieldset} ${uiClassNames.form.wide} grid gap-3`}
                >
                    <legend>{t('admin.accessPolicies.form.forwardAuth.title')}</legend>
                    <p className={uiClassNames.form.hint}>
                        {t('admin.accessPolicies.form.forwardAuth.description')}
                    </p>
                    <div className={uiClassNames.form.field}>
                        <label
                            className={uiClassNames.form.label}
                            htmlFor={`${formId}-forwardAuth-provider`}
                        >
                            {t('admin.accessPolicies.form.forwardAuth.provider')}
                        </label>
                        <CustomSelect
                            id={`${formId}-forwardAuth-provider`}
                            name="forwardAuth.provider"
                            required
                            aria-label={t('admin.accessPolicies.form.forwardAuth.provider')}
                            disabled={isPending}
                            options={FORWARD_AUTH_PROVIDERS.map((provider) => ({
                                value: provider,
                                label: t(
                                    `admin.accessPolicies.form.forwardAuth.providers.${provider}`,
                                ),
                            }))}
                            value={values.forwardAuth.provider}
                            onValueChange={setForwardAuthProvider}
                        />
                    </div>
                    <div className={uiClassNames.form.field}>
                        <label
                            className={uiClassNames.form.label}
                            htmlFor={`${formId}-forwardAuth-gatewayPathPrefix`}
                        >
                            {t('admin.accessPolicies.form.forwardAuth.gatewayPathPrefix')}
                        </label>
                        <TextInput
                            id={`${formId}-forwardAuth-gatewayPathPrefix`}
                            name="forwardAuth.gatewayPathPrefix"
                            value={values.forwardAuth.gatewayPathPrefix}
                            disabled={isPending}
                            aria-invalid={errors.forwardAuth !== undefined}
                            aria-describedby={`${formId}-forwardAuth-gatewayPathPrefix-hint ${formId}-forwardAuth-error`}
                            onChange={(event) =>
                                setForwardAuthGatewayPathPrefix(event.target.value)
                            }
                        />
                        <p
                            id={`${formId}-forwardAuth-gatewayPathPrefix-hint`}
                            className={uiClassNames.form.hint}
                        >
                            {t('admin.accessPolicies.form.forwardAuth.gatewayPathPrefixHint')}
                        </p>
                    </div>
                    <div className={uiClassNames.form.field}>
                        <label
                            className={uiClassNames.form.label}
                            htmlFor={`${formId}-forwardAuth-endpoint`}
                        >
                            {t('admin.accessPolicies.form.forwardAuth.endpoint')}
                        </label>
                        <TextInput
                            id={`${formId}-forwardAuth-endpoint`}
                            name="forwardAuth.endpoint"
                            inputMode="url"
                            autoCapitalize="none"
                            autoCorrect="off"
                            spellCheck={false}
                            value={values.forwardAuth.endpoint}
                            disabled={isPending}
                            aria-invalid={errors.forwardAuth !== undefined}
                            aria-describedby={`${formId}-forwardAuth-endpoint-hint ${formId}-forwardAuth-error`}
                            onChange={(event) => setForwardAuthEndpoint(event.target.value)}
                        />
                        <p
                            id={`${formId}-forwardAuth-endpoint-hint`}
                            className={uiClassNames.form.hint}
                        >
                            {t(
                                `admin.accessPolicies.form.forwardAuth.endpointHint.${values.forwardAuth.provider}`,
                            )}
                        </p>
                    </div>
                    <div className={uiClassNames.form.field}>
                        <label
                            className={uiClassNames.form.label}
                            htmlFor={`${formId}-forwardAuth-timeout`}
                        >
                            {t('admin.accessPolicies.form.forwardAuth.timeout')}
                        </label>
                        <TextInput
                            id={`${formId}-forwardAuth-timeout`}
                            name="forwardAuth.timeoutSeconds"
                            inputMode="numeric"
                            min={1}
                            max={30}
                            step={1}
                            value={values.forwardAuth.timeoutSeconds}
                            disabled={isPending}
                            aria-invalid={errors.forwardAuth !== undefined}
                            aria-describedby={`${formId}-forwardAuth-error`}
                            onChange={(event) => setForwardAuthTimeout(event.target.value)}
                        />
                    </div>
                    <div className={uiClassNames.form.field}>
                        <span className={uiClassNames.form.label}>
                            {t('admin.accessPolicies.form.forwardAuth.requestHeaders')}
                        </span>
                        {requestHeaderOptions.map((header) => (
                            <label
                                className={uiClassNames.permission.option}
                                htmlFor={`${formId}-forwardAuth-request-${header}`}
                                key={header}
                            >
                                <CheckboxInput
                                    type="checkbox"
                                    id={`${formId}-forwardAuth-request-${header}`}
                                    name={`forwardAuth.requestHeaders.${header}`}
                                    checked={values.forwardAuth.requestHeaders.includes(header)}
                                    disabled={isPending}
                                    onChange={(event) =>
                                        setForwardAuthRequestHeader(header, event.target.checked)
                                    }
                                />
                                <span className={uiClassNames.permission.copy}>
                                    <span className={uiClassNames.permission.title}>{header}</span>
                                </span>
                            </label>
                        ))}
                    </div>
                    <div className={uiClassNames.form.field}>
                        <label
                            className={uiClassNames.form.label}
                            htmlFor={`${formId}-forwardAuth-responseHeaders`}
                        >
                            {t('admin.accessPolicies.form.forwardAuth.responseHeaders')}
                        </label>
                        <Textarea
                            id={`${formId}-forwardAuth-responseHeaders`}
                            name="forwardAuth.responseHeaders"
                            value={values.forwardAuth.responseHeaders}
                            disabled={isPending}
                            rows={4}
                            autoCapitalize="none"
                            autoCorrect="off"
                            spellCheck={false}
                            aria-invalid={errors.forwardAuth !== undefined}
                            aria-describedby={`${formId}-forwardAuth-responseHeaders-hint ${formId}-forwardAuth-error`}
                            placeholder={t(
                                'admin.accessPolicies.form.forwardAuth.responseHeadersHint',
                            )}
                            onChange={(event) => setForwardAuthResponseHeaders(event.target.value)}
                        />
                        <p
                            id={`${formId}-forwardAuth-responseHeaders-hint`}
                            className={uiClassNames.form.hint}
                        >
                            {t('admin.accessPolicies.form.forwardAuth.responseHeadersDescription')}
                        </p>
                    </div>
                    {errors.forwardAuth ? (
                        <p
                            id={`${formId}-forwardAuth-error`}
                            className="m-0 text-sm text-danger-text"
                            role="alert"
                        >
                            {t(errors.forwardAuth)}
                        </p>
                    ) : null}
                </fieldset>
            ) : null}
            {values.mode === 'combined' ? (
                <fieldset
                    className={`${uiClassNames.permission.fieldset} ${uiClassNames.form.wide}`}
                >
                    <legend>{t('admin.accessPolicies.form.combination')}</legend>
                    <div className="grid gap-2">
                        {(values.authMethod === 'forwardAuth'
                            ? (['all'] as const)
                            : (['all', 'any'] as const)
                        ).map((combination) => (
                            <label
                                className={uiClassNames.permission.option}
                                aria-label={t(`admin.accessPolicies.combination.${combination}`)}
                                htmlFor={`${formId}-combination-${combination}`}
                                key={combination}
                            >
                                <RadioInput
                                    type="radio"
                                    id={`${formId}-combination-${combination}`}
                                    name="combination"
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
                        <CheckboxInput
                            type="checkbox"
                            id={`${formId}-ip-rules-enabled`}
                            name="ipRules.enabled"
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
                                <CustomSelect
                                    id={`${formId}-ip-rules-default-action`}
                                    name="ipRules.defaultAction"
                                    required
                                    aria-label={t(
                                        'admin.accessPolicies.form.ipRules.defaultAction',
                                    )}
                                    disabled={isPending}
                                    aria-describedby={`${formId}-ip-rules-default-action-hint`}
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
                                <Textarea
                                    id={`${formId}-ip-rules-allow`}
                                    name="ipRules.allow"
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
                                <Textarea
                                    id={`${formId}-ip-rules-deny`}
                                    name="ipRules.deny"
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
                    {t(`admin.accessPolicies.availability.${availabilityKey}`)}
                </p>
            </aside>
        </>
    )
}
