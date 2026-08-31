import useTranslationStore from '../../../../language/useTranslationStore'
import FieldError from '../../../../shared/Forms/FieldError'
import SelectControl from '../../../../shared/Select'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import { normalizeForwardHost } from '../Helpers/proxyHostValidation'
import type { ProxyHostFormFieldsProps } from '../Types/proxy-host-form.types'

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
    return (
        <form.Subscribe
            selector={(state) =>
                [
                    state.values.forwardScheme,
                    state.values.verifyUpstreamTls,
                    state.values.forwardHost,
                ] as const
            }
        >
            {([scheme, verify, forwardHost]) => {
                if (scheme !== 'https') return null
                const verifying = verify !== false
                const normalizedHost = normalizeForwardHost(forwardHost)
                const isIp =
                    normalizedHost !== null &&
                    (normalizedHost.includes(':') || /^\d+\.\d+\.\d+\.\d+$/u.test(normalizedHost))
                return (
                    <fieldset
                        className={
                            uiClassNames.form.wide +
                            ' m-0 grid min-w-0 gap-4 rounded-2xl border border-border bg-surface-subtle p-4'
                        }
                    >
                        <legend className="px-1 text-sm font-extrabold text-ink-soft">
                            {t('admin.proxyHosts.upstreamTls.title')}
                        </legend>
                        <form.Field name="verifyUpstreamTls">
                            {(field) => (
                                <label
                                    className={uiClassNames.permission.option}
                                    htmlFor={formId + '-verifyUpstreamTls'}
                                    aria-label={t('admin.proxyHosts.upstreamTls.verify')}
                                >
                                    <input
                                        id={formId + '-verifyUpstreamTls'}
                                        name={field.name}
                                        type="checkbox"
                                        className={uiClassNames.permission.checkbox}
                                        checked={field.state.value !== false}
                                        disabled={isPending}
                                        onBlur={field.handleBlur}
                                        onChange={(event) => {
                                            field.handleChange(event.target.checked)
                                            if (!event.target.checked)
                                                form.setFieldValue('trustedCaId', null)
                                        }}
                                    />
                                    <span className={uiClassNames.permission.copy}>
                                        <span className={uiClassNames.permission.title}>
                                            {t('admin.proxyHosts.upstreamTls.verify')}
                                        </span>
                                        <span className={uiClassNames.form.hint}>
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
                                <div className={uiClassNames.form.field}>
                                    <label
                                        className={uiClassNames.form.label}
                                        htmlFor={formId + '-upstreamTlsServerName'}
                                    >
                                        {t('admin.proxyHosts.upstreamTls.serverName')}
                                    </label>
                                    <input
                                        id={formId + '-upstreamTlsServerName'}
                                        name={field.name}
                                        className={uiClassNames.form.control}
                                        value={field.state.value ?? ''}
                                        maxLength={253}
                                        disabled={isPending}
                                        autoCapitalize="none"
                                        autoCorrect="off"
                                        spellCheck={false}
                                        placeholder={
                                            isIp
                                                ? t(
                                                      'admin.proxyHosts.upstreamTls.serverNamePlaceholder',
                                                  )
                                                : t('admin.proxyHosts.upstreamTls.automatic', {
                                                      name:
                                                          normalizedHost ||
                                                          t('admin.proxyHosts.form.forwardHost'),
                                                  })
                                        }
                                        onBlur={field.handleBlur}
                                        onChange={(event) =>
                                            field.handleChange(event.target.value || null)
                                        }
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
                                        className={uiClassNames.form.hint}
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
                                    const selectedIsMissing =
                                        !!field.state.value &&
                                        !assignableTrustedCas.some(
                                            (ca) => ca.id === field.state.value,
                                        )
                                    return (
                                        <div className={uiClassNames.form.field}>
                                            <span className={uiClassNames.form.label}>
                                                {t('admin.proxyHosts.upstreamTls.trustedCa')}
                                            </span>
                                            <SelectControl
                                                ariaLabel={t(
                                                    'admin.proxyHosts.upstreamTls.trustedCa',
                                                )}
                                                value={field.state.value ?? 'system'}
                                                disabled={
                                                    isPending ||
                                                    trustedCasLoading ||
                                                    trustedCasLoadFailed
                                                }
                                                options={[
                                                    {
                                                        value: 'system',
                                                        label: t(
                                                            'admin.proxyHosts.upstreamTls.systemTrust',
                                                        ),
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
                                            <p className={uiClassNames.form.hint}>
                                                {t('admin.proxyHosts.upstreamTls.trustHint')}
                                            </p>
                                            {trustedCasLoadFailed ? (
                                                <p
                                                    role="alert"
                                                    className="m-0 text-sm text-danger-text"
                                                >
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
            }}
        </form.Subscribe>
    )
}
