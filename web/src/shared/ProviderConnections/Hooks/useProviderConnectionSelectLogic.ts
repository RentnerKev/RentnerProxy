import { connectionSupportsOperation } from '@/lib/DnsConnections/connectionEligibility.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type { ProviderConnectionSelectProps } from '../Types/provider-connections.types.ts'

export default function useProviderConnectionSelectLogic(props: ProviderConnectionSelectProps) {
    const { t, language } = useTranslationStore()
    return {
        state: {
            options: props.connections.map((connection) => ({
                value: connection.id,
                label: `${t(`admin.dnsConnections.providers.${connection.provider}`)} · ${connection.name}`,
                subOption: t(
                    `admin.providers.status.${connection.verification?.status ?? 'untested'}`,
                ),
                disabled: !connectionSupportsOperation(
                    connection,
                    props.providers,
                    props.operation,
                ),
            })),
            connectionsById: new Map(
                props.connections.map((connection) => [connection.id, connection]),
            ),
            locale:
                language === 'de' || language === 'es' || language === 'fr'
                    ? language
                    : ('en' as const),
            label: props.label ?? t('admin.providers.chooseConnection'),
            placeholder: t('admin.providers.chooseConnection'),
            unavailable: props.fallbackLabel ?? t('admin.providers.unavailable'),
            manageLabel: t('admin.providers.manage'),
        },
    }
}
