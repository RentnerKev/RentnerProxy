import type { ProxyHostDomainErrorCode } from './Types/proxy-hosts-errors.types.ts'
// oxlint-disable-next-line import/no-unassigned-import -- Marks this domain error module as server-only.
import '@tanstack/react-start/server-only'
import { isUniqueConstraintViolation } from '@/server/Auth/Core/database-errors.server.ts'

const hostDomainUniqueConstraints = new Set([
    'host_domains_domain_unique',

    'proxy_host_domains_domain_unique',
])

export class ProxyHostDomainError extends Error {
    readonly code: ProxyHostDomainErrorCode

    constructor(code: ProxyHostDomainErrorCode, message: string) {
        super(message)
        this.name = 'ProxyHostDomainError'
        this.code = code
    }
}

export function mapProxyHostDomainUniqueViolation(error: unknown): ProxyHostDomainError | null {
    const conflict = mapHostDomainUniqueViolation(error)
    return conflict
        ? new ProxyHostDomainError('domain_conflict', 'A proxy host domain is already in use.')
        : null
}

export function mapHostDomainUniqueViolation(
    error: unknown,
): { readonly code: 'domain_conflict'; readonly message: string } | null {
    return isUniqueConstraintViolation(error, hostDomainUniqueConstraints)
        ? { code: 'domain_conflict', message: 'A host domain is already in use.' }
        : null
}
