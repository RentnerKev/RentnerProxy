import type { AcmeEnvironment } from '@/config/Types/certificates-config.types.ts'
import type { DnsProviderId } from '@/lib/DnsConnections/Types/dns-provider.types.ts'

export interface DnsSetupInput {
    readonly domains: readonly string[]
    readonly environment: AcmeEnvironment
    readonly dnsMode: 'provider' | 'delegated'
    readonly connectionId: string
    readonly expectedRevision: number
    readonly zoneId: string
    readonly delegation?:
        | { readonly type: 'cname'; readonly targetOwner: string }
        | { readonly type: 'ns' }
        | undefined
}

export type DnsSetupStatus =
    'ready' | 'missing' | 'conflicting' | 'lookup_failed' | 'nameservers_unavailable'

export interface DnsSetupResult {
    readonly connectionId: string
    readonly connectionRevision: number
    readonly zoneId: string
    readonly zoneName: string
    readonly provider: DnsProviderId
    readonly dnsMode: 'provider' | 'delegated'
    readonly checkedAt: string
    readonly results: readonly {
        readonly identifiers: readonly string[]
        readonly originalOwner: string
        readonly instruction: {
            readonly type: 'TXT' | 'CNAME' | 'NS'
            readonly owner: string
            readonly values: readonly string[]
        }
        readonly status: DnsSetupStatus
        readonly observedTarget: string | null
    }[]
}

export interface ManualDnsCheckInput {
    readonly certificateId: string
    readonly operationId: string
    readonly challengeSetId: string
}

export interface ManualDnsCheckResult {
    readonly certificateId: string
    readonly operationId: string
    readonly challengeSetId: string
    readonly checkedAt: string
    readonly expiresAt: string
    readonly status: 'ready' | 'pending' | 'expired' | 'lookup_failed'
    readonly records: readonly {
        readonly owner: string
        readonly identifiers: readonly string[]
        readonly status: 'ready' | 'pending' | 'lookup_failed'
    }[]
}

export type DnsSetupActionResult =
    | { readonly success: true; readonly setup: DnsSetupResult }
    | { readonly success: false; readonly message: string }

export type ManualDnsCheckActionResult =
    | { readonly success: true; readonly check: ManualDnsCheckResult }
    | { readonly success: false; readonly message: string }
