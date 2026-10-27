import CertificateProviderFields from './CertificateProviderFields.tsx'
import { useStore } from '@tanstack/react-form'
import { EmailInput, TextInput } from '@rentnerkev/inputs'
import { CustomSelect } from '@rentnerkev/select/select'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type { CertificateRequestFieldsProps } from '../Types/certificate-request-modal.types.ts'
import CertificateDomainInputs from './CertificateDomainInputs.tsx'
import { buttonClassName } from '@/shared/Buttons/buttonStyles.ts'

/** Renders the ACME certificate request fields and environment-specific guidance. */
export default function CertificateRequestFields({
    form,
    isPending,
    readOnlyDomains = false,
    locked = false,
    onSetupManualDns,
}: CertificateRequestFieldsProps) {
    const { t } = useTranslationStore()
    const inputsDisabled = isPending || locked
    const dnsMode = useStore(form.store, (state) => state.values.dnsMode)
    const manualMode = dnsMode === 'manual'
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
                            placeholder={t('placeholders.certificateName')}
                            aria-invalid={field.state.meta.errors.length > 0}
                            name={field.name}
                            value={field.state.value}
                            maxLength={120}
                            disabled={inputsDisabled}
                            onBlur={field.handleBlur}
                            onValueChange={field.handleChange}
                        />
                    </div>
                )}
            </form.Field>
            <CertificateDomainInputs
                form={form}
                isPending={inputsDisabled}
                readOnlyDomains={readOnlyDomains}
            />
            <form.Field name="challengeType">
                {(field) => (
                    <div className="grid gap-[0.45rem]">
                        <label
                            className="text-[0.82rem] font-[750] text-ink-soft"
                            htmlFor="certificate-request-challengeType"
                        >
                            {t('admin.certificates.form.challengeType')}
                        </label>
                        <div className="flex items-start gap-2 max-sm:flex-wrap">
                            <div className="min-w-0 flex-1">
                                <CustomSelect
                                    id="certificate-request-challengeType"
                                    name={field.name}
                                    required
                                    aria-label={t('admin.certificates.form.challengeType')}
                                    disabled={inputsDisabled}
                                    aria-invalid={field.state.meta.errors.length > 0}
                                    aria-describedby={
                                        manualMode
                                            ? undefined
                                            : 'certificate-request-challengeType-hint'
                                    }
                                    onBlur={field.handleBlur}
                                    value={
                                        field.state.value === 'dns-01' &&
                                        (manualMode || dnsMode === 'delegated')
                                            ? `dns-01-${dnsMode}`
                                            : field.state.value
                                    }
                                    onValueChange={(value) => {
                                        if (
                                            value === 'dns-01-manual' ||
                                            value === 'dns-01-delegated'
                                        ) {
                                            form.setFieldValue(
                                                'dnsMode',
                                                value === 'dns-01-manual' ? 'manual' : 'delegated',
                                            )
                                            field.handleChange('dns-01')
                                        } else if (value === 'http-01' || value === 'dns-01') {
                                            form.setFieldValue('dnsMode', 'provider')
                                            field.handleChange(value)
                                        }
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
                                        {
                                            label: `DNS-01 (${t('admin.certificates.manualDns.manual')})`,
                                            value: 'dns-01-manual',
                                        },
                                        {
                                            label: t('admin.certificates.delegatedDns.label'),
                                            value: 'dns-01-delegated',
                                        },
                                    ]}
                                />
                            </div>
                            {manualMode && onSetupManualDns ? (
                                <button
                                    type="button"
                                    className={buttonClassName('primary')}
                                    disabled={isPending}
                                    onClick={onSetupManualDns}
                                >
                                    {t('admin.certificates.manualDns.setup.action')}
                                </button>
                            ) : null}
                        </div>
                        {!manualMode ? (
                            <p
                                id="certificate-request-challengeType-hint"
                                className="m-0 text-[0.76rem] leading-[1.45] text-muted"
                            >
                                {field.state.value === 'dns-01'
                                    ? t(
                                          dnsMode === 'delegated'
                                              ? 'admin.certificates.delegatedDns.hint'
                                              : 'admin.certificates.form.dnsWildcardHint',
                                      )
                                    : t('admin.certificates.form.httpChallengeHint')}
                            </p>
                        ) : null}
                    </div>
                )}
            </form.Field>
            <form.Subscribe
                selector={(state) =>
                    state.values.challengeType === 'dns-01' && state.values.dnsMode !== 'manual'
                }
            >
                {(isDnsChallenge) =>
                    isDnsChallenge ? (
                        <CertificateProviderFields form={form} disabled={inputsDisabled} />
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
                            disabled={inputsDisabled}
                            aria-invalid={field.state.meta.errors.length > 0}
                            aria-describedby="certificate-request-environment-hint"
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
                            placeholder={t('placeholders.acmeEmail')}
                            aria-invalid={field.state.meta.errors.length > 0}
                            name={field.name}
                            type="email"
                            value={field.state.value ?? ''}
                            maxLength={254}
                            disabled={inputsDisabled}
                            onBlur={field.handleBlur}
                            onValueChange={field.handleChange}
                            aria-describedby="certificate-request-contact-hint"
                        />
                        <p
                            id="certificate-request-contact-hint"
                            className="m-0 text-[0.76rem] leading-[1.45] text-muted"
                        >
                            {t('admin.certificates.form.contactHint')}
                        </p>
                    </div>
                )}
            </form.Field>
        </div>
    )
}
