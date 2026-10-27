import { useStore } from '@tanstack/react-form'
import useCertificateDnsProviders from '../../../Hooks/useCertificateDnsProviders.ts'
import { certificateConnectionZones } from '@/lib/DnsConnections/connectionEligibility.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type { CertificateProviderFieldsProps } from '../Types/certificate-request-modal.types.ts'

export default function useCertificateProviderFieldsLogic({
    form,
    disabled,
}: CertificateProviderFieldsProps) {
    const { t } = useTranslationStore()
    const values = useStore(form.store, (state) => state.values)
    const { dnsProviders, connections, connectionsError, connectionsLoading } =
        useCertificateDnsProviders()
    const connection = connections.find((item) => item.id === values.dnsConnectionId)
    const zones = connection
        ? certificateConnectionZones(connection, values.domains, values.dnsMode)
        : []
    return {
        state: {
            connections,
            providers: dnsProviders,
            connectionId: values.dnsConnectionId ?? '',
            zoneId: zones.some((zone) => zone.id === values.dnsZoneId) ? values.dnsZoneId : '',
            zoneOptions: zones.map((zone) => ({ value: zone.id, label: zone.name })),
            disabled: disabled || connectionsLoading || connectionsError,
            unavailable: connectionsError,
            zoneLabel: t('admin.ddns.form.zone'),
        },
        handler: {
            changeConnection: (id: string) => {
                const selected = connections.find((item) => item.id === id)
                form.setFieldValue('dnsConnectionId', id)
                form.setFieldValue('dnsConnectionProvider', selected?.provider ?? 'cloudflare')
                form.setFieldValue(
                    'dnsZoneId',
                    selected
                        ? (certificateConnectionZones(selected, values.domains, values.dnsMode)[0]
                              ?.id ?? '')
                        : '',
                )
            },
            changeZone: (id: string) => form.setFieldValue('dnsZoneId', id),
        },
    }
}
