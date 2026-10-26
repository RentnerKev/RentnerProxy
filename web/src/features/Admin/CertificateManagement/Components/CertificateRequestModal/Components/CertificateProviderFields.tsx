import { CustomSelect } from '@rentnerkev/select/select'
import ProviderConnectionSelect from '@/shared/ProviderConnections/ProviderConnectionSelect.tsx'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import useCertificateProviderFieldsLogic from '../Hooks/useCertificateProviderFieldsLogic.ts'
import type { CertificateProviderFieldsProps } from '../Types/certificate-request-modal.types.ts'

export default function CertificateProviderFields(props: CertificateProviderFieldsProps) {
    const { state, handler } = useCertificateProviderFieldsLogic(props)
    const { t } = useTranslationStore()
    return (
        <div className="grid gap-4 rounded-xl border border-info-text/20 bg-info-bg p-3">
            <p className="m-0 text-sm leading-relaxed text-info-text">
                {t('admin.providers.certificateHint')}
            </p>
            {state.unavailable ? (
                <p role="alert" className="text-sm text-danger-text">
                    {t('admin.dnsConnections.errors.controller_unavailable')}
                </p>
            ) : null}
            <props.form.Field name="dnsConnectionId">
                {(field) => (
                    <ProviderConnectionSelect
                        id="certificate-request-dns-connection"
                        connections={state.connections}
                        providers={state.providers}
                        operation="dns01"
                        value={state.connectionId}
                        onValueChange={handler.changeConnection}
                        disabled={state.disabled}
                        invalid={field.state.meta.errors.length > 0}
                    />
                )}
            </props.form.Field>
            <props.form.Field name="dnsZoneId">
                {(field) => (
                    <CustomSelect
                        id="certificate-request-dns-zone-id"
                        label={state.zoneLabel}
                        aria-label={state.zoneLabel}
                        value={state.zoneId || null}
                        options={state.zoneOptions}
                        onValueChange={handler.changeZone}
                        disabled={state.disabled || !state.connectionId}
                        placeholder={state.zoneLabel}
                        aria-invalid={field.state.meta.errors.length > 0}
                    />
                )}
            </props.form.Field>
            {state.connectionId && !state.zoneOptions.length ? (
                <output className="text-sm text-muted">
                    {t('admin.providers.noMatchingZone')}
                </output>
            ) : null}
        </div>
    )
}
