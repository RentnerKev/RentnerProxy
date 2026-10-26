import { useQuery } from '@tanstack/react-query'
import { supportsDns01 } from '@/lib/DnsConnections/dnsProviders.ts'
import {
    getCertificateDnsProvidersHandler,
    getCertificateDnsConnectionsHandler,
} from '../middleware.ts'
import useQueryRecovery from '@/shared/Live/Hooks/useQueryRecovery.ts'

export default function useCertificateDnsProviders(enabled = true) {
    const query = useQuery({
        queryKey: ['dns-providers', 'certificates'],
        queryFn: () => getCertificateDnsProvidersHandler(),
        retry: false,
        enabled,
    })
    const dnsProviders = query.isError ? [] : (query.data ?? []).filter(supportsDns01)
    const connectionsQuery = useQuery({
        queryKey: ['dns-connections', 'certificates'],
        queryFn: () => getCertificateDnsConnectionsHandler(),
        retry: false,
        enabled,
        refetchOnWindowFocus: 'always',
    })
    useQueryRecovery(query, enabled)
    useQueryRecovery(connectionsQuery, enabled)
    return {
        dnsProviders,
        dnsAvailable: dnsProviders.length > 0,
        connections: connectionsQuery.isError ? [] : (connectionsQuery.data ?? []),
        connectionsLoading: connectionsQuery.isPending,
        connectionsError: connectionsQuery.isError,
    }
}
