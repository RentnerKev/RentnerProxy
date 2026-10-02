import useUpstreamTlsFieldsLogic from '../Hooks/useUpstreamTlsFieldsLogic.ts'
import { CheckboxInput, TextInput } from '@rentnerkev/inputs'
import { CustomSelect } from '@rentnerkev/select/select'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import FieldError from '@/shared/Forms/FieldError.tsx'
import type { ProxyHostFormFieldsProps } from '../Types/proxy-host-form.types.ts'

export default function UpstreamTlsFields({
    form,
    formId,
    isPending,
    assignableTrustedCas,
    trustedCasLoadFailed,
    trustedCasLoading,
}: Pick<
    ProxyHostFormFieldsProps,
    | 'form'
    | 'formId'
    | 'isPending'
    | 'assignableTrustedCas'
    | 'trustedCasLoadFailed'
    | 'trustedCasLoading'
>) {
    const { t } = useTranslationStore()
    const {
        handler,
        state: { visible, verifying, isIp, normalizedHost, selectedIsMissing },
    } = useUpstreamTlsFieldsLogic({ form, assignableTrustedCas })
    if (!visible) return null
    return (
        <fieldset
            className={
                'shell:col-span-full' +
                ' m-0 grid min-w-0 gap-4 rounded-2xl border border-border bg-surface-subtle p-4'
            }
        >
            <legend className="px-1 text-sm font-extrabold text-ink-soft">
                {t('admin.proxyHosts.upstreamTls.title')}
            </legend>
            <form.Field name="verifyUpstreamTls">
                {(field) => (
                    <label
                        className="flex cursor-pointer items-start gap-[0.65rem] rounded-[0.7rem] border border-border bg-surface-raised p-[0.65rem]"
                        htmlFor={formId + '-verifyUpstreamTls'}
                        aria-label={t('admin.proxyHosts.upstreamTls.verify')}
                    >
                        <CheckboxInput
                            id={formId + '-verifyUpstreamTls'}
                            name={field.name}
                            type="checkbox"
                            checked={field.state.value !== false}
                            disabled={isPending}
                            onBlur={field.handleBlur}
                            onChange={(event) => handler.handleVerifyChange(event.target.checked)}
                        />
                        <span className="grid gap-[0.12rem]">
                            <span className="text-[0.78rem] text-ink-soft">
                                {t('admin.proxyHosts.upstreamTls.verify')}
                            </span>
                            <span className="m-0 text-[0.76rem] leading-[1.45] text-muted">
                                {t('admin.proxyHosts.upstreamTls.verifyHint')}
                            </span>
                        </span>
                    </label>
                )}
            </form.Field>
            {!verifying ? (
                <p
                    role="alert"
                    className="m-0 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm leading-relaxed text-ink-soft"
                >
                    {t('admin.proxyHosts.upstreamTls.insecureWarning')}
                </p>
            ) : null}
            <form.Field name="upstreamTlsServerName">
                {(field) => (
                    <div className="grid gap-[0.45rem]">
                        <label
                            className="text-[0.82rem] font-[750] text-ink-soft"
                            htmlFor={formId + '-upstreamTlsServerName'}
                        >
                            {t('admin.proxyHosts.upstreamTls.serverName')}
                        </label>
                        <TextInput
                            id={formId + '-upstreamTlsServerName'}
                            name={field.name}
                            value={field.state.value ?? ''}
                            maxLength={253}
                            disabled={isPending}
                            autoCapitalize="none"
                            autoCorrect="off"
                            spellCheck={false}
                            placeholder={
                                isIp
                                    ? t('admin.proxyHosts.upstreamTls.serverNamePlaceholder')
                                    : t('admin.proxyHosts.upstreamTls.automatic', {
                                          name:
                                              normalizedHost ||
                                              t('admin.proxyHosts.form.forwardHost'),
                                      })
                            }
                            onBlur={field.handleBlur}
                            onChange={(event) => field.handleChange(event.target.value || null)}
                            aria-invalid={field.state.meta.errors.length > 0}
                            aria-describedby={
                                formId +
                                '-upstreamTlsServerName-hint ' +
                                formId +
                                '-upstreamTlsServerName-error'
                            }
                        />
                        <p
                            id={formId + '-upstreamTlsServerName-hint'}
                            className="m-0 text-[0.76rem] leading-[1.45] text-muted"
                        >
                            {t(
                                isIp
                                    ? 'admin.proxyHosts.upstreamTls.ipHint'
                                    : 'admin.proxyHosts.upstreamTls.serverNameHint',
                            )}
                        </p>
                        {isIp && verifying && !field.state.value ? (
                            <p className="m-0 text-sm text-danger-text">
                                {t('admin.proxyHosts.upstreamTls.ipNameRequired')}
                            </p>
                        ) : null}
                        <FieldError
                            id={formId + '-upstreamTlsServerName-error'}
                            errors={field.state.meta.errors}
                        />
                    </div>
                )}
            </form.Field>
            {verifying ? (
                <form.Field name="trustedCaId">
                    {(field) => {
                        return (
                            <div className="grid gap-[0.45rem]">
                                <label
                                    className="text-[0.82rem] font-[750] text-ink-soft"
                                    htmlFor={formId + '-trustedCaId'}
                                >
                                    {t('admin.proxyHosts.upstreamTls.trustedCa')}
                                </label>
                                <CustomSelect
                                    id={formId + '-trustedCaId'}
                                    name={field.name}
                                    required
                                    aria-label={t('admin.proxyHosts.upstreamTls.trustedCa')}
                                    value={field.state.value ?? 'system'}
                                    disabled={
                                        isPending || trustedCasLoading || trustedCasLoadFailed
                                    }
                                    aria-invalid={field.state.meta.errors.length > 0}
                                    aria-describedby={
                                        formId +
                                        '-trustedCaId-hint ' +
                                        formId +
                                        '-trustedCaId-error'
                                    }
                                    onBlur={field.handleBlur}
                                    options={[
                                        {
                                            value: 'system',
                                            label: t('admin.proxyHosts.upstreamTls.systemTrust'),
                                        },
                                        ...assignableTrustedCas.map((ca) => ({
                                            value: ca.id,
                                            label: ca.name,
                                        })),
                                        ...(selectedIsMissing
                                            ? [
                                                  {
                                                      value: field.state.value!,
                                                      label: t(
                                                          'admin.proxyHosts.upstreamTls.caUnavailable',
                                                      ),
                                                  },
                                              ]
                                            : []),
                                    ]}
                                    onValueChange={(value) =>
                                        form.setFieldValue(
                                            'trustedCaId',
                                            value === 'system' ? null : value,
                                        )
                                    }
                                />
                                <p
                                    id={formId + '-trustedCaId-hint'}
                                    className="m-0 text-[0.76rem] leading-[1.45] text-muted"
                                >
                                    {t('admin.proxyHosts.upstreamTls.trustHint')}
                                </p>
                                {trustedCasLoadFailed ? (
                                    <p role="alert" className="m-0 text-sm text-danger-text">
                                        {t('admin.proxyHosts.upstreamTls.caLoadFailed')}
                                    </p>
                                ) : null}
                                <FieldError
                                    id={formId + '-trustedCaId-error'}
                                    errors={field.state.meta.errors}
                                />
                            </div>
                        )
                    }}
                </form.Field>
            ) : null}
        </fieldset>
    )
}
