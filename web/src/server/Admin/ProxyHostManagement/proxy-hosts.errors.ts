// oxlint-disable-next-line import/no-unassigned-import -- Marks this domain error module as server-only.
import '@tanstack/react-start/server-only'

const hostDomainUniqueConstraints = new Set([
    'host_domains_domain_unique',
    // Keep mapping old errors while an existing database is being migrated.
    'proxy_host_domains_domain_unique',
])

export type ProxyHostDomainErrorCode =
    | 'domain_conflict'
    | 'proxy_host_not_found'
    | 'invalid_status_transition'
    | 'invalid_input'

export class ProxyHostDomainError extends Error {
    readonly code: ProxyHostDomainErrorCode

    constructor(code: ProxyHostDomainErrorCode, message: string) {
        super(message)
        this.name = 'ProxyHostDomainError'
        this.code = code
    }
}

export function isProxyHostDomainError(error: unknown): error is ProxyHostDomainError {
    return error instanceof ProxyHostDomainError
}

function getErrorProperty(error: object, key: string): unknown {
    if (!(key in error)) {
        return undefined
    }

    return (error as Record<string, unknown>)[key]
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
    const visited = new Set<object>()
    let current = error

    while (typeof current === 'object' && current !== null && !visited.has(current)) {
        visited.add(current)

        const code = getErrorProperty(current, 'code')
        const errno = getErrorProperty(current, 'errno')
        const sqlState = getErrorProperty(current, 'sqlState')
        const constraint =
            getErrorProperty(current, 'constraint') ??
            getErrorProperty(current, 'constraintName') ??
            getErrorProperty(current, 'constraint_name')
        const isUniqueViolation = code === '23505' || errno === '23505' || sqlState === '23505'

        if (
            isUniqueViolation &&
            typeof constraint === 'string' &&
            hostDomainUniqueConstraints.has(constraint)
        ) {
            return { code: 'domain_conflict', message: 'A host domain is already in use.' }
        }

        current = getErrorProperty(current, 'cause')
    }

    return null
}
