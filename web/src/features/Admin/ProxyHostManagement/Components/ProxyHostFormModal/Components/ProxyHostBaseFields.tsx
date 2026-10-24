import { TextInput } from '@rentnerkev/inputs'
import { CustomSelect } from '@rentnerkev/select/select'
import FieldError from '@/shared/Forms/FieldError.tsx'
import { getValidationIssue } from '@/lib/Forms/fieldErrors.ts'
import { proxyForwardHostSchema, proxyHostFormSchema } from '../../../validation.ts'
import DomainInputs from './DomainInputs.tsx'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type { ProxyHostBaseFieldsProps } from '../Types/form-sections.types.ts'

export default function ProxyHostBaseFields({
    form,
    formId,
    isPending,
    domainKeys,
    addDomain,
    removeDomain,
    onSchemeChange,
}: ProxyHostBaseFieldsProps) {
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
                            onValueChange={onSchemeChange}
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
                                placeholder={t('placeholders.forwardPort')}
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
        </>
    )
}
