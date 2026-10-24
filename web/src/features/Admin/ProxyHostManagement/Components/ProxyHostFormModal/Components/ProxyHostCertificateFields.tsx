import { CheckboxInput } from '@rentnerkev/inputs'
import { CustomSelect } from '@rentnerkev/select/select'
import FieldError from '@/shared/Forms/FieldError.tsx'
import QueryFieldFeedback from '@/shared/Forms/QueryFieldFeedback.tsx'
import CertificateRequestFields from '@/features/Admin/CertificateManagement/Components/CertificateRequestModal/Components/CertificateRequestFields.tsx'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type { ProxyHostCertificateFieldsProps } from '../Types/form-sections.types.ts'

export default function ProxyHostCertificateFields({
    form,
    formId,
    isPending,
    canAssignCertificates,
    canRequestCertificate,
    assignableCertificatesLoading,
    assignableCertificatesLoadFailed,
    retryAssignableCertificates,
    requestNewCertificate,
    certificateRequestForm,
    usableCertificates,
    usable,
    onCertificateChange,
}: ProxyHostCertificateFieldsProps) {
    const { t } = useTranslationStore()
    return (
        <>
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
                                onValueChange={onCertificateChange}
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
                            <QueryFieldFeedback
                                isLoading={assignableCertificatesLoading}
                                isError={assignableCertificatesLoadFailed}
                                isPending={isPending}
                                onRetry={retryAssignableCertificates}
                            />
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
        </>
    )
}
