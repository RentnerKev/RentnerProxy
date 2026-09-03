import { Plus, Trash2 } from 'lucide-react'
import useTranslationStore from '../../../../language/useTranslationStore'
import FieldError from '../../../../shared/Forms/FieldError'
import { getValidationIssue } from '../../../../shared/Forms/Helpers/getFieldErrorMessage'
import SelectControl from '../../../../shared/Select'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import { MAX_REDIRECT_HOST_DOMAINS } from '../../../../config/redirect-hosts.config'
import { redirectDestinationSchema, redirectDomainSchema } from '../validation'
import type { RedirectHostFormFieldsProps } from '../Types/redirect-host-form.types'
export default function RedirectHostFormFields({
    addDomain,
    canChangeEnabled,
    canAssignCertificates,
    assignableCertificates,
    domainKeys,
    form,
    formId,
    isPending,
    removeDomain,
}: RedirectHostFormFieldsProps) {
    const { t } = useTranslationStore()
    return (
        <>
            <form.Field name="domains" mode="array">
                {(domainsField) => (
                    <fieldset
                        className={`${uiClassNames.permission.fieldset} ${uiClassNames.form.wide}`}
                    >
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
                                            <div className={uiClassNames.form.field}>
                                                <label className="sr-only" htmlFor={inputId}>
                                                    {t('admin.redirectHosts.form.domainLabel', {
                                                        number: index + 1,
                                                    })}
                                                </label>
                                                <div className="flex items-start gap-2">
                                                    <input
                                                        id={inputId}
                                                        name={field.name}
                                                        className={`${uiClassNames.form.control} min-w-0`}
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
                                                        onChange={(event) =>
                                                            field.handleChange(event.target.value)
                                                        }
                                                        aria-invalid={
                                                            field.state.meta.errors.length > 0
                                                        }
                                                        aria-describedby={errorId}
                                                    />
                                                    <button
                                                        type="button"
                                                        className={`${uiClassNames.button.quiet} mt-1 shrink-0 px-2`}
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
                            className={`${uiClassNames.button.secondary} mt-3 text-sm`}
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
                            className={`${uiClassNames.form.hint} mt-2`}
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
                        <div className={`${uiClassNames.form.field} ${uiClassNames.form.wide}`}>
                            <label className={uiClassNames.form.label} htmlFor={inputId}>
                                {t('admin.redirectHosts.form.destination')}
                            </label>
                            <input
                                id={inputId}
                                name={field.name}
                                className={`${uiClassNames.form.control} font-mono`}
                                value={field.state.value}
                                maxLength={2048}
                                disabled={isPending}
                                autoCapitalize="none"
                                autoCorrect="off"
                                spellCheck={false}
                                placeholder={t('admin.redirectHosts.form.destinationPlaceholder')}
                                onBlur={field.handleBlur}
                                onChange={(event) => field.handleChange(event.target.value)}
                                aria-invalid={field.state.meta.errors.length > 0}
                                aria-describedby={`${inputId}-hint ${errorId}`}
                            />
                            <p id={`${inputId}-hint`} className={uiClassNames.form.hint}>
                                {t('admin.redirectHosts.form.destinationHint')}
                            </p>
                            <FieldError id={errorId} errors={field.state.meta.errors} />
                        </div>
                    )
                }}
            </form.Field>
            <form.Field name="statusCode">
                {(field) => (
                    <div className={uiClassNames.form.field}>
                        <span className={uiClassNames.form.label}>
                            {t('admin.redirectHosts.form.statusCode')}
                        </span>
                        <SelectControl
                            ariaLabel={t('admin.redirectHosts.form.statusCode')}
                            className="min-h-[2.85rem]"
                            disabled={isPending}
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
                        <div className={`${uiClassNames.form.field} ${uiClassNames.form.wide}`}>
                            <span className={uiClassNames.form.label}>
                                {t('admin.redirectHosts.form.certificate')}
                            </span>
                            <SelectControl
                                ariaLabel={t('admin.redirectHosts.form.certificate')}
                                disabled={isPending}
                                value={field.state.value ?? ''}
                                placeholder={t('admin.redirectHosts.form.noCertificate')}
                                options={assignableCertificates.map((certificate) => ({
                                    value: certificate.id,
                                    label:
                                        certificate.name + ' · ' + certificate.domains.join(', '),
                                }))}
                                onValueChange={(value) => field.handleChange(value || null)}
                            />
                            <p className={uiClassNames.form.hint}>
                                {t('admin.redirectHosts.form.certificateHint')}
                            </p>
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
                    <div className={`${uiClassNames.form.field} ${uiClassNames.form.wide}`}>
                        <label
                            className={uiClassNames.permission.option}
                            htmlFor={`${formId}-preserveRequestUri`}
                            aria-label={t('admin.redirectHosts.form.preserveRequestUri')}
                        >
                            <input
                                type="checkbox"
                                id={`${formId}-preserveRequestUri`}
                                name={field.name}
                                className={uiClassNames.permission.checkbox}
                                checked={field.state.value}
                                disabled={isPending}
                                onBlur={field.handleBlur}
                                onChange={(event) => field.handleChange(event.target.checked)}
                            />
                            <span className={uiClassNames.permission.copy}>
                                <span className={uiClassNames.permission.title}>
                                    {t('admin.redirectHosts.form.preserveRequestUri')}
                                </span>
                                <span className={uiClassNames.form.hint}>
                                    {t('admin.redirectHosts.form.preserveRequestUriHint')}
                                </span>
                            </span>
                        </label>
                    </div>
                )}
            </form.Field>
            <form.Field name="enabled">
                {(field) => (
                    <div className={`${uiClassNames.form.field} ${uiClassNames.form.wide}`}>
                        <label
                            className={uiClassNames.permission.option}
                            htmlFor={`${formId}-enabled`}
                            aria-label={t('admin.redirectHosts.status.enabled')}
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
                                    {t('admin.redirectHosts.status.enabled')}
                                </span>
                                <span className={uiClassNames.form.hint}>
                                    {t('admin.redirectHosts.form.enabledHint')}
                                </span>
                            </span>
                        </label>
                        {!canChangeEnabled ? (
                            <p className={uiClassNames.form.hint}>
                                {t('admin.redirectHosts.form.statusReadOnly')}
                            </p>
                        ) : null}
                    </div>
                )}
            </form.Field>
        </>
    )
}
