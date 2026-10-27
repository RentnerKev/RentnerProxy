import type { DnsConnectionChoice } from '@/lib/DnsConnections/Types/dns-connections.types.ts'
import type { DnsProviderDescriptor } from '@/lib/DnsConnections/Types/dns-provider.types.ts'

export interface ProviderConnectionSelectProps {
    readonly connections: readonly DnsConnectionChoice[]
    readonly providers: readonly DnsProviderDescriptor[]
    readonly operation: 'dns01' | 'A' | 'AAAA' | 'both'
    readonly value: string
    readonly onValueChange: (value: string) => void
    readonly disabled?: boolean
    readonly label?: string
    readonly id?: string
    readonly invalid?: boolean
    readonly fallbackLabel?: string
}

export interface ProviderConnectionStatusProps {
    readonly connection: DnsConnectionChoice
}
