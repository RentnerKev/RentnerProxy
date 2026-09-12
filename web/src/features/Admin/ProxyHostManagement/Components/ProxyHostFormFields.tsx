import useTranslationStore from '../../../../language/useTranslationStore'
import { certificateCoversDomains } from '../../CertificateManagement/Helpers/certificateValidation'
import FieldError from '../../../../shared/Forms/FieldError'
import { getValidationIssue } from '../../../../shared/Forms/Helpers/getFieldErrorMessage'
import SelectControl from '../../../../shared/Select'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import {
    getAccessPolicyAvailability,
    getBasicAuthAccountCount,
} from '../../AccessPolicyManagement/Helpers/basicAuthPolicyState'
import type { ProxyHostFormFieldsProps } from '../Types/proxy-host-form.types'
import { proxyForwardHostSchema, proxyHostFormSchema } from '../validation'
import DomainInputs from './DomainInputs'
import UpstreamTlsFields from './UpstreamTlsFields'

export default function ProxyHostFormFields({
    addDomain,
    canChangeEnabled,
    canAssignCertificates,
    canAssignPolicies,
    assignableAccessPolicies,
    assignableAccessPoliciesLoadFailed,
    assignableAccessPoliciesLoading,
    assignableCertificates,
    assignableCertificatesLoadFailed,
    assignableCertificatesLoading,
    assignableTrustedCas,
    trustedCasLoadFailed,
    trustedCasLoading,
    domainKeys,
    form,
    formId,
    isPending,
    removeDomain,
    retryAssignableAccessPolicies,
    retryAssignableCertificates,
}: ProxyHostFormFieldsProps) {
    const { t } = useTranslationStore()

    return (
        <>
            <DomainInputs
                addDomain={addDomain}
                domainKeys={domainKeys}
                form={form}
                formId={formId}
                isPending={isPending}
                removeDomain={removeDomain}
            />
            <form.Field name="forwardScheme">
                {(field) => (
                    <div className={uiClassNames.form.field}>
                        <label
                            className={uiClassNames.form.label}
                            htmlFor={`${formId}-forwardScheme`}
                        >
                            {t('admin.proxyHosts.form.forwardScheme')}
                        </label>
                        <SelectControl
                            id={`${formId}-forwardScheme`}
                            name={field.name}
                            required
                            ariaLabel={t('admin.proxyHosts.form.forwardScheme')}
                            className={uiClassNames.form.select}
                            disabled={isPending}
                            invalid={field.state.meta.errors.length > 0}
                            describedBy={`${formId}-forwardScheme-error`}
                            onBlur={field.handleBlur}
                            options={[
                                { label: t('admin.proxyHosts.scheme.http'), value: 'http' },
                                { label: t('admin.proxyHosts.scheme.https'), value: 'https' },
                            ]}
                            value={field.state.value}
                            onValueChange={(value) => {
                                if (value !== 'http' && value !== 'https') return
                                if (value !== field.state.value) {
                                    form.setFieldValue('verifyUpstreamTls', true)
                                    form.setFieldValue('upstreamTlsServerName', null)
                                    form.setFieldValue('trustedCaId', null)
                                }
                                field.handleChange(value)
                            }}
                        />
                        <FieldError
                            id={`${formId}-forwardScheme-error`}
                            errors={field.state.meta.errors}
                        />
                    </div>
                )}
            </form.Field>
            <form.Field
                name="forwardPort"
                validators={{
                    onBlur: ({ value }) =>
                        getValidationIssue(proxyHostFormSchema.shape.forwardPort, value),
                }}
            >
                {(field) => {
                    const inputId = `${formId}-${field.name}`
                    const errorId = `${inputId}-error`

                    return (
                        <div className={uiClassNames.form.field}>
                            <label className={uiClassNames.form.label} htmlFor={inputId}>
                                {t('admin.proxyHosts.form.forwardPort')}
                            </label>
                            <input
                                id={inputId}
                                name={field.name}
                                className={uiClassNames.form.control}
                                value={field.state.value}
                                disabled={isPending}
                                inputMode="numeric"
                                maxLength={5}
                                onBlur={field.handleBlur}
                                onChange={(event) => field.handleChange(event.target.value)}
                                aria-invalid={field.state.meta.errors.length > 0}
                                aria-describedby={errorId}
                            />
                            <FieldError id={errorId} errors={field.state.meta.errors} />
                        </div>
                    )
                }}
            </form.Field>
            <form.Field
                name="forwardHost"
                validators={{
                    onBlur: ({ value }) => getValidationIssue(proxyForwardHostSchema, value),
                }}
            >
                {(field) => {
                    const inputId = `${formId}-${field.name}`
                    const errorId = `${inputId}-error`
                    const hintId = `${inputId}-hint`

                    return (
                        <div className={`${uiClassNames.form.field} ${uiClassNames.form.wide}`}>
                            <label className={uiClassNames.form.label} htmlFor={inputId}>
                                {t('admin.proxyHosts.form.forwardHost')}
                            </label>
                            <input
                                id={inputId}
                                name={field.name}
                                className={uiClassNames.form.control}
                                value={field.state.value}
                                maxLength={1_024}
                                disabled={isPending}
                                autoCapitalize="none"
                                autoCorrect="off"
                                spellCheck={false}
                                placeholder={t('admin.proxyHosts.form.forwardHostPlaceholder')}
                                onBlur={field.handleBlur}
                                onChange={(event) => field.handleChange(event.target.value)}
                                aria-invalid={field.state.meta.errors.length > 0}
                                aria-describedby={`${hintId} ${errorId}`}
                            />
                            <p id={hintId} className={uiClassNames.form.hint}>
                                {t('admin.proxyHosts.form.forwardHostHint')}
                            </p>
                            <FieldError id={errorId} errors={field.state.meta.errors} />
                        </div>
                    )
                }}
            </form.Field>
            <UpstreamTlsFields
                form={form}
                formId={formId}
                isPending={isPending}
                assignableTrustedCas={assignableTrustedCas}
                trustedCasLoadFailed={trustedCasLoadFailed}
                trustedCasLoading={trustedCasLoading}
            />
            <form.Field name="certificateId">
                {(field) => {
                    const usableCertificates = assignableCertificates.filter(
                        (certificate) =>
                            (certificate.status === 'valid' || certificate.status === 'expiring') &&
                            certificateCoversDomains(
                                certificate.domains,
                                form.state.values.domains,
                            ),
                    )
                    return canAssignCertificates ? (
                        <div className={`${uiClassNames.form.field} ${uiClassNames.form.wide}`}>
                            <label
                                className={uiClassNames.form.label}
                                htmlFor={`${formId}-certificateId`}
                            >
                                {t('admin.proxyHosts.form.certificate')}
                            </label>
                            <SelectControl
                                id={`${formId}-certificateId`}
                                name={field.name}
                                ariaLabel={t('admin.proxyHosts.form.certificate')}
                                className={uiClassNames.form.select}
                                disabled={
                                    isPending ||
                                    assignableCertificatesLoading ||
                                    assignableCertificatesLoadFailed
                                }
                                invalid={field.state.meta.errors.length > 0}
                                describedBy={`${formId}-certificateId-hint ${formId}-certificateId-error`}
                                onBlur={field.handleBlur}
                                value={field.state.value ?? ''}
                                placeholder={t('admin.proxyHosts.form.noCertificate')}
                                options={usableCertificates.map((certificate) => ({
                                    value: certificate.id,
                                    label:
                                        certificate.name + ' · ' + certificate.domains.join(', '),
                                }))}
                                onValueChange={(value) => {
                                    field.handleChange(value || null)
                                    if (!value) form.setFieldValue('forceHttps', false)
                                }}
                            />
                            <p
                                id={`${formId}-certificateId-hint`}
                                className={uiClassNames.form.hint}
                            >
                                {t('admin.proxyHosts.form.certificateHint')}
                            </p>
                            {assignableCertificatesLoading ? (
                                <output className={uiClassNames.form.hint}>
                                    {t('common.loading')}
                                </output>
                            ) : assignableCertificatesLoadFailed ? (
                                <div className="flex flex-wrap items-center gap-2" role="alert">
                                    <p className="m-0 text-sm text-danger-text">
                                        {t('common.requestFailed')}
                                    </p>
                                    <button
                                        type="button"
                                        className={uiClassNames.button.quiet}
                                        onClick={retryAssignableCertificates}
                                        disabled={isPending}
                                    >
                                        {t('common.retry')}
                                    </button>
                                </div>
                            ) : null}
                            <FieldError
                                id={`${formId}-certificateId-error`}
                                errors={field.state.meta.errors}
                            />
                        </div>
                    ) : null
                }}
            </form.Field>
            <form.Field name="accessPolicyId">
                {(field) => {
                    const selectedPolicy = assignableAccessPolicies.find(
                        (policy) => policy.id === field.state.value,
                    )
                    const availability = selectedPolicy
                        ? getAccessPolicyAvailability(
                              selectedPolicy.mode,
                              selectedPolicy.combination,
                              getBasicAuthAccountCount(selectedPolicy),
                              selectedPolicy.ipRules,
                          )
                        : null
                    return canAssignPolicies ? (
                        <div className={`${uiClassNames.form.field} ${uiClassNames.form.wide}`}>
                            <label
                                className={uiClassNames.form.label}
                                htmlFor={`${formId}-accessPolicyId`}
                            >
                                {t('admin.proxyHosts.form.accessPolicy')}
                            </label>
                            <SelectControl
                                id={`${formId}-accessPolicyId`}
                                name={field.name}
                                ariaLabel={t('admin.proxyHosts.form.accessPolicy')}
                                className={uiClassNames.form.select}
                                disabled={
                                    isPending ||
                                    assignableAccessPoliciesLoading ||
                                    assignableAccessPoliciesLoadFailed
                                }
                                invalid={field.state.meta.errors.length > 0}
                                describedBy={`${formId}-accessPolicyId-hint`}
                                onBlur={field.handleBlur}
                                value={field.state.value ?? ''}
                                placeholder={t('admin.proxyHosts.form.noAccessPolicy')}
                                options={assignableAccessPolicies.map((policy) => ({
                                    value: policy.id,
                                    label: `${policy.name} · ${t(`admin.accessPolicies.mode.${policy.mode}`)}`,
                                }))}
                                onValueChange={(value) => field.handleChange(value || null)}
                            />
                            {availability ? (
                                <p className={uiClassNames.form.hint}>
                                    {t(`admin.accessPolicies.availability.${availability}`)}
                                </p>
                            ) : null}
                            <p
                                id={`${formId}-accessPolicyId-hint`}
                                className={uiClassNames.form.hint}
                            >
                                {t('admin.proxyHosts.form.accessPolicyHint')}
                            </p>
                            {assignableAccessPoliciesLoading ? (
                                <output className={uiClassNames.form.hint}>
                                    {t('common.loading')}
                                </output>
                            ) : assignableAccessPoliciesLoadFailed ? (
                                <div className="flex flex-wrap items-center gap-2" role="alert">
                                    <p className="m-0 text-sm text-danger-text">
                                        {t('common.requestFailed')}
                                    </p>
                                    <button
                                        type="button"
                                        className={uiClassNames.button.quiet}
                                        onClick={retryAssignableAccessPolicies}
                                        disabled={isPending}
                                    >
                                        {t('common.retry')}
                                    </button>
                                </div>
                            ) : null}
                        </div>
                    ) : null
                }}
            </form.Field>
            <form.Subscribe
                selector={(state) => [state.values.certificateId, state.values.domains] as const}
            >
                {([certificateId, domains]) => (
                    <form.Field name="forceHttps">
                        {(field) => {
                            const selected = assignableCertificates.find(
                                (certificate) => certificate.id === certificateId,
                            )
                            const usable =
                                selected !== undefined &&
                                (selected.status === 'valid' || selected.status === 'expiring') &&
                                certificateCoversDomains(selected.domains, domains)
                            return canAssignCertificates ? (
                                <div
                                    className={`${uiClassNames.form.field} ${uiClassNames.form.wide}`}
                                >
                                    <label
                                        className={uiClassNames.permission.option}
                                        htmlFor={`${formId}-forceHttps`}
                                        aria-label={t('admin.proxyHosts.form.forceHttps')}
                                    >
                                        <input
                                            type="checkbox"
                                            id={`${formId}-forceHttps`}
                                            name={field.name}
                                            className={uiClassNames.permission.checkbox}
                                            checked={Boolean(field.state.value)}
                                            disabled={isPending || !usable}
                                            onBlur={field.handleBlur}
                                            onChange={(event) =>
                                                field.handleChange(event.target.checked)
                                            }
                                        />
                                        <span className={uiClassNames.permission.copy}>
                                            <span className={uiClassNames.permission.title}>
                                                {t('admin.proxyHosts.form.forceHttps')}
                                            </span>
                                            <span className={uiClassNames.form.hint}>
                                                {t('admin.proxyHosts.form.forceHttpsHint')}
                                            </span>
                                        </span>
                                    </label>
                                    {!usable ? (
                                        <p className={uiClassNames.form.hint}>
                                            {t(
                                                'admin.proxyHosts.form.forceHttpsRequiresCertificate',
                                            )}
                                        </p>
                                    ) : null}
                                    <FieldError
                                        id={`${formId}-forceHttps-error`}
                                        errors={field.state.meta.errors}
                                    />
                                </div>
                            ) : null
                        }}
                    </form.Field>
                )}
            </form.Subscribe>
            <form.Field name="enabled">
                {(field) => (
                    <div className={`${uiClassNames.form.field} ${uiClassNames.form.wide}`}>
                        <label
                            className={uiClassNames.permission.option}
                            htmlFor={`${formId}-enabled`}
                            aria-label={t('admin.proxyHosts.status.enabled')}
                        >
                            <input
                                type="checkbox"
                                id={`${formId}-enabled`}
                                name={field.name}
                                className={uiClassNames.permission.checkbox}
                                checked={field.state.value}
                                disabled={isPending || !canChangeEnabled}
                                onBlur={field.handleBlur}
                                onChange={(event) => field.handleChange(event.target.checked)}
                            />
                            <span className={uiClassNames.permission.copy}>
                                <span className={uiClassNames.permission.title}>
                                    {t('admin.proxyHosts.status.enabled')}
                                </span>
                                <span className={uiClassNames.form.hint}>
                                    {t('admin.proxyHosts.form.enabledHint')}
                                </span>
                            </span>
                        </label>
                        {!canChangeEnabled ? (
                            <p className={uiClassNames.form.hint}>
                                {t('admin.proxyHosts.form.statusReadOnly')}
                            </p>
                        ) : null}
                    </div>
                )}
            </form.Field>
        </>
    )
}
