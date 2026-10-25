import type { DNS_CONNECTION_ERROR_CODES } from '@/config/dns-connections.config.ts'
import type { DnsProviderId } from './dns-provider.types.ts'

export interface DnsZone {
    readonly id: string
    readonly name: string
}

interface DnsConnectionConsumer {
    readonly type: 'dns01' | 'ddns'
    readonly id: string
}

export interface DnsConnectionReference {
    readonly connectionId: string
    readonly zoneId: string
    readonly consumer: DnsConnectionConsumer
}

interface DnsConnectionUsage {
    readonly zoneId: string
    readonly consumer: DnsConnectionConsumer
}

export interface DnsConnection {
    readonly id: string
    readonly provider: DnsProviderId
    readonly ownership: 'instance'
    readonly name: string
    readonly createdByUserId: string
    readonly revision: number
    readonly zones: readonly DnsZone[]
    readonly references: readonly DnsConnectionUsage[]
    readonly createdAt: string
    readonly updatedAt: string
}

export interface DnsConnectionTestResult {
    readonly zones: readonly DnsZone[]
    readonly selectedZoneIds: readonly string[]
    readonly checkedAt: string
    readonly dnsWriteVerified: false
}

export interface ValidatedDnsConnectionReference {
    readonly reference: DnsConnectionReference
    readonly revision: number
    readonly zone: DnsZone
}

export type DnsConnectionErrorCode = (typeof DNS_CONNECTION_ERROR_CODES)[number]
