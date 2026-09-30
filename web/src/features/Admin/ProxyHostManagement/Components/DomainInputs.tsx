import { TextInput } from '@rentnerkev/inputs'
import { Plus, Trash2 } from 'lucide-react'

import { MAX_PROXY_HOST_DOMAINS } from '../../../../config/proxy-hosts.config'
import useTranslationStore from '../../../../language/useTranslationStore'
import FieldError from '../../../../shared/Forms/FieldError'
import { getValidationIssue } from '../../../../shared/Forms/Helpers/getFieldErrorMessage'
import type { ProxyHostFormFieldsProps } from '../Types/proxy-host-form.types'
import { proxyDomainSchema } from '../validation'

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
                <fieldset className="m-0 min-w-0 border-0 p-0 [&_legend]:mb-[0.55rem] [&_legend]:text-[0.82rem] [&_legend]:font-[750] [&_legend]:text-ink-soft shell:col-span-full">
                    <legend>{t('admin.proxyHosts.form.domains')}</legend>
                    <div className="grid gap-3">
                        {domainsField.state.value.map((_domain, index) => (
                            <form.Field
                                key={domainKeys[index]}
                                name={`domains[${index}]`}
                                validators={{
                                    onBlur: ({ value }) =>
                                        getValidationIssue(proxyDomainSchema, value),
                                }}
                            >
                                {(field) => {
                                    const inputId = `${formId}-domain-${index}`
                                    const errorId = `${inputId}-error`

                                    return (
                                        <div className="grid gap-[0.45rem]">
                                            <label className="sr-only" htmlFor={inputId}>
                                                {t('admin.proxyHosts.form.domainLabel', {
                                                    number: index + 1,
                                                })}
                                            </label>
                                            <div className="flex items-start gap-2">
                                                <TextInput
                                                    id={inputId}
                                                    name={field.name}
                                                    value={field.state.value}
                                                    maxLength={1_024}
                                                    disabled={isPending}
                                                    autoCapitalize="none"
                                                    autoCorrect="off"
                                                    spellCheck={false}
                                                    placeholder={t(
                                                        'admin.proxyHosts.form.domainPlaceholder',
                                                    )}
                                                    onBlur={field.handleBlur}
                                                    onChange={(event) =>
                                                        field.handleChange(event.target.value)
                                                    }
                                                    aria-invalid={
                                                        field.state.meta.errors.length > 0
                                                    }
                                                    aria-describedby={`${formId}-domains-hint ${errorId}`}
                                                />
                                                <button
                                                    type="button"
                                                    className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none bg-transparent text-muted enabled:hover:border-accent-border enabled:hover:text-accent-ring mt-1 shrink-0 px-2"
                                                    aria-label={t(
                                                        'admin.proxyHosts.form.removeDomain',
                                                        { number: index + 1 },
                                                    )}
                                                    disabled={
                                                        isPending ||
                                                        domainsField.state.value.length <= 1
                                                    }
                                                    onClick={() => removeDomain(index)}
                                                >
                                                    <Trash2 aria-hidden="true" className="size-4" />
                                                </button>
                                            </div>
                                            <FieldError
                                                id={errorId}
                                                errors={field.state.meta.errors}
                                            />
                                        </div>
                                    )
                                }}
                            </form.Field>
                        ))}
                    </div>
                    <button
                        type="button"
                        className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none border-border-strong bg-surface-raised text-ink-soft enabled:hover:border-accent-border enabled:hover:text-accent-ring mt-3 text-sm"
                        disabled={
                            isPending || domainsField.state.value.length >= MAX_PROXY_HOST_DOMAINS
                        }
                        onClick={addDomain}
                    >
                        <Plus aria-hidden="true" className="size-4" />
                        {t('admin.proxyHosts.form.addDomain')}
                    </button>
                    <p
                        id={`${formId}-domains-hint`}
                        className="m-0 text-[0.76rem] leading-[1.45] text-muted mt-2"
                    >
                        {t('admin.proxyHosts.form.domainsHint')}
                    </p>
                    <FieldError
                        id={`${formId}-domains-error`}
                        errors={domainsField.state.meta.errors}
                    />
                </fieldset>
            )}
        </form.Field>
    )
}
