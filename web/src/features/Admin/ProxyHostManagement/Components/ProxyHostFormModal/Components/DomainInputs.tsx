import DomainInputRow from '@/shared/HostDomains/Components/DomainInputRow.tsx'
import DomainListFieldset from '@/shared/HostDomains/Components/DomainListFieldset.tsx'

import { MAX_PROXY_HOST_DOMAINS } from '@/config/proxy-hosts.config.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import { getValidationIssue } from '@/lib/Forms/fieldErrors.ts'
import type { ProxyHostFormFieldsProps } from '../Types/proxy-host-form.types.ts'
import { proxyDomainSchema } from '../../../validation.ts'

export default function DomainInputs({
    addDomain,
    domainKeys,
    form,
    formId,
    isPending,
    removeDomain,
}: Pick<
    ProxyHostFormFieldsProps,
    'addDomain' | 'domainKeys' | 'form' | 'formId' | 'isPending' | 'removeDomain'
>) {
    const { t } = useTranslationStore()

    return (
        <form.Field name="domains" mode="array">
            {(domainsField) => (
                <DomainListFieldset
                    legend={t('admin.proxyHosts.form.domains')}
                    addLabel={t('admin.proxyHosts.form.addDomain')}
                    addDisabled={
                        isPending || domainsField.state.value.length >= MAX_PROXY_HOST_DOMAINS
                    }
                    onAdd={addDomain}
                    hint={t('admin.proxyHosts.form.domainsHint')}
                    hintId={`${formId}-domains-hint`}
                    errorId={`${formId}-domains-error`}
                    errors={domainsField.state.meta.errors}
                >
                    {domainsField.state.value.map((_domain, index) => (
                        <form.Field
                            key={domainKeys[index]}
                            name={`domains[${index}]`}
                            validators={{
                                onBlur: ({ value }) => getValidationIssue(proxyDomainSchema, value),
                            }}
                        >
                            {(field) => {
                                const inputId = `${formId}-domain-${index}`
                                const errorId = `${inputId}-error`

                                return (
                                    <DomainInputRow
                                        inputId={inputId}
                                        errorId={errorId}
                                        label={t('admin.proxyHosts.form.domainLabel', {
                                            number: index + 1,
                                        })}
                                        name={field.name}
                                        value={field.state.value}
                                        placeholder={t('admin.proxyHosts.form.domainPlaceholder')}
                                        disabled={isPending}
                                        removeDisabled={
                                            isPending || domainsField.state.value.length <= 1
                                        }
                                        removeLabel={t('admin.proxyHosts.form.removeDomain', {
                                            number: index + 1,
                                        })}
                                        onRemove={() => removeDomain(index)}
                                        onBlur={field.handleBlur}
                                        onValueChange={field.handleChange}
                                        describedBy={`${formId}-domains-hint ${errorId}`}
                                        errors={field.state.meta.errors}
                                    />
                                )
                            }}
                        </form.Field>
                    ))}
                </DomainListFieldset>
            )}
        </form.Field>
    )
}
