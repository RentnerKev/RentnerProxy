import { CustomSelect } from '@rentnerkev/select/select'
import QueryFieldFeedback from '@/shared/Forms/QueryFieldFeedback.tsx'
import UpstreamTlsFields from './UpstreamTlsFields.tsx'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type { ProxyHostAccessFieldsProps } from '../Types/form-sections.types.ts'

export default function ProxyHostAccessFields({
    form,
    formId,
    isPending,
    canAssignPolicies,
    assignableAccessPolicies,
    assignableAccessPoliciesLoading,
    assignableAccessPoliciesLoadFailed,
    retryAssignableAccessPolicies,
    assignableTrustedCas,
    trustedCasLoading,
    trustedCasLoadFailed,
    availability,
}: ProxyHostAccessFieldsProps) {
    const { t } = useTranslationStore()
    return (
        <>
            <UpstreamTlsFields
                form={form}
                formId={formId}
                isPending={isPending}
                assignableTrustedCas={assignableTrustedCas}
                trustedCasLoadFailed={trustedCasLoadFailed}
                trustedCasLoading={trustedCasLoading}
            />
            <form.Field name="accessPolicyId">
                {(field) => {
                    return canAssignPolicies ? (
                        <div className="grid gap-[0.45rem] shell:col-span-full">
                            <label
                                className="text-[0.82rem] font-[750] text-ink-soft"
                                htmlFor={`${formId}-accessPolicyId`}
                            >
                                {t('admin.proxyHosts.form.accessPolicy')}
                            </label>
                            <CustomSelect
                                id={`${formId}-accessPolicyId`}
                                name={field.name}
                                aria-label={t('admin.proxyHosts.form.accessPolicy')}
                                disabled={
                                    isPending ||
                                    assignableAccessPoliciesLoading ||
                                    assignableAccessPoliciesLoadFailed
                                }
                                aria-invalid={field.state.meta.errors.length > 0}
                                aria-describedby={`${formId}-accessPolicyId-hint`}
                                onBlur={field.handleBlur}
                                value={field.state.value ?? ''}
                                placeholder={t('admin.proxyHosts.form.noAccessPolicy')}
                                options={[
                                    {
                                        value: '',
                                        label: t('admin.proxyHosts.form.noAccessPolicy'),
                                    },
                                    ...assignableAccessPolicies.map((policy) => ({
                                        value: policy.id,
                                        label: `${policy.name} · ${t(`admin.accessPolicies.mode.${policy.mode}`)}`,
                                    })),
                                ]}
                                onValueChange={(value) => field.handleChange(value || null)}
                            />
                            {availability ? (
                                <p className="m-0 text-[0.76rem] leading-[1.45] text-muted">
                                    {t(`admin.accessPolicies.availability.${availability}`)}
                                </p>
                            ) : null}
                            <p
                                id={`${formId}-accessPolicyId-hint`}
                                className="m-0 text-[0.76rem] leading-[1.45] text-muted"
                            >
                                {t('admin.proxyHosts.form.accessPolicyHint')}
                            </p>
                            <QueryFieldFeedback
                                isLoading={assignableAccessPoliciesLoading}
                                isError={assignableAccessPoliciesLoadFailed}
                                isPending={isPending}
                                onRetry={retryAssignableAccessPolicies}
                            />
                        </div>
                    ) : null
                }}
            </form.Field>
        </>
    )
}
