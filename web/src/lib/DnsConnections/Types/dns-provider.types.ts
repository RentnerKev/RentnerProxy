import type { DNS_PROVIDER_IDS } from '@/config/dns-connections.config.ts'

export type DnsProviderId = (typeof DNS_PROVIDER_IDS)[number]
export type DnsAddressRecordType = 'A' | 'AAAA'

export interface DnsProviderDescriptor {
    readonly id: DnsProviderId
    readonly capabilities: {
        readonly zoneDiscovery: boolean
        readonly txtCreate: boolean
        readonly txtCleanup: boolean
        readonly addressRecordTypes: readonly DnsAddressRecordType[]
        readonly proxyOptions: 'none' | 'cloudflare'
    }
}

export interface DnsProviderBinding {
    readonly connectionId: string
    readonly provider: DnsProviderId
}

export interface DdnsProviderContext {
    readonly providers: readonly DnsProviderDescriptor[]
    readonly bindings: readonly DnsProviderBinding[]
}
