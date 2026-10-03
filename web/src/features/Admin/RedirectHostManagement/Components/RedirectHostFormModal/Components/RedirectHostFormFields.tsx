import { CheckboxInput, TextInput } from '@rentnerkev/inputs'
import { Plus, Trash2 } from 'lucide-react'
import { CustomSelect } from '@rentnerkev/select/select'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import FieldError from '@/shared/Forms/FieldError.tsx'
import { getValidationIssue } from '@/lib/Forms/fieldErrors.ts'
import { MAX_REDIRECT_HOST_DOMAINS } from '@/config/redirect-hosts.config.ts'
import { certificateCoversDomains } from '@/lib/Admin/CertificateManagement/certificateValidation.ts'
import { redirectDestinationSchema, redirectDomainSchema } from '../../../validation.ts'
import type { RedirectHostFormFieldsProps } from '../Types/redirect-host-form.types.ts'
export default function RedirectHostFormFields({
    addDomain,
    canChangeEnabled,
    canAssignCertificates,
    assignableCertificates,
    assignableCertificatesLoadFailed,
    assignableCertificatesLoading,
    domainKeys,
    form,
    formId,
    isPending,
    removeDomain,
    retryAssignableCertificates,
}: RedirectHostFormFieldsProps) {
    const { t } = useTranslationStore()
    return (
        <>
            <form.Field name="domains" mode="array">
                {(domainsField) => (
                    <fieldset className="m-0 min-w-0 border-0 p-0 [&_legend]:mb-[0.55rem] [&_legend]:text-[0.82rem] [&_legend]:font-[750] [&_legend]:text-ink-soft shell:col-span-full">
                        <legend>{t('admin.redirectHosts.form.domains')}</legend>
                        <div className="grid gap-3">
                            {domainsField.state.value.map((_domain, index) => (
                                <form.Field
                                    key={domainKeys[index]}
                                    name={`domains[${index}]`}
                                    validators={{
                                        onBlur: ({ value }) =>
                                            getValidationIssue(redirectDomainSchema, value),
                                    }}
                                >
                                    {(field) => {
                                        const inputId = `${formId}-domain-${index}`
                                        const errorId = `${inputId}-error`
                                        return (
                                            <div className="grid gap-[0.45rem]">
                                                <label className="sr-only" htmlFor={inputId}>
                                                    {t('admin.redirectHosts.form.domainLabel', {
                                                        number: index + 1,
                                                    })}
                                                </label>
                                                <div className="flex items-start gap-2">
                                                    <TextInput
                                                        id={inputId}
                                                        name={field.name}
                                                        value={field.state.value}
                                                        maxLength={1024}
                                                        disabled={isPending}
                                                        autoCapitalize="none"
                                                        autoCorrect="off"
                                                        spellCheck={false}
                                                        placeholder={t(
                                                            'admin.redirectHosts.form.domainPlaceholder',
                                                        )}
                                                        onBlur={field.handleBlur}
                                                        onValueChange={field.handleChange}
                                                        aria-invalid={
                                                            field.state.meta.errors.length > 0
                                                        }
                                                        aria-describedby={errorId}
                                                    />
                                                    <button
                                                        type="button"
                                                        className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none bg-transparent text-muted enabled:hover:border-accent-border enabled:hover:text-accent-ring mt-1 shrink-0 px-2"
                                                        aria-label={t(
                                                            'admin.redirectHosts.form.removeDomain',
                                                            { number: index + 1 },
                                                        )}
                                                        disabled={
                                                            isPending ||
                                                            domainsField.state.value.length <= 1
                                                        }
                                                        onClick={() => removeDomain(index)}
                                                    >
                                                        <Trash2
                                                            aria-hidden="true"
                                                            className="size-4"
                                                        />
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
                                isPending ||
                                domainsField.state.value.length >= MAX_REDIRECT_HOST_DOMAINS
                            }
                            onClick={addDomain}
                        >
                            <Plus aria-hidden="true" className="size-4" />
                            {t('admin.redirectHosts.form.addDomain')}
                        </button>
                        <p
                            id={`${formId}-domains-hint`}
                            className="m-0 text-[0.76rem] leading-[1.45] text-muted mt-2"
                        >
                            {t('admin.redirectHosts.form.domainsHint')}
                        </p>
                        <FieldError
                            id={`${formId}-domains-error`}
                            errors={domainsField.state.meta.errors}
                        />
                    </fieldset>
                )}
            </form.Field>
            <form.Field
                name="destination"
                validators={{
                    onBlur: ({ value }) => getValidationIssue(redirectDestinationSchema, value),
                }}
            >
                {(field) => {
                    const inputId = `${formId}-destination`
                    const errorId = `${inputId}-error`
                    return (
                        <div className="grid gap-[0.45rem] shell:col-span-full">
                            <label
                                className="text-[0.82rem] font-[750] text-ink-soft"
                                htmlFor={inputId}
                            >
                                {t('admin.redirectHosts.form.destination')}
                            </label>
                            <TextInput
                                id={inputId}
                                name={field.name}
                                className="box-border w-full rounded-xl border border-input-border bg-surface-raised px-3 text-sm text-ink transition-[border-color,box-shadow] duration-150 placeholder:text-muted-soft aria-invalid:border-red-500 disabled:cursor-not-allowed disabled:opacity-[0.55] focus:border-accent-border focus:outline-hidden focus:ring-[3px] focus:ring-accent-ring/20 motion-reduce:transition-none h-12 font-mono"
                                value={field.state.value}
                                maxLength={2048}
                                disabled={isPending}
                                autoCapitalize="none"
                                autoCorrect="off"
                                spellCheck={false}
                                placeholder={t('admin.redirectHosts.form.destinationPlaceholder')}
                                onBlur={field.handleBlur}
                                onValueChange={field.handleChange}
                                aria-invalid={field.state.meta.errors.length > 0}
                                aria-describedby={`${inputId}-hint ${errorId}`}
                            />
                            <p
                                id={`${inputId}-hint`}
                                className="m-0 text-[0.76rem] leading-[1.45] text-muted"
                            >
                                {t('admin.redirectHosts.form.destinationHint')}
                            </p>
                            <FieldError id={errorId} errors={field.state.meta.errors} />
                        </div>
                    )
                }}
            </form.Field>
            <form.Field name="statusCode">
                {(field) => (
                    <div className="grid gap-[0.45rem]">
                        <label
                            className="text-[0.82rem] font-[750] text-ink-soft"
                            htmlFor={`${formId}-statusCode`}
                        >
                            {t('admin.redirectHosts.form.statusCode')}
                        </label>
                        <CustomSelect
                            id={`${formId}-statusCode`}
                            name={field.name}
                            required
                            aria-label={t('admin.redirectHosts.form.statusCode')}
                            disabled={isPending}
                            aria-invalid={field.state.meta.errors.length > 0}
                            aria-describedby={`${formId}-statusCode-error`}
                            onBlur={field.handleBlur}
                            value={field.state.value}
                            options={[301, 302, 307, 308].map((code) => ({
                                value: String(code),
                                label: t('admin.redirectHosts.statusCodes.' + code),
                            }))}
                            onValueChange={(value) => {
                                if (/^(?:301|302|307|308)$/u.test(value)) field.handleChange(value)
                            }}
                        />
                        <FieldError
                            id={`${formId}-statusCode-error`}
                            errors={field.state.meta.errors}
                        />
                    </div>
                )}
            </form.Field>
            <form.Field name="certificateId">
                {(field) =>
                    canAssignCertificates ? (
                        <div className="grid gap-[0.45rem] shell:col-span-full">
                            <label
                                className="text-[0.82rem] font-[750] text-ink-soft"
                                htmlFor={`${formId}-certificateId`}
                            >
                                {t('admin.redirectHosts.form.certificate')}
                            </label>
                            <CustomSelect
                                id={`${formId}-certificateId`}
                                name={field.name}
                                aria-label={t('admin.redirectHosts.form.certificate')}
                                disabled={
                                    isPending ||
                                    assignableCertificatesLoading ||
                                    assignableCertificatesLoadFailed
                                }
                                aria-invalid={field.state.meta.errors.length > 0}
                                aria-describedby={`${formId}-certificateId-hint ${formId}-certificateId-error`}
                                onBlur={field.handleBlur}
                                value={field.state.value ?? ''}
                                placeholder={t('admin.redirectHosts.form.noCertificate')}
                                options={[
                                    {
                                        value: '',
                                        label: t('admin.redirectHosts.form.noCertificate'),
                                    },
                                    ...assignableCertificates
                                        .filter(
                                            (certificate) =>
                                                ((certificate.status === 'valid' ||
                                                    certificate.status === 'expiring') &&
                                                    certificateCoversDomains(
                                                        certificate.domains,
                                                        form.state.values.domains,
                                                    )) ||
                                                certificate.id === field.state.value,
                                        )
                                        .map((certificate) => ({
                                            value: certificate.id,
                                            label:
                                                certificate.name +
                                                ' · ' +
                                                certificate.domains.join(', '),
                                        })),
                                ]}
                                onValueChange={(value) => field.handleChange(value || null)}
                            />
                            <p
                                id={`${formId}-certificateId-hint`}
                                className="m-0 text-[0.76rem] leading-[1.45] text-muted"
                            >
                                {t('admin.redirectHosts.form.certificateHint')}
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
                }
            </form.Field>
            <form.Field name="preserveRequestUri">
                {(field) => (
                    <div className="grid gap-[0.45rem] shell:col-span-full">
                        <label
                            className="flex cursor-pointer items-start gap-[0.65rem] rounded-[0.7rem] border border-border bg-surface-raised p-[0.65rem]"
                            htmlFor={`${formId}-preserveRequestUri`}
                            aria-label={t('admin.redirectHosts.form.preserveRequestUri')}
                        >
                            <CheckboxInput
                                type="checkbox"
                                id={`${formId}-preserveRequestUri`}
                                name={field.name}
                                checked={field.state.value}
                                disabled={isPending}
                                onBlur={field.handleBlur}
                                onChange={(event) => field.handleChange(event.target.checked)}
                            />
                            <span className="grid gap-[0.12rem]">
                                <span className="text-[0.78rem] text-ink-soft">
                                    {t('admin.redirectHosts.form.preserveRequestUri')}
                                </span>
                                <span className="m-0 text-[0.76rem] leading-[1.45] text-muted">
                                    {t('admin.redirectHosts.form.preserveRequestUriHint')}
                                </span>
                            </span>
                        </label>
                    </div>
                )}
            </form.Field>
            <form.Field name="enabled">
                {(field) => (
                    <div className="grid gap-[0.45rem] shell:col-span-full">
                        <label
                            className="flex cursor-pointer items-start gap-[0.65rem] rounded-[0.7rem] border border-border bg-surface-raised p-[0.65rem]"
                            htmlFor={`${formId}-enabled`}
                            aria-label={t('admin.redirectHosts.status.enabled')}
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
                                    {t('admin.redirectHosts.status.enabled')}
                                </span>
                                <span className="m-0 text-[0.76rem] leading-[1.45] text-muted">
                                    {t('admin.redirectHosts.form.enabledHint')}
                                </span>
                            </span>
                        </label>
                        {!canChangeEnabled ? (
                            <p className="m-0 text-[0.76rem] leading-[1.45] text-muted">
                                {t('admin.redirectHosts.form.statusReadOnly')}
                            </p>
                        ) : null}
                    </div>
                )}
            </form.Field>
        </>
    )
}
