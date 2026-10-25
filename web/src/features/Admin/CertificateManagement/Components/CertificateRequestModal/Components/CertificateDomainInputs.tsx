import { MAX_CERTIFICATE_DOMAINS } from '@/config/certificates.config.ts'
import DomainInputRow from '@/shared/HostDomains/Components/DomainInputRow.tsx'
import DomainListFieldset from '@/shared/HostDomains/Components/DomainListFieldset.tsx'
import useHostDomainList from '@/shared/HostDomains/Hooks/useHostDomainList.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type { CertificateRequestFieldsProps } from '../Types/certificate-request-modal.types.ts'

export default function CertificateDomainInputs({
    form,
    isPending,
    readOnlyDomains = false,
}: CertificateRequestFieldsProps) {
    const { t } = useTranslationStore()
    const { state, handler } = useHostDomainList({
        form,
        initialDomains: form.state.values.domains,
        maxDomains: MAX_CERTIFICATE_DOMAINS,
        isPending: isPending || readOnlyDomains,
    })

    return (
        <form.Field name="domains" mode="array">
            {(domainsField) => (
                <DomainListFieldset
                    legend={t('admin.certificates.form.domains')}
                    addLabel={t('admin.certificates.form.addDomain')}
                    addDisabled={
                        isPending || domainsField.state.value.length >= MAX_CERTIFICATE_DOMAINS
                    }
                    readOnly={readOnlyDomains}
                    onAdd={handler.addDomain}
                    hint={t('admin.certificates.form.domainsHint')}
                    hintId="certificate-request-domains-hint"
                    errorId="certificate-request-domains-error"
                    errors={domainsField.state.meta.errors}
                    showInlineErrors={false}
                >
                    {domainsField.state.value.map((_domain, index) => (
                        <form.Field
                            key={readOnlyDomains ? `readonly-${index}` : state.domainKeys[index]}
                            name={`domains[${index}]`}
                        >
                            {(field) => (
                                <DomainInputRow
                                    inputId={`certificate-request-domain-${index}`}
                                    errorId={`certificate-request-domain-${index}-error`}
                                    label={t('admin.certificates.form.domainLabel', {
                                        number: index + 1,
                                    })}
                                    name={field.name}
                                    value={field.state.value}
                                    placeholder={t('admin.certificates.form.domainPlaceholder')}
                                    disabled={isPending}
                                    readOnly={readOnlyDomains}
                                    removeDisabled={
                                        isPending || domainsField.state.value.length <= 1
                                    }
                                    removeLabel={t('admin.certificates.form.removeDomain', {
                                        number: index + 1,
                                    })}
                                    onRemove={() => handler.removeDomain(index)}
                                    onBlur={field.handleBlur}
                                    onValueChange={field.handleChange}
                                    describedBy="certificate-request-domains-hint"
                                    errors={[
                                        ...domainsField.state.meta.errors,
                                        ...field.state.meta.errors,
                                    ]}
                                    showInlineErrors={false}
                                />
                            )}
                        </form.Field>
                    ))}
                </DomainListFieldset>
            )}
        </form.Field>
    )
}
