import type { PermissionKey } from '@/config/Types/permissions-config.types.ts'
import type { DnsProviderDescriptor } from '@/lib/DnsConnections/Types/dns-provider.types.ts'
import type { DnsConnection } from '@/lib/DnsConnections/Types/dns-connections.types.ts'
import type { DdnsSnapshot } from '@/lib/Ddns/Types/ddns.types.ts'

export type DnsProviderConsumer = 'connections' | 'ddns' | 'certificates'

export interface DnsProvidersDependencies {
    readonly authorize: (permission: PermissionKey) => Promise<unknown>
    readonly providers: () => Promise<readonly DnsProviderDescriptor[]>
}

export interface DdnsProviderContextDependencies extends DnsProvidersDependencies {
    readonly connections: () => Promise<readonly DnsConnection[]>
    readonly status: () => Promise<DdnsSnapshot>
}
