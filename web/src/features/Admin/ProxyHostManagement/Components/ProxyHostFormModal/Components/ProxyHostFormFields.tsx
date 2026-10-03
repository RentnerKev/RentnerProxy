import useProxyHostFormFieldsLogic from '../Hooks/useProxyHostFormFieldsLogic.ts'
import { CheckboxInput, TextInput } from '@rentnerkev/inputs'
import { CustomSelect } from '@rentnerkev/select/select'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import FieldError from '@/shared/Forms/FieldError.tsx'
import { getValidationIssue } from '@/lib/Forms/fieldErrors.ts'
import type { ProxyHostFormFieldsProps } from '../Types/proxy-host-form.types.ts'
import { proxyForwardHostSchema, proxyHostFormSchema } from '../../../validation.ts'
import DomainInputs from './DomainInputs.tsx'
import UpstreamTlsFields from './UpstreamTlsFields.tsx'
import CertificateRequestFields from '@/features/Admin/CertificateManagement/Components/CertificateRequestModal/Components/CertificateRequestFields.tsx'

export default function ProxyHostFormFields({
    addDomain,
    canChangeEnabled,
    canAssignCertificates,
    canRequestCertificate,
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
    requestNewCertificate,
    setRequestNewCertificate,
    certificateRequestForm,
}: ProxyHostFormFieldsProps) {
    const { t } = useTranslationStore()
    const {
        state: { usableCertificates, availability, usable },
        handler,
    } = useProxyHostFormFieldsLogic({
        form,
        assignableCertificates,
        assignableAccessPolicies,
        requestNewCertificate,
        setRequestNewCertificate,
    })

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
                    <div className="grid gap-[0.45rem]">
                        <label
                            className="text-[0.82rem] font-[750] text-ink-soft"
                            htmlFor={`${formId}-forwardScheme`}
                        >
                            {t('admin.proxyHosts.form.forwardScheme')}
                        </label>
                        <CustomSelect
                            id={`${formId}-forwardScheme`}
                            name={field.name}
                            required
                            aria-label={t('admin.proxyHosts.form.forwardScheme')}
                            disabled={isPending}
                            aria-invalid={field.state.meta.errors.length > 0}
                            aria-describedby={`${formId}-forwardScheme-error`}
                            onBlur={field.handleBlur}
                            options={[
                                { label: t('admin.proxyHosts.scheme.http'), value: 'http' },
                                { label: t('admin.proxyHosts.scheme.https'), value: 'https' },
                            ]}
                            value={field.state.value}
                            onValueChange={handler.handleSchemeChange}
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
                        <div className="grid gap-[0.45rem]">
                            <label
                                className="text-[0.82rem] font-[750] text-ink-soft"
                                htmlFor={inputId}
                            >
                                {t('admin.proxyHosts.form.forwardPort')}
                            </label>
                            <TextInput
                                id={inputId}
                                name={field.name}
                                value={field.state.value}
                                disabled={isPending}
                                inputMode="numeric"
                                maxLength={5}
                                onBlur={field.handleBlur}
                                onValueChange={field.handleChange}
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
                        <div className="grid gap-[0.45rem] shell:col-span-full">
                            <label
                                className="text-[0.82rem] font-[750] text-ink-soft"
                                htmlFor={inputId}
                            >
                                {t('admin.proxyHosts.form.forwardHost')}
                            </label>
                            <TextInput
                                id={inputId}
                                name={field.name}
                                value={field.state.value}
                                maxLength={1_024}
                                disabled={isPending}
                                autoCapitalize="none"
                                autoCorrect="off"
                                spellCheck={false}
                                placeholder={t('admin.proxyHosts.form.forwardHostPlaceholder')}
                                onBlur={field.handleBlur}
                                onValueChange={field.handleChange}
                                aria-invalid={field.state.meta.errors.length > 0}
                                aria-describedby={`${hintId} ${errorId}`}
                            />
                            <p id={hintId} className="m-0 text-[0.76rem] leading-[1.45] text-muted">
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
                    return canAssignCertificates || canRequestCertificate ? (
                        <div className="grid gap-[0.45rem] shell:col-span-full">
                            <label
                                className="text-[0.82rem] font-[750] text-ink-soft"
                                htmlFor={`${formId}-certificateId`}
                            >
                                {t('admin.proxyHosts.form.certificate')}
                            </label>
                            <CustomSelect
                                id={`${formId}-certificateId`}
                                name={field.name}
                                aria-label={t('admin.proxyHosts.form.certificate')}
                                disabled={
                                    isPending ||
                                    (canAssignCertificates &&
                                        (assignableCertificatesLoading ||
                                            assignableCertificatesLoadFailed))
                                }
                                aria-invalid={field.state.meta.errors.length > 0}
                                aria-describedby={`${formId}-certificateId-hint ${formId}-certificateId-error`}
                                onBlur={field.handleBlur}
                                value={
                                    requestNewCertificate
                                        ? '__request-new__'
                                        : (field.state.value ?? '')
                                }
                                placeholder={t('admin.proxyHosts.form.noCertificate')}
                                onValueChange={handler.handleCertificateChange}
                                options={[
                                    {
                                        value: '',
                                        label: t('admin.proxyHosts.form.noCertificate'),
                                    },
                                    ...(canRequestCertificate
                                        ? [
                                              {
                                                  value: '__request-new__',
                                                  label: t('admin.certificates.actions.request'),
                                              },
                                          ]
                                        : []),
                                    ...usableCertificates.map((certificate) => ({
                                        value: certificate.id,
                                        label:
                                            certificate.name +
                                            ' · ' +
                                            certificate.domains.join(', '),
                                    })),
                                ]}
                            />
                            <p
                                id={`${formId}-certificateId-hint`}
                                className="m-0 text-[0.76rem] leading-[1.45] text-muted"
                            >
                                {t('admin.proxyHosts.form.certificateHint')}
                            </p>
                            {assignableCertificatesLoading ? (
                                <output className="m-0 text-[0.76rem] leading-[1.45] text-muted">
                                    {t('common.loading')}
                                </output>
                            ) : assignableCertificatesLoadFailed ? (
                                <div className="flex flex-wrap items-center gap-2" role="alert">
                                    <p className="m-0 text-sm text-danger-text">
                                        {t('common.requestFailed')}
                                    </p>
                                    <button
                                        type="button"
                                        className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none bg-transparent text-muted enabled:hover:border-accent-border enabled:hover:text-accent-ring"
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
            {requestNewCertificate ? (
                <div className="shell:col-span-full grid gap-4 rounded-xl border border-info-text/20 bg-info-bg p-3">
                    <p className="m-0 text-sm leading-relaxed text-info-text">
                        {t('admin.certificates.form.domainsHint')}
                    </p>
                    <CertificateRequestFields
                        form={certificateRequestForm}
                        isPending={isPending}
                        readOnlyDomains
                    />
                </div>
            ) : null}
            <form.Field name="accessPolicyId">
                {(field) => {
                    return canAssignPolicies ? (
                        <div className="grid gap-[0.45rem] shell:col-span-full">
                            <label
                                className="text-[0.82rem] font-[750] text-ink-soft"
                                htmlFor={`${formId}-accessPolicyId`}
                            >
                                {t('admin.proxyHosts.form.accessPolicy')}
                            </label>
                            <CustomSelect
                                id={`${formId}-accessPolicyId`}
                                name={field.name}
                                aria-label={t('admin.proxyHosts.form.accessPolicy')}
                                disabled={
                                    isPending ||
                                    assignableAccessPoliciesLoading ||
                                    assignableAccessPoliciesLoadFailed
                                }
                                aria-invalid={field.state.meta.errors.length > 0}
                                aria-describedby={`${formId}-accessPolicyId-hint`}
                                onBlur={field.handleBlur}
                                value={field.state.value ?? ''}
                                placeholder={t('admin.proxyHosts.form.noAccessPolicy')}
                                options={[
                                    {
                                        value: '',
                                        label: t('admin.proxyHosts.form.noAccessPolicy'),
                                    },
                                    ...assignableAccessPolicies.map((policy) => ({
                                        value: policy.id,
                                        label: `${policy.name} · ${t(`admin.accessPolicies.mode.${policy.mode}`)}`,
                                    })),
                                ]}
                                onValueChange={(value) => field.handleChange(value || null)}
                            />
                            {availability ? (
                                <p className="m-0 text-[0.76rem] leading-[1.45] text-muted">
                                    {t(`admin.accessPolicies.availability.${availability}`)}
                                </p>
                            ) : null}
                            <p
                                id={`${formId}-accessPolicyId-hint`}
                                className="m-0 text-[0.76rem] leading-[1.45] text-muted"
                            >
                                {t('admin.proxyHosts.form.accessPolicyHint')}
                            </p>
                            {assignableAccessPoliciesLoading ? (
                                <output className="m-0 text-[0.76rem] leading-[1.45] text-muted">
                                    {t('common.loading')}
                                </output>
                            ) : assignableAccessPoliciesLoadFailed ? (
                                <div className="flex flex-wrap items-center gap-2" role="alert">
                                    <p className="m-0 text-sm text-danger-text">
                                        {t('common.requestFailed')}
                                    </p>
                                    <button
                                        type="button"
                                        className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none bg-transparent text-muted enabled:hover:border-accent-border enabled:hover:text-accent-ring"
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
            <form.Field name="forceHttps">
                {(field) => {
                    return canAssignCertificates ? (
                        <div className="grid gap-[0.45rem] shell:col-span-full">
                            <label
                                className="flex cursor-pointer items-start gap-[0.65rem] rounded-[0.7rem] border border-border bg-surface-raised p-[0.65rem]"
                                htmlFor={`${formId}-forceHttps`}
                                aria-label={t('admin.proxyHosts.form.forceHttps')}
                            >
                                <CheckboxInput
                                    type="checkbox"
                                    id={`${formId}-forceHttps`}
                                    name={field.name}
                                    checked={Boolean(field.state.value)}
                                    disabled={isPending || !usable}
                                    onBlur={field.handleBlur}
                                    onChange={(event) => field.handleChange(event.target.checked)}
                                />
                                <span className="grid gap-[0.12rem]">
                                    <span className="text-[0.78rem] text-ink-soft">
                                        {t('admin.proxyHosts.form.forceHttps')}
                                    </span>
                                    <span className="m-0 text-[0.76rem] leading-[1.45] text-muted">
                                        {t('admin.proxyHosts.form.forceHttpsHint')}
                                    </span>
                                </span>
                            </label>
                            {!usable ? (
                                <p className="m-0 text-[0.76rem] leading-[1.45] text-muted">
                                    {t('admin.proxyHosts.form.forceHttpsRequiresCertificate')}
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
            <form.Field name="enabled">
                {(field) => (
                    <div className="grid gap-[0.45rem] shell:col-span-full">
                        <label
                            className="flex cursor-pointer items-start gap-[0.65rem] rounded-[0.7rem] border border-border bg-surface-raised p-[0.65rem]"
                            htmlFor={`${formId}-enabled`}
                            aria-label={t('admin.proxyHosts.status.enabled')}
                        >
                            <CheckboxInput
                                type="checkbox"
                                id={`${formId}-enabled`}
                                name={field.name}
                                checked={field.state.value}
                                disabled={isPending || !canChangeEnabled}
                                onBlur={field.handleBlur}
                                onChange={(event) => field.handleChange(event.target.checked)}
                            />
                            <span className="grid gap-[0.12rem]">
                                <span className="text-[0.78rem] text-ink-soft">
                                    {t('admin.proxyHosts.status.enabled')}
                                </span>
                                <span className="m-0 text-[0.76rem] leading-[1.45] text-muted">
                                    {t('admin.proxyHosts.form.enabledHint')}
                                </span>
                            </span>
                        </label>
                        {!canChangeEnabled ? (
                            <p className="m-0 text-[0.76rem] leading-[1.45] text-muted">
                                {t('admin.proxyHosts.form.statusReadOnly')}
                            </p>
                        ) : null}
                    </div>
                )}
            </form.Field>
        </>
    )
}
