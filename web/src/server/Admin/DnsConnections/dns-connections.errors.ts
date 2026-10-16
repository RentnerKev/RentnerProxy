import type { DnsConnectionErrorCode } from '@/lib/DnsConnections/Types/dns-connections.types.ts'

export class DnsConnectionDomainError extends Error {
    constructor(readonly code: DnsConnectionErrorCode) {
        super(`admin.dnsConnections.errors.${code}`)
        this.name = 'DnsConnectionDomainError'
    }
}
