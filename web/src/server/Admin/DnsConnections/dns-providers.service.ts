import '@tanstack/react-start/server-only'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { requirePermissionService } from '@/server/Auth/Access/authorization.service.ts'
import { dnsConnectionsController } from '@/server/Controller/dns-connections.server.ts'
import { ddnsController } from '@/server/Controller/ddns.server.ts'
import type { DdnsProviderContext } from '@/lib/DnsConnections/Types/dns-provider.types.ts'
import { DnsConnectionDomainError } from './dns-connections.errors.ts'
import type {
    DnsProviderConsumer,
    DnsProvidersDependencies,
    DdnsProviderContextDependencies,
    CertificateDnsConnectionsDependencies,
} from './Types/dns-providers.types.ts'
import { supportsDns01 } from '@/lib/DnsConnections/dnsProviders.ts'
import type { DnsConnectionChoice } from '@/lib/DnsConnections/Types/dns-connections.types.ts'

export function createDnsProvidersService(dependencies: DnsProvidersDependencies) {
    return async function getDnsProvidersService(consumer: DnsProviderConsumer) {
        switch (consumer) {
            case 'connections':
                await dependencies.authorize(PERMISSIONS.DNS_CONNECTIONS_VIEW)
                break
            case 'ddns':
                await dependencies.authorize(PERMISSIONS.DDNS_MANAGE)
                break
            case 'certificates':
                await dependencies.authorize(PERMISSIONS.CERTIFICATES_ISSUE)
                break
            default:
                throw new DnsConnectionDomainError('invalid_input')
        }
        try {
            return await dependencies.providers()
        } catch {
            throw new DnsConnectionDomainError('controller_unavailable')
        }
    }
}

export function createDdnsProviderContextService(dependencies: DdnsProviderContextDependencies) {
    return async function getDdnsProviderContextService(): Promise<DdnsProviderContext> {
        await dependencies.authorize(PERMISSIONS.DDNS_MANAGE)
        try {
            const [providers, connections, snapshot] = await Promise.all([
                dependencies.providers(),
                dependencies.connections(),
                dependencies.status(),
            ])
            const referenced = new Set(
                snapshot.configuration?.settings.targets.map((target) => target.connectionId) ?? [],
            )
            return {
                providers,
                bindings: connections
                    .filter(
                        (connection) =>
                            referenced.has(connection.id) &&
                            providers.some((provider) => provider.id === connection.provider),
                    )
                    .map((connection) => ({
                        connectionId: connection.id,
                        provider: connection.provider,
                    })),
            }
        } catch {
            throw new DnsConnectionDomainError('controller_unavailable')
        }
    }
}

export const getDnsProvidersService = createDnsProvidersService({
    authorize: requirePermissionService,
    providers: () => dnsConnectionsController.providers(),
})

export function createCertificateDnsConnectionsService(
    dependencies: CertificateDnsConnectionsDependencies,
) {
    return async function getCertificateDnsConnectionsService(): Promise<
        readonly DnsConnectionChoice[]
    > {
        await dependencies.authorize(PERMISSIONS.CERTIFICATES_ISSUE)
        try {
            const [providers, connections] = await Promise.all([
                dependencies.providers(),
                dependencies.connections(),
            ])
            return connections
                .filter((connection) =>
                    providers.some(
                        (provider) =>
                            provider.id === connection.provider && supportsDns01(provider),
                    ),
                )
                .map(({ id, name, provider, zones, verification }) => ({
                    id,
                    name,
                    provider,
                    zones,
                    verification,
                }))
        } catch {
            throw new DnsConnectionDomainError('controller_unavailable')
        }
    }
}

export const getCertificateDnsConnectionsService = createCertificateDnsConnectionsService({
    authorize: requirePermissionService,
    providers: () => dnsConnectionsController.providers(),
    connections: () => dnsConnectionsController.list(),
})

export const getDdnsProviderContextService = createDdnsProviderContextService({
    authorize: requirePermissionService,
    providers: () => dnsConnectionsController.providers(),
    connections: () => dnsConnectionsController.list(),
    status: () => ddnsController.status(),
})
