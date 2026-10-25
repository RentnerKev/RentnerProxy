import type { DnsAddressRecordType, DnsProviderDescriptor } from './Types/dns-provider.types.ts'

export function dnsProviderForId(
    providers: readonly DnsProviderDescriptor[],
    id: string,
): DnsProviderDescriptor | undefined {
    return providers.find((provider) => provider.id === id)
}

export function supportsDns01(provider: DnsProviderDescriptor | undefined): boolean {
    return !!provider?.capabilities.txtCreate && provider.capabilities.txtCleanup
}

export function supportsDdns(
    provider: DnsProviderDescriptor | undefined,
    recordType: DnsAddressRecordType,
): boolean {
    return provider?.capabilities.addressRecordTypes.includes(recordType) ?? false
}

export function supportsProxyOption(
    provider: DnsProviderDescriptor | undefined,
    proxied: boolean,
): boolean {
    return (
        provider !== undefined && (!proxied || provider.capabilities.proxyOptions === 'cloudflare')
    )
}
