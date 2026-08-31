import useTranslationStore from '../../../../language/useTranslationStore'
import FieldError from '../../../../shared/Forms/FieldError'
import SelectControl from '../../../../shared/Select'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import type useCertificateRequestLogic from '../Hooks/useCertificateRequestLogic'

export default function CertificateRequestFields({
    form,
    isPending,
}: {
    readonly form: ReturnType<typeof useCertificateRequestLogic>['form']
    readonly isPending: boolean
}) {
    const { t } = useTranslationStore()
    return (
        <div className="grid gap-4">
            <form.Field name="name">
                {(field) => (
                    <div className={uiClassNames.form.field}>
                        <label
                            className={uiClassNames.form.label}
                            htmlFor="certificate-request-name"
                        >
                            {t('admin.certificates.form.name')}
                        </label>
                        <input
                            id="certificate-request-name"
                            name={field.name}
                            className={uiClassNames.form.control}
                            value={field.state.value}
                            maxLength={120}
                            disabled={isPending}
                            onBlur={field.handleBlur}
                            onChange={(event) => field.handleChange(event.target.value)}
                            aria-describedby="certificate-request-name-error"
                        />
                        <FieldError
                            id="certificate-request-name-error"
                            errors={field.state.meta.errors}
                        />
                    </div>
                )}
            </form.Field>
            <form.Field name="domains">
                {(field) => (
                    <div className={`${uiClassNames.form.field} ${uiClassNames.form.wide}`}>
                        <label
                            className={uiClassNames.form.label}
                            htmlFor="certificate-request-domains"
                        >
                            {t('admin.certificates.form.domains')}
                        </label>
                        <textarea
                            id="certificate-request-domains"
                            name={field.name}
                            className={uiClassNames.form.textarea}
                            value={field.state.value.join('\n')}
                            disabled={isPending}
                            maxLength={25_600}
                            onBlur={field.handleBlur}
                            onChange={(event) =>
                                field.handleChange(
                                    event.target.value
                                        .split(/\r?\n/u)
                                        .map((value) => value.trim())
                                        .filter(Boolean),
                                )
                            }
                            autoCapitalize="none"
                            autoComplete="off"
                            spellCheck={false}
                            aria-describedby="certificate-request-domains-hint certificate-request-domains-error"
                        />
                        <p id="certificate-request-domains-hint" className={uiClassNames.form.hint}>
                            {t('admin.certificates.form.domainsHint')}
                        </p>
                        <FieldError
                            id="certificate-request-domains-error"
                            errors={field.state.meta.errors}
                        />
                    </div>
                )}
            </form.Field>
            <form.Field name="environment">
                {(field) => (
                    <div className={uiClassNames.form.field}>
                        <span className={uiClassNames.form.label}>
                            {t('admin.certificates.form.environment')}
                        </span>
                        <SelectControl
                            ariaLabel={t('admin.certificates.form.environment')}
                            disabled={isPending}
                            value={field.state.value}
                            onValueChange={(value) => {
                                if (value === 'staging' || value === 'production')
                                    field.handleChange(value)
                            }}
                            options={[
                                {
                                    label: t('admin.certificates.environment.staging'),
                                    value: 'staging',
                                },
                                {
                                    label: t('admin.certificates.environment.production'),
                                    value: 'production',
                                },
                            ]}
                        />
                        <p className={uiClassNames.form.hint}>
                            {t('admin.certificates.form.stagingHint')}
                        </p>
                        <FieldError
                            id="certificate-request-environment-error"
                            errors={field.state.meta.errors}
                        />
                    </div>
                )}
            </form.Field>
            <form.Field name="contactEmail">
                {(field) => (
                    <div className={uiClassNames.form.field}>
                        <label
                            className={uiClassNames.form.label}
                            htmlFor="certificate-request-contact"
                        >
                            {t('admin.certificates.form.contactEmail')}
                        </label>
                        <input
                            id="certificate-request-contact"
                            name={field.name}
                            type="email"
                            className={uiClassNames.form.control}
                            value={field.state.value ?? ''}
                            maxLength={254}
                            disabled={isPending}
                            onBlur={field.handleBlur}
                            onChange={(event) => field.handleChange(event.target.value)}
                            aria-describedby="certificate-request-contact-hint certificate-request-contact-error"
                        />
                        <p id="certificate-request-contact-hint" className={uiClassNames.form.hint}>
                            {t('admin.certificates.form.contactHint')}
                        </p>
                        <FieldError
                            id="certificate-request-contact-error"
                            errors={field.state.meta.errors}
                        />
                    </div>
                )}
            </form.Field>
            <form.Field name="acceptTerms">
                {(field) => (
                    <div className={`${uiClassNames.form.field} ${uiClassNames.form.wide}`}>
                        <label
                            className={uiClassNames.permission.option}
                            htmlFor="certificate-request-terms"
                            aria-label={t('admin.certificates.form.acceptTerms')}
                        >
                            <input
                                id="certificate-request-terms"
                                name={field.name}
                                type="checkbox"
                                className={uiClassNames.permission.checkbox}
                                checked={field.state.value}
                                disabled={isPending}
                                onBlur={field.handleBlur}
                                onChange={(event) => field.handleChange(event.target.checked)}
                            />
                            <span className={uiClassNames.permission.copy}>
                                <span className={uiClassNames.permission.title}>
                                    {t('admin.certificates.form.acceptTerms')}
                                </span>
                                <span className={uiClassNames.form.hint}>
                                    {t('admin.certificates.form.termsHint')}
                                </span>
                            </span>
                        </label>
                        <FieldError
                            id="certificate-request-terms-error"
                            errors={field.state.meta.errors}
                        />
                    </div>
                )}
            </form.Field>
        </div>
    )
}
