import { CheckboxInput, EmailInput, PasswordInput, TextInput, Textarea } from '@rentnerkev/inputs'
import { CustomSelect } from '@rentnerkev/select/select'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import FieldError from '@/shared/Forms/FieldError.tsx'
import type { CertificateRequestFieldsProps } from '../Types/certificate-request-modal.types.ts'

/** Renders the ACME certificate request fields and environment-specific guidance. */
export default function CertificateRequestFields({
    form,
    isPending,
    readOnlyDomains = false,
}: CertificateRequestFieldsProps) {
    const { t } = useTranslationStore()
    return (
        <div className="grid gap-4">
            <form.Field name="name">
                {(field) => (
                    <div className="grid gap-[0.45rem]">
                        <label
                            className="text-[0.82rem] font-[750] text-ink-soft"
                            htmlFor="certificate-request-name"
                        >
                            {t('admin.certificates.form.name')}
                        </label>
                        <TextInput
                            id="certificate-request-name"
                            name={field.name}
                            value={field.state.value}
                            maxLength={120}
                            disabled={isPending}
                            onBlur={field.handleBlur}
                            onValueChange={field.handleChange}
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
                    <div className="grid gap-[0.45rem] shell:col-span-full">
                        <label
                            className="text-[0.82rem] font-[750] text-ink-soft"
                            htmlFor="certificate-request-domains"
                        >
                            {t('admin.certificates.form.domains')}
                        </label>
                        <Textarea
                            id="certificate-request-domains"
                            name={field.name}
                            value={field.state.value.join('\n')}
                            disabled={isPending}
                            readOnly={readOnlyDomains}
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
                        <p
                            id="certificate-request-domains-hint"
                            className="m-0 text-[0.76rem] leading-[1.45] text-muted"
                        >
                            {t('admin.certificates.form.domainsHint')}
                        </p>
                        <FieldError
                            id="certificate-request-domains-error"
                            errors={field.state.meta.errors}
                        />
                    </div>
                )}
            </form.Field>
            <form.Field name="challengeType">
                {(field) => (
                    <div className="grid gap-[0.45rem]">
                        <label
                            className="text-[0.82rem] font-[750] text-ink-soft"
                            htmlFor="certificate-request-challengeType"
                        >
                            {t('admin.certificates.form.challengeType')}
                        </label>
                        <CustomSelect
                            id="certificate-request-challengeType"
                            name={field.name}
                            required
                            aria-label={t('admin.certificates.form.challengeType')}
                            disabled={isPending}
                            aria-invalid={field.state.meta.errors.length > 0}
                            aria-describedby="certificate-request-challengeType-hint certificate-request-challengeType-error"
                            onBlur={field.handleBlur}
                            value={field.state.value}
                            onValueChange={(value) => {
                                if (value === 'http-01' || value === 'dns-01')
                                    field.handleChange(value)
                            }}
                            options={[
                                {
                                    label: t('admin.certificates.challenge.http01'),
                                    value: 'http-01',
                                },
                                {
                                    label: t('admin.certificates.challenge.dns01'),
                                    value: 'dns-01',
                                },
                            ]}
                        />
                        <p
                            id="certificate-request-challengeType-hint"
                            className="m-0 text-[0.76rem] leading-[1.45] text-muted"
                        >
                            {field.state.value === 'dns-01'
                                ? t('admin.certificates.form.dnsWildcardHint')
                                : t('admin.certificates.form.httpChallengeHint')}
                        </p>
                        <FieldError
                            id="certificate-request-challengeType-error"
                            errors={field.state.meta.errors}
                        />
                    </div>
                )}
            </form.Field>
            <form.Subscribe selector={(state) => state.values.challengeType === 'dns-01'}>
                {(isDnsChallenge) =>
                    isDnsChallenge ? (
                        <div className="grid gap-4 rounded-xl border border-info-text/20 bg-info-bg p-3">
                            <p className="m-0 text-sm leading-relaxed text-info-text">
                                {t('admin.certificates.form.dnsProviderHint')}
                            </p>
                            <form.Field name="dnsZoneId">
                                {(field) => (
                                    <div className="grid gap-[0.45rem]">
                                        <label
                                            className="text-[0.82rem] font-[750] text-ink-soft"
                                            htmlFor="certificate-request-dns-zone-id"
                                        >
                                            {t('admin.certificates.form.dnsZoneId')}
                                        </label>
                                        <TextInput
                                            id="certificate-request-dns-zone-id"
                                            name={field.name}
                                            value={field.state.value}
                                            maxLength={32}
                                            disabled={isPending}
                                            onBlur={field.handleBlur}
                                            onValueChange={field.handleChange}
                                            autoCapitalize="none"
                                            autoComplete="off"
                                            spellCheck={false}
                                            aria-describedby="certificate-request-dns-zone-id-error"
                                        />
                                        <FieldError
                                            id="certificate-request-dns-zone-id-error"
                                            errors={field.state.meta.errors}
                                        />
                                    </div>
                                )}
                            </form.Field>
                            <form.Field name="dnsApiToken">
                                {(field) => (
                                    <div className="grid gap-[0.45rem]">
                                        <label
                                            className="text-[0.82rem] font-[750] text-ink-soft"
                                            htmlFor="certificate-request-dns-api-token"
                                        >
                                            {t('admin.certificates.form.dnsApiToken')}
                                        </label>
                                        <PasswordInput
                                            id="certificate-request-dns-api-token"
                                            name={field.name}
                                            type="password"
                                            value={field.state.value}
                                            maxLength={512}
                                            disabled={isPending}
                                            onBlur={field.handleBlur}
                                            onValueChange={field.handleChange}
                                            autoComplete="new-password"
                                            aria-describedby="certificate-request-dns-api-token-error"
                                        />
                                        <FieldError
                                            id="certificate-request-dns-api-token-error"
                                            errors={field.state.meta.errors}
                                        />
                                    </div>
                                )}
                            </form.Field>
                        </div>
                    ) : null
                }
            </form.Subscribe>
            <form.Field name="environment">
                {(field) => (
                    <div className="grid gap-[0.45rem]">
                        <label
                            className="text-[0.82rem] font-[750] text-ink-soft"
                            htmlFor="certificate-request-environment"
                        >
                            {t('admin.certificates.form.environment')}
                        </label>
                        <CustomSelect
                            id="certificate-request-environment"
                            name={field.name}
                            required
                            aria-label={t('admin.certificates.form.environment')}
                            disabled={isPending}
                            aria-invalid={field.state.meta.errors.length > 0}
                            aria-describedby="certificate-request-environment-hint certificate-request-environment-error"
                            onBlur={field.handleBlur}
                            value={field.state.value}
                            onValueChange={(value) => {
                                if (value === 'staging' || value === 'production')
                                    field.handleChange(value)
                            }}
                            options={[
                                {
                                    label: t('admin.certificates.environment.production'),
                                    value: 'production',
                                },
                                {
                                    label: t('admin.certificates.environment.staging'),
                                    value: 'staging',
                                },
                            ]}
                        />
                        <p
                            id="certificate-request-environment-hint"
                            className="m-0 text-[0.76rem] leading-[1.45] text-muted"
                        >
                            {t(
                                field.state.value === 'staging'
                                    ? 'admin.certificates.form.stagingHint'
                                    : 'admin.certificates.form.productionHint',
                            )}
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
                    <div className="grid gap-[0.45rem]">
                        <label
                            className="text-[0.82rem] font-[750] text-ink-soft"
                            htmlFor="certificate-request-contact"
                        >
                            {t('admin.certificates.form.contactEmail')}
                        </label>
                        <EmailInput
                            id="certificate-request-contact"
                            name={field.name}
                            type="email"
                            value={field.state.value ?? ''}
                            maxLength={254}
                            disabled={isPending}
                            onBlur={field.handleBlur}
                            onValueChange={field.handleChange}
                            aria-describedby="certificate-request-contact-hint certificate-request-contact-error"
                        />
                        <p
                            id="certificate-request-contact-hint"
                            className="m-0 text-[0.76rem] leading-[1.45] text-muted"
                        >
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
                    <div className="grid gap-[0.45rem] shell:col-span-full">
                        <label
                            className="flex cursor-pointer items-start gap-[0.65rem] rounded-[0.7rem] border border-border bg-surface-raised p-[0.65rem]"
                            htmlFor="certificate-request-terms"
                            aria-label={t('admin.certificates.form.acceptTerms')}
                        >
                            <CheckboxInput
                                id="certificate-request-terms"
                                name={field.name}
                                type="checkbox"
                                checked={field.state.value}
                                disabled={isPending}
                                onBlur={field.handleBlur}
                                onChange={(event) => field.handleChange(event.target.checked)}
                            />
                            <span className="grid gap-[0.12rem]">
                                <span className="text-[0.78rem] text-ink-soft">
                                    {t('admin.certificates.form.acceptTerms')}
                                </span>
                                <span className="m-0 text-[0.76rem] leading-[1.45] text-muted">
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
